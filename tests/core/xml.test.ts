// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xParseError, H3xValidationError, H3xVersionError } from '../../src/core/errors';
import { signedArea } from '../../src/core/geometry/polygon';
import { roomPolygon } from '../../src/core/rooms/detect';
import type { Project } from '../../src/core/types';
import { projectFromXML } from '../../src/core/xml/parse';
import { projectToXML } from '../../src/core/xml/serialize';
import { oneRoomFloor } from '../fixtures/floors';

function sampleProject(): Project {
  const floor = oneRoomFloor();
  floor.items = {
    i1: { id: 'i1', preset: 'sofa-3s-01', mount: 'floor', x: 2, y: 2, rotation: 0.1 + 0.2 },
    i2: {
      id: 'i2',
      preset: 'outlet-01',
      mount: 'wall',
      wall: 'w2',
      side: 'left',
      offset: 1,
      elevation: 0.4,
    },
    i3: { id: 'i3', preset: 'lamp-01', mount: 'ceiling', x: 2, y: 2, rotation: 0 },
  };
  return {
    version: 1,
    unit: 'm',
    meta: { name: 'Test & <house>', created: '2026-11-16T10:00:00Z' },
    floors: [floor],
  };
}

const NODES = `<node id="n1" x="0" y="0"/><node id="n2" x="4" y="0"/>
<node id="n3" x="4" y="4"/><node id="n4" x="0" y="4"/>`;
const WALLS = `<wall id="w1" a="n1" b="n2" thickness="0.2" height="3.2"
  finishLeft="paint-white" finishRight="paint-cream"/>
<wall id="w2" a="n2" b="n3" thickness="0.2" height="3.2"/>
<wall id="w3" a="n3" b="n4" thickness="0.2" height="3.2"/>
<wall id="w4" a="n4" b="n1" thickness="0.2" height="3.2"/>`;
const OPENING = `<opening id="o1" wall="w1" preset="door-single-01" offset="1.2" width="0.9" height="2.1" sill="0"/>`;
const ROOM = `<room id="r1" walls="w1 w2 w3 w4" name="Phòng khách" floorFinish="wood-oak"/>`;
const ITEMS = `<item id="i1" preset="sofa-3s-01" mount="floor" x="2" y="3" rotation="1.5708"/>
<item id="i2" preset="outlet-01" mount="wall" wall="w1" side="left" offset="2.5" elevation="0.4"/>`;

function doc(
  opts: { room?: string; version?: string; nodes?: string; walls?: string } = {},
): string {
  const version = opts.version ?? ' version="1"';
  return `<h3x${version} unit="m">
  <meta name="Nhà ống" created="2026-11-16T10:00:00Z"/>
  <floor id="f1" level="0" elevation="0" wallHeight="3.2">
    ${opts.nodes ?? NODES}
    ${opts.walls ?? WALLS}
    ${OPENING}
    ${opts.room ?? ROOM}
    ${ITEMS}
    <unknown foo="bar"/>
  </floor>
</h3x>`;
}

describe('xml', () => {
  it('round-trips optional attributes byte-identically', () => {
    const p = sampleProject();
    const f = p.floors[0]!;
    f.openings.o1!.flip = true;
    f.walls.w1!.finishLeft = 'paint-white';
    f.walls.w1!.finishRight = 'paint-cream';
    f.rooms.r1!.floorFinish = 'wood-oak';
    f.items.i1!.variant = 'grey';
    const xml = projectToXML(p);
    expect(xml).toContain('flip="1"');
    expect(xml).toContain('variant="grey"');
    const back = projectFromXML(xml);
    expect(back.floors[0]!.openings.o1!.flip).toBe(true);
    expect(projectToXML(back)).toBe(xml);
  });

  it('rejects non-finite numbers on write', () => {
    const p = sampleProject();
    p.floors[0]!.nodes.n1!.x = NaN;
    try {
      projectToXML(p);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(H3xValidationError);
      const issue = (e as H3xValidationError).issues[0]!;
      expect(issue.code).toBe('non-finite-number');
      expect(issue.ids).toContain('n1');
    }
    const q = sampleProject();
    q.floors[0]!.walls.w1!.thickness = Infinity;
    expect(() => projectToXML(q)).toThrow(H3xValidationError);
    try {
      projectToXML(q);
    } catch (e) {
      expect((e as H3xValidationError).issues[0]!.ids).toContain('w1');
    }
  });

  it('validates unit', () => {
    expect(() => projectFromXML(doc().replace('unit="m"', 'unit="cm"'))).toThrow(
      expect.objectContaining({ name: 'H3xParseError', element: 'h3x', attribute: 'unit' }),
    );
    expect(projectFromXML(doc().replace(' unit="m"', '')).unit).toBe('m');
  });

  it('round-trip is stable', () => {
    const p = sampleProject();
    const xml = projectToXML(p);
    expect(projectToXML(projectFromXML(xml))).toBe(xml);
    expect(xml).toContain('rotation="0.3"');
    expect(projectToXML(projectFromXML(xml), { pretty: true })).toBe(
      projectToXML(p, { pretty: true }),
    );
    expect(projectFromXML(xml).meta.name).toBe('Test & <house>');
  });

  it('parses spec sample', () => {
    const p = projectFromXML(doc());
    const f = p.floors[0]!;
    expect(p.version).toBe(1);
    expect(p.meta.name).toBe('Nhà ống');
    expect(Object.keys(f.nodes)).toHaveLength(4);
    expect(Object.keys(f.walls)).toHaveLength(4);
    expect(Object.keys(f.openings)).toHaveLength(1);
    expect(f.openings.o1!.flip).toBe(false);
    expect(f.rooms.r1!.name).toBe('Phòng khách');
    expect(f.rooms.r1!.floorFinish).toBe('wood-oak');
    expect(f.walls.w1!.finishLeft).toBe('paint-white');
    expect(f.items.i2!.mount).toBe('wall');
    expect(f.items.i1!.mount).toBe('floor');
  });

  it('detects rooms when absent', () => {
    const f = projectFromXML(doc({ room: '' })).floors[0]!;
    const rooms = Object.values(f.rooms);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.name).toBe('');
    expect([...rooms[0]!.walls].sort()).toEqual(['w1', 'w2', 'w3', 'w4']);
  });

  it('normalizes CW rooms to CCW', () => {
    const f = projectFromXML(doc({ room: '<room id="r1" walls="w4 w3 w2 w1"/>' })).floors[0]!;
    expect(signedArea(roomPolygon(f, f.rooms.r1!, 'center'))).toBeGreaterThan(0);
  });

  it('rejects rooms that are not loops', () => {
    expect(() => projectFromXML(doc({ room: '<room id="r1" walls="w1 w3 w2"/>' }))).toThrow(
      expect.objectContaining({ name: 'H3xParseError', element: 'room', attribute: 'walls' }),
    );
  });

  it('parse errors', () => {
    const bad = (xml: string): H3xParseError => {
      try {
        projectFromXML(xml);
      } catch (e) {
        expect(e).toBeInstanceOf(H3xParseError);
        return e as H3xParseError;
      }
      throw new Error('expected throw');
    };
    const t = bad(doc({ walls: WALLS.replace('thickness="0.2"', 'thickness="abc"') }));
    expect(t.attribute).toBe('thickness');
    expect(t.element).toBe('wall');
    expect(bad(doc({ walls: WALLS.replace('a="n1" ', '') })).attribute).toBe('a');
    expect(bad(doc({ nodes: NODES + '<node id="n1" x="9" y="9"/>' })).message).toContain(
      'duplicate id',
    );
    expect(bad(doc({ walls: WALLS.replace('b="n2"', 'b="n9"') })).message).toContain('n9');
    expect(bad('<h3x')).toBeInstanceOf(H3xParseError);
    expect(bad(doc({ version: '' })).attribute).toBe('version');
    expect(bad(doc().replace('mount="floor"', 'mount="sky"')).attribute).toBe('mount');
  });

  it('version 2', () => {
    try {
      projectFromXML(doc({ version: ' version="2"' }));
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(H3xVersionError);
      expect((e as H3xVersionError).found).toBe(2);
    }
  });
});

describe('floors', () => {
  it('a file with no <floor> is rejected', () => {
    try {
      projectFromXML('<h3x version="1" unit="m"><meta name="x" created=""/></h3x>');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(H3xParseError);
      expect((e as H3xParseError).element).toBe('h3x');
      expect((e as H3xParseError).message).toContain('no floor');
    }
  });

  it('extra floors are kept untouched and round-trip', () => {
    const xml = doc().replace(
      '</h3x>',
      '<floor id="f2" level="1" elevation="3.2" wallHeight="3"><node id="m1" x="1" y="1"/></floor></h3x>',
    );
    const p = projectFromXML(xml);
    expect(p.floors).toHaveLength(2);
    expect(p.floors[1]!.nodes.m1).toEqual({ id: 'm1', x: 1, y: 1 });
    expect(projectFromXML(projectToXML(p))).toEqual(p);
  });
});
