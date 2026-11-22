// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  OPENING_PRESETS,
  addOpening,
  createPresetResolver,
  mirrorOrientation,
  nextOrientation,
  normalizeOpening,
  openingLeaves,
  openingParams,
  removeNode,
  splitWall,
  validateOpeningParams,
  type Floor,
  type Opening,
  type OpeningType,
  type PresetResolver,
  type Project,
} from '../../src/core';
import { H3xParseError } from '../../src/core/errors';
import { projectFromXML } from '../../src/core/xml/parse';
import { projectToXML } from '../../src/core/xml/serialize';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const NODES = `<node id="n1" x="0" y="0"/><node id="n2" x="4" y="0"/>
<node id="n3" x="4" y="4"/><node id="n4" x="0" y="4"/>`;
const WALLS = `<wall id="w1" a="n1" b="n2" thickness="0.2" height="3.2"/>
<wall id="w2" a="n2" b="n3" thickness="0.2" height="3.2"/>
<wall id="w3" a="n3" b="n4" thickness="0.2" height="3.2"/>
<wall id="w4" a="n4" b="n1" thickness="0.2" height="3.2"/>`;

const xmlWith = (attrs: string): string => `<h3x version="1" unit="m">
  <meta name="t" created="2026-11-16T10:00:00Z"/>
  <floor id="f1" level="0" elevation="0" wallHeight="3.2">
    ${NODES}
    ${WALLS}
    <opening id="o1" wall="w1" preset="p" offset="1.2" width="0.9" height="2.1" ${attrs}/>
  </floor>
</h3x>`;

const openingOf = (attrs: string): Opening =>
  projectFromXML(xmlWith(attrs)).floors[0]!.openings.o1!;

const op = (type: OpeningType, extra: Partial<Opening> = {}): Opening => ({
  id: 'o',
  wall: 'w',
  preset: 'p',
  offset: 1,
  width: 1,
  height: 2,
  sill: 0,
  type,
  hinge: 'a',
  swing: 'left',
  ...extra,
});

const mk = (floor: Floor, presets?: PresetResolver): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    presets ? { presets } : {},
  );

describe('opening XML', () => {
  it('guesses the type from the sill when it is missing', () => {
    expect(openingOf('sill="0"').type).toBe('door-swing');
    expect(openingOf('sill="0.9"').type).toBe('window-fixed');
  });

  it('reads hinge and swing from flip when they are missing', () => {
    expect(openingOf('sill="0" flip="1"')).toMatchObject({ hinge: 'b', swing: 'right' });
    expect(openingOf('sill="0"')).toMatchObject({ hinge: 'a', swing: 'left' });
    expect(openingOf('sill="0" flip="0"')).toMatchObject({ hinge: 'a', swing: 'left' });
  });

  it('lets explicit attributes beat flip', () => {
    expect(openingOf('sill="0" flip="1" hinge="a" swing="left"')).toMatchObject({
      hinge: 'a',
      swing: 'left',
    });
    expect(openingOf('sill="0" flip="1" hinge="a"')).toMatchObject({ hinge: 'a', swing: 'right' });
  });

  it('never keeps flip on the model', () => {
    expect(openingOf('sill="0" flip="1"')).not.toHaveProperty('flip');
  });

  it('writes type always, hinge and swing only when they differ, never flip', () => {
    const p = projectFromXML(xmlWith('sill="0"'));
    let xml = projectToXML(p);
    expect(xml).toContain('type="door-swing"');
    expect(xml).not.toMatch(/hinge=|swing=|flip=/);

    const o = p.floors[0]!.openings.o1!;
    o.hinge = 'b';
    xml = projectToXML(p);
    expect(xml).toContain('hinge="b"');
    expect(xml).not.toContain('swing=');
    o.swing = 'right';
    o.leaves = 3;
    o.split = 0.6;
    xml = projectToXML(p);
    expect(xml).toContain('swing="right"');
    expect(xml).toContain('leaves="3"');
    expect(xml).toContain('split="0.6"');
    expect(xml).not.toContain('flip=');
  });

  it('saves an old file the same way the second time', () => {
    const once = projectToXML(projectFromXML(xmlWith('sill="0" flip="1"')));
    expect(projectToXML(projectFromXML(once))).toBe(once);
  });

  it.each([
    'type="gate"',
    'hinge="c"',
    'swing="up"',
    'type="door-sliding" leaves="5"',
    'type="door-folding" leaves="1"',
    'type="window-fixed" leaves="7"',
    'leaves="1.5"',
    'type="door-double" split="0.4"',
    'type="door-double" split="1"',
  ])('rejects %s', (attrs) => {
    expect(() => openingOf(`sill="0" ${attrs}`)).toThrow(H3xParseError);
  });

  it('loads a bad height or sill', () => {
    const f = projectFromXML(xmlWith('sill="-1"').replace('height="2.1"', 'height="-2"'));
    expect(f.floors[0]!.openings.o1).toMatchObject({ sill: -1, height: -2 });
  });
});

describe('fromProject', () => {
  it('maps openings without the new fields the same way', () => {
    const floor = oneRoomFloor();
    const legacy = { ...floor.openings.o1!, flip: true } as Record<string, unknown>;
    delete legacy.type;
    delete legacy.hinge;
    delete legacy.swing;
    floor.openings.o1 = legacy as unknown as Opening;
    const o = mk(floor).floor.openings.o1!;
    expect(o).toMatchObject({ type: 'door-swing', hinge: 'b', swing: 'right' });
    expect(o).not.toHaveProperty('flip');
  });
});

describe('openingParams', () => {
  it.each<[string, Opening, string[]]>([
    ['door-swing', op('door-swing'), ['hinge', 'swing']],
    ['double, equal leaves', op('door-double'), ['swing', 'split']],
    ['double, split 0.5', op('door-double', { split: 0.5 }), ['swing', 'split']],
    ['double, unequal', op('door-double', { split: 0.67 }), ['hinge', 'swing', 'split']],
    ['sliding, default 2 leaves', op('door-sliding'), ['swing', 'leaves']],
    ['sliding, 1 leaf', op('door-sliding', { leaves: 1 }), ['hinge', 'swing', 'leaves']],
    ['folding', op('door-folding'), ['hinge', 'swing', 'leaves']],
    ['rolling', op('door-rolling'), ['swing']],
    ['opening', op('opening'), []],
    ['casement, default 2 leaves', op('window-casement'), ['swing', 'leaves']],
    ['casement, 1 leaf', op('window-casement', { leaves: 1 }), ['hinge', 'swing', 'leaves']],
    ['window-sliding', op('window-sliding'), ['leaves']],
    ['awning', op('window-awning'), ['swing', 'leaves']],
    ['fixed', op('window-fixed'), ['leaves']],
  ])('%s', (_name, o, expected) => {
    expect(openingParams(o)).toEqual(expected);
  });

  it('gives the default leaf count of the type unless one is stored', () => {
    expect(openingLeaves(op('door-folding'))).toBe(4);
    expect(openingLeaves(op('door-folding', { leaves: 6 }))).toBe(6);
    expect(openingLeaves(op('window-fixed'))).toBe(1);
  });

  it('keeps leaves and split when the type changes and back', () => {
    const o = op('door-sliding', { leaves: 3, split: 0.7 });
    const other = { ...o, type: 'door-swing' as const };
    expect(openingParams(other)).toEqual(['hinge', 'swing']);
    expect(other.leaves).toBe(3);
    expect(openingParams({ ...other, type: 'door-sliding' })).toEqual(['swing', 'leaves']);
    expect(validateOpeningParams(other)).toEqual([]);
  });

  it('reports invalid parameters', () => {
    expect(validateOpeningParams(op('door-sliding', { leaves: 9 }))).toMatchObject([
      { code: 'invalid-opening', ids: ['o'] },
    ]);
    expect(validateOpeningParams(op('door-double', { split: 1 }))).toHaveLength(1);
    expect(validateOpeningParams(op('door-swing'))).toEqual([]);
  });
});

describe('orientation', () => {
  it('mirrors both hinge and swing', () => {
    expect(mirrorOrientation({ hinge: 'a', swing: 'left' })).toEqual({
      hinge: 'b',
      swing: 'right',
    });
  });

  it('cycles only the parameters that apply', () => {
    let o = op('door-swing');
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const n = nextOrientation(o)!;
      seen.push(`${n.hinge}-${n.swing}`);
      o = { ...o, ...n };
    }
    expect(new Set(seen).size).toBe(4);
    expect(seen[3]).toBe('a-left');
    expect(nextOrientation(op('door-rolling'))).toEqual({ hinge: 'a', swing: 'right' });
    expect(nextOrientation(op('window-sliding'))).toBeNull();
    expect(nextOrientation(op('opening'))).toBeNull();
  });
});

describe('normalizeOpening', () => {
  it('keeps what is present and drops flip', () => {
    const o = normalizeOpening({ ...op('window-awning'), flip: true, sill: 1.6 });
    expect(o).toMatchObject({ type: 'window-awning', hinge: 'a', swing: 'left' });
    expect(o).not.toHaveProperty('flip');
  });
});

describe('built-in presets', () => {
  it('has the size and sill of each type', () => {
    expect(OPENING_PRESETS['door-double-unequal-01']).toMatchObject({
      footprint: { w: 1.2, h: 2.2 },
      sill: 0,
      opening: { type: 'door-double', split: 0.67 },
    });
    expect(OPENING_PRESETS['window-awning-01']).toMatchObject({
      footprint: { w: 0.8, h: 0.6 },
      sill: 1.6,
      opening: { type: 'window-awning' },
    });
    const types = new Set(Object.values(OPENING_PRESETS).map((p) => p.opening?.type));
    expect(types.size).toBe(10);
  });

  it('adds an opening with no resolver', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addOpening({ wall: 'w1', preset: 'door-double-unequal-01', offset: 3 });
    expect(doc.tryExecute(cmd).ok).toBe(true);
    expect(doc.floor.openings[cmd.createdId]).toMatchObject({
      type: 'door-double',
      width: 1.2,
      height: 2.2,
      hinge: 'a',
      swing: 'left',
      split: 0.67,
    });
  });

  it('takes hinge and swing from the input', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addOpening({
      wall: 'w1',
      preset: 'door-single-01',
      offset: 3,
      hinge: 'b',
      swing: 'right',
    });
    doc.execute(cmd);
    expect(doc.floor.openings[cmd.createdId]).toMatchObject({ hinge: 'b', swing: 'right' });
  });

  it('prefers the host preset over a built-in id', () => {
    const host: PresetResolver = (id) =>
      id === 'door-single-01'
        ? {
            mount: 'opening',
            footprint: { w: 0.7, d: 0.05, h: 2 },
            opening: { type: 'door-sliding' },
          }
        : undefined;
    const doc = mk(oneRoomFloor(), host);
    const cmd = addOpening({ wall: 'w1', preset: 'door-single-01', offset: 2 });
    doc.execute(cmd);
    expect(doc.floor.openings[cmd.createdId]).toMatchObject({ type: 'door-sliding', width: 0.7 });
  });

  it('gives a host preset without a type one by the sill rule', () => {
    const doc = mk(oneRoomFloor(), testPresets);
    const win = addOpening({ wall: 'w1', preset: 'window-01', offset: 3 });
    const door = addOpening({ wall: 'w2', preset: 'door-single-01', offset: 2 });
    doc.execute(win);
    doc.execute(door);
    expect(doc.floor.openings[win.createdId]!.type).toBe('window-fixed');
    expect(doc.floor.openings[door.createdId]!.type).toBe('door-swing');
  });

  it('still rejects an unknown preset and keeps one from a file', () => {
    const doc = mk(oneRoomFloor());
    expect(doc.tryExecute(addOpening({ wall: 'w1', preset: 'nope', offset: 2 }))).toMatchObject({
      ok: false,
      issues: [{ code: 'unknown-preset' }],
    });
    const back = H3xDocument.fromXML(xmlWith('sill="0"'));
    expect(Object.keys(back.floor.openings)).toEqual(['o1']);
    expect(H3xDocument.fromXML(back.toXML()).toXML()).toBe(back.toXML());
  });

  it('resolves the host first through createPresetResolver', () => {
    const r = createPresetResolver(() => undefined);
    expect(r('window-01')).toBeDefined();
    expect(r('toString')).toBeUndefined();
    expect(createPresetResolver()('sofa-3s-01')).toBeUndefined();
  });
});

describe('structure edits keep the orientation meaning', () => {
  const twoWalls = (): Floor => {
    const base = oneRoomFloor().openings.o1!;
    return {
      ...oneRoomFloor(),
      nodes: {
        p: { id: 'p', x: 0, y: 0 },
        n: { id: 'n', x: 2, y: 0 },
        q: { id: 'q', x: 5, y: 0 },
      },
      walls: {
        wa: { id: 'wa', a: 'n', b: 'p', thickness: 0.2, height: 3.2 },
        wb: { id: 'wb', a: 'n', b: 'q', thickness: 0.2, height: 3.2 },
      },
      openings: {
        oa: { ...base, id: 'oa', wall: 'wa', width: 0.6, offset: 1 },
        ob: { ...base, id: 'ob', wall: 'wb', width: 0.6, offset: 1, hinge: 'b', swing: 'left' },
      },
      items: {},
      rooms: {},
    };
  };

  it('mirrors hinge and swing on a reversed wall', () => {
    const doc = mk(twoWalls(), testPresets);
    doc.execute(removeNode('n'));
    expect(doc.floor.openings.oa).toMatchObject({ hinge: 'a', swing: 'left' });
    expect(doc.floor.openings.ob).toMatchObject({ wall: 'wa', hinge: 'a', swing: 'right' });
  });

  it('keeps both when a wall is split', () => {
    const floor = oneRoomFloor();
    floor.openings.o1!.hinge = 'b';
    floor.openings.o1!.swing = 'right';
    const doc = mk(floor, testPresets);
    doc.execute(splitWall('w1', { x: 3, y: 0 }));
    expect(doc.floor.openings.o1).toMatchObject({ hinge: 'b', swing: 'right' });
  });
});
