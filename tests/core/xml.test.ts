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

  it('detects room holes when rooms are absent', () => {
    const nodes = `<node id="n1" x="0" y="0"/><node id="n2" x="6" y="0"/>
<node id="n3" x="6" y="6"/><node id="n4" x="0" y="6"/>
<node id="h1" x="2" y="2"/><node id="h2" x="4" y="2"/>
<node id="h3" x="4" y="4"/><node id="h4" x="2" y="4"/>`;
    const walls = `${WALLS}
<wall id="hw1" a="h1" b="h2" thickness="0.1" height="3.2"/>
<wall id="hw2" a="h2" b="h3" thickness="0.1" height="3.2"/>
<wall id="hw3" a="h3" b="h4" thickness="0.1" height="3.2"/>
<wall id="hw4" a="h4" b="h1" thickness="0.1" height="3.2"/>`;
    const f = projectFromXML(doc({ room: '', nodes, walls })).floors[0]!;
    const rooms = Object.values(f.rooms);
    expect(rooms).toHaveLength(2);
    const outer = rooms.find((r) => r.walls.includes('w1'))!;
    const box = rooms.find((r) => r.walls.includes('hw1'))!;
    expect(outer.holes!.map((h) => [...h].sort())).toEqual([['hw1', 'hw2', 'hw3', 'hw4']]);
    expect(box).not.toHaveProperty('holes');
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

describe('xml: site, columns and room holes', () => {
  const holeNodes = `<node id="n1" x="0" y="0"/><node id="n2" x="6" y="0"/>
<node id="n3" x="6" y="6"/><node id="n4" x="0" y="6"/>
<node id="m1" x="2" y="2"/><node id="m2" x="4" y="2"/>
<node id="m3" x="4" y="4"/><node id="m4" x="2" y="4"/>`;
  const holeWalls = `<wall id="w1" a="n1" b="n2" thickness="0.2" height="3.2"/>
<wall id="w2" a="n2" b="n3" thickness="0.2" height="3.2"/>
<wall id="w3" a="n3" b="n4" thickness="0.2" height="3.2"/>
<wall id="w4" a="n4" b="n1" thickness="0.2" height="3.2"/>
<wall id="w5" a="m1" b="m2" thickness="0.2" height="3.2"/>
<wall id="w6" a="m2" b="m3" thickness="0.2" height="3.2"/>
<wall id="w7" a="m3" b="m4" thickness="0.2" height="3.2"/>
<wall id="w8" a="m4" b="m1" thickness="0.2" height="3.2"/>`;

  function full(opts: { site?: string; extra?: string; room?: string } = {}): string {
    const site = opts.site ?? '<site points="0,0 0,20 12,20 12,0"/>';
    return `<h3x version="1" unit="m">
  <meta name="x" created=""/>
  ${site}
  <floor id="f1" level="0" elevation="0" wallHeight="3.2">
    ${holeNodes}
    ${holeWalls}
    ${opts.room ?? '<room id="r1" walls="w1 w2 w3 w4" holes="w5 w6 w7 w8" name="Living"/>'}
    <column id="c1" x="4" y="3" shape="square" width="0.3" depth="0.3" rotation="0"/>
    <column id="c2" x="8" y="3" shape="round" width="0.35"/>
    ${opts.extra ?? ''}
  </floor>
</h3x>`;
  }

  function parseError(xml: string): H3xParseError {
    try {
      projectFromXML(xml);
    } catch (e) {
      expect(e).toBeInstanceOf(H3xParseError);
      return e as H3xParseError;
    }
    throw new Error('expected throw');
  }

  it('round-trips site, columns and room holes', () => {
    const p = projectFromXML(full());
    expect(p.site).toEqual({
      id: 'site',
      points: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 20 },
        { x: 0, y: 20 },
      ],
    });
    const f = p.floors[0]!;
    expect(f.columns.c1).toEqual({
      id: 'c1',
      x: 4,
      y: 3,
      shape: 'square',
      width: 0.3,
      depth: 0.3,
      rotation: 0,
    });
    expect(f.columns.c2).toEqual({
      id: 'c2',
      x: 8,
      y: 3,
      shape: 'round',
      width: 0.35,
      rotation: 0,
    });
    expect(f.rooms.r1!.holes).toEqual([['w8', 'w7', 'w6', 'w5']]);
    expect(projectFromXML(projectToXML(p))).toEqual(p);
  });

  it('reports parse errors for site, columns and holes', () => {
    expect(parseError(full({ site: '<site points="0,0 1,1"/>' }))).toMatchObject({
      element: 'site',
    });
    expect(parseError(full({ site: '<site points="0,0 1,x 2,2"/>' }))).toMatchObject({
      element: 'site',
    });
    const two = full({ site: '<site points="0,0 1,0 1,1"/><site points="0,0 1,0 1,1"/>' });
    expect(parseError(two)).toMatchObject({ element: 'site' });
    const hex = full({ extra: '<column id="c3" x="1" y="1" shape="hex" width="1"/>' });
    expect(parseError(hex)).toMatchObject({ element: 'column', attribute: 'shape' });
    const open = full({ room: '<room id="r1" walls="w1 w2 w3 w4" holes="w5 w6 w7" name=""/>' });
    expect(parseError(open)).toMatchObject({ element: 'room', attribute: 'holes' });
    const missing = full({
      room: '<room id="r1" walls="w1 w2 w3 w4" holes="w5 w6 w7 w99" name=""/>',
    });
    expect(parseError(missing)).toMatchObject({ element: 'room', attribute: 'holes' });
  });

  it('writes site after meta, columns after items, loops joined by "; "', () => {
    const p = projectFromXML(full());
    const f = p.floors[0]!;
    f.items.i1 = { id: 'i1', preset: 'p', mount: 'floor', x: 1, y: 1, rotation: 0 };
    f.rooms.r1!.holes = [['w8', 'w7', 'w6', 'w5']];
    const xml = projectToXML(p);
    expect(xml.indexOf('<site')).toBe(
      xml.indexOf('<meta') + xml.slice(xml.indexOf('<meta')).indexOf('/>') + 2,
    );
    expect(xml.indexOf('<column')).toBeGreaterThan(xml.indexOf('<item'));
    expect(xml).toContain('holes="w8 w7 w6 w5"');
    f.rooms.r1!.holes = [
      ['w8', 'w7', 'w6', 'w5'],
      ['w1', 'w2'],
    ];
    expect(projectToXML(p)).toContain('holes="w8 w7 w6 w5; w1 w2"');
    delete f.rooms.r1!.holes;
    expect(projectToXML(p)).not.toContain('holes=');
    f.rooms.r1!.holes = [];
    expect(projectToXML(p)).not.toContain('holes=');
  });
});
