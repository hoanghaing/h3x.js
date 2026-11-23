// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  removeObjects,
  roomArea,
  transformObjects,
  type Floor,
  type Project,
  type Roof,
  type Stair,
  type Transform,
  type Vec2,
} from '../../src/core';
import { signedArea } from '../../src/core/geometry/polygon';
import { stairOutline } from '../../src/core/stairs/layout';
import { oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';

const project = (floor: Floor): Project =>
  ({
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors: [floor],
  }) as Project;

const mk = (floor: Floor): H3xDocument =>
  H3xDocument.fromProject(project(floor), { presets: testPresets });

const ROOM = { walls: ['w1', 'w2', 'w3', 'w4'] };
const near = (p: Vec2, q: Vec2): boolean =>
  Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
const sameAngle = (a: number, b: number): boolean =>
  Math.abs(Math.cos(a) - Math.cos(b)) < 1e-9 && Math.abs(Math.sin(a) - Math.sin(b)) < 1e-9;
/** Every point of `a` has a match in `b` and back. */
const samePoints = (a: Vec2[], b: Vec2[]): boolean =>
  a.every((p) => b.some((q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6)) &&
  b.every((p) => a.some((q) => Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6));

/** Mirror across the vertical line x = 2. */
const MIRROR: Transform = { kind: 'mirror', a: { x: 2, y: 0 }, b: { x: 2, y: 1 } };
const reflect = (p: Vec2): Vec2 => ({ x: 4 - p.x, y: p.y });

const stair = (type: Stair['type']): Stair => ({
  id: 's1',
  x: 7,
  y: 2,
  width: type === 'straight' ? 1.2 : 2.4,
  depth: type === 'straight' ? 3.6 : 2.6,
  rotation: 0.3,
  type,
  turn: 'landing',
  hand: 'right',
  flightWidth: 1,
});

const roof = (): Roof => ({
  id: 'rf1',
  kind: 'pitched',
  follow: false,
  points: [
    { x: 10, y: 0 },
    { x: 14, y: 0 },
    { x: 14, y: 3 },
    { x: 10, y: 3 },
  ],
  edges: [
    { kind: 'gable' },
    { kind: 'slope', pitch: 30 },
    { kind: 'slope', pitch: 30 },
    { kind: 'slope', pitch: 30 },
  ],
  pitch: 30,
  base: 0,
  overhang: 0.5,
  gableOverhang: 0.3,
  thickness: 0.1,
  material: 'tile',
});

describe('transformObjects', () => {
  it('moves a whole room with its door, as one undo step', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(transformObjects(ROOM, { kind: 'translate', delta: { x: 1, y: 2 } }));
    expect(doc.floor.nodes.n1).toMatchObject({ x: 1, y: 2 });
    expect(doc.floor.nodes.n3).toMatchObject({ x: 5, y: 6 });
    expect(doc.floor.openings.o1!.offset).toBe(1.2);
    expect(Object.keys(doc.floor.rooms)).toEqual(['r1']);
    doc.undo();
    expect(doc.floor.nodes.n1).toMatchObject({ x: 0, y: 0 });
  });

  it('stretches the walls attached to a moved wall', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(transformObjects({ walls: ['w2'] }, { kind: 'translate', delta: { x: 1, y: 0 } }));
    expect(doc.floor.nodes.n2).toMatchObject({ x: 5, y: 0 });
    expect(doc.floor.nodes.n1).toMatchObject({ x: 0, y: 0 });
    expect(Math.abs(roomArea(doc.floor as Floor, doc.floor.rooms.r1!))).toBeCloseTo(4.8 * 3.8, 9);
  });

  it('a room selected by id moves its walls', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(transformObjects({ rooms: ['r1'] }, { kind: 'translate', delta: { x: 1, y: 0 } }));
    expect(doc.floor.nodes.n4).toMatchObject({ x: 1, y: 4 });
  });

  it('rotates a room about a point', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(
      transformObjects(ROOM, { kind: 'rotate', center: { x: 0, y: 0 }, angle: Math.PI / 2 }),
    );
    expect(near(doc.floor.nodes.n2!, { x: 0, y: 4 })).toBe(true);
    expect(near(doc.floor.nodes.n3!, { x: -4, y: 4 })).toBe(true);
    expect(roomArea(doc.floor as Floor, doc.floor.rooms.r1!)).toBeCloseTo(3.8 * 3.8, 9);
  });

  it('mirrors a room: doors swing the other way and the room stays counter-clockwise', () => {
    const f = oneRoomFloor();
    f.nodes = Object.fromEntries(Object.values(f.nodes).map((n) => [n.id, { ...n, x: n.x + 6 }]));
    const doc = mk(f);
    doc.execute(transformObjects(ROOM, { kind: 'mirror', a: { x: 5, y: 0 }, b: { x: 5, y: 1 } }));
    expect(near(doc.floor.nodes.n1!, { x: 4, y: 0 })).toBe(true);
    expect(doc.floor.openings.o1!.swing).toBe('right');
    expect(doc.floor.openings.o1!.hinge).toBe('a');
    expect(roomArea(doc.floor as Floor, doc.floor.rooms.r1!)).toBeCloseTo(3.8 * 3.8, 9);
    expect(doc.validateLayout()).toEqual([]);
  });

  it('mirrors wall items to the other face', () => {
    const f = oneRoomFloor();
    f.items.it1 = {
      id: 'it1',
      preset: 'outlet-01',
      mount: 'wall',
      wall: 'w2',
      side: 'left',
      offset: 2,
      elevation: 0.3,
    } as Floor['items'][string];
    const doc = mk(f);
    doc.execute(transformObjects(ROOM, MIRROR));
    expect(doc.floor.items.it1).toMatchObject({ side: 'right', offset: 2 });
  });

  it('turns and mirrors columns and floor items', () => {
    const f = oneRoomFloor();
    f.columns.c1 = { id: 'c1', x: 1, y: 1, shape: 'square', width: 0.3, depth: 0.2, rotation: 0.2 };
    f.items.it1 = {
      id: 'it1',
      preset: 'bed-01',
      mount: 'floor',
      x: 2,
      y: 2.5,
      rotation: 0.4,
    } as Floor['items'][string];
    const doc = mk(f);
    doc.execute(
      transformObjects(
        { columns: ['c1'], items: ['it1'] },
        { kind: 'rotate', center: { x: 2, y: 2 }, angle: Math.PI },
      ),
    );
    expect(near(doc.floor.columns.c1!, { x: 3, y: 3 })).toBe(true);
    expect(sameAngle(doc.floor.columns.c1!.rotation, 0.2 + Math.PI)).toBe(true);
    doc.execute(transformObjects({ columns: ['c1'], items: ['it1'] }, MIRROR));
    expect(near(doc.floor.columns.c1!, { x: 1, y: 3 })).toBe(true);
    // Across a vertical line (θ = π/2): r -> π − r.
    expect(sameAngle(doc.floor.columns.c1!.rotation, Math.PI - (0.2 + Math.PI))).toBe(true);
    const it = doc.floor.items.it1 as { x: number; y: number; rotation: number };
    expect(near(it, { x: 2, y: 1.5 })).toBe(true);
    expect(sameAngle(it.rotation, Math.PI - (0.4 + Math.PI))).toBe(true);
  });

  it.each(['straight', 'L', 'U', 'spiral'] as const)(
    'a mirrored %s stair is the mirror image of the stair',
    (type) => {
      const f = oneRoomFloor();
      f.stairs.s1 = stair(type);
      const before = stairOutline(f.stairs.s1, 3.2);
      const doc = mk(f);
      doc.execute(transformObjects({ stairs: ['s1'] }, MIRROR));
      const s = doc.floor.stairs.s1!;
      expect(s.hand).toBe('left');
      expect(samePoints(stairOutline(s as Stair, 3.2), before.map(reflect))).toBe(true);
    },
  );

  it('a rotated stair turns with the selection', () => {
    const f = oneRoomFloor();
    f.stairs.s1 = stair('L');
    const doc = mk(f);
    doc.execute(
      transformObjects({ stairs: ['s1'] }, { kind: 'rotate', center: { x: 7, y: 2 }, angle: 1 }),
    );
    expect(sameAngle(doc.floor.stairs.s1!.rotation, 1.3)).toBe(true);
    expect(doc.floor.stairs.s1!.hand).toBe('right');
  });

  it('mirrors an independent roof, keeping it counter-clockwise and its edges in place', () => {
    const f = oneRoomFloor();
    f.roofs.rf1 = roof();
    const doc = mk(f);
    doc.execute(
      transformObjects(
        { roofs: ['rf1'] },
        { kind: 'mirror', a: { x: 12, y: 0 }, b: { x: 12, y: 1 } },
      ),
    );
    const r = doc.floor.roofs.rf1!;
    expect(signedArea(r.points!)).toBeGreaterThan(0);
    // The gable was the edge (10,0) -> (14,0); its mirror image is the same segment.
    const i = r.edges!.findIndex((e) => e.kind === 'gable');
    const p = r.points![i]!;
    const q = r.points![(i + 1) % 4]!;
    expect(p.y === 0 && q.y === 0).toBe(true);
    expect(r.edges!.filter((e) => e.kind === 'gable')).toHaveLength(1);
  });

  it('moves an independent roof', () => {
    const f = oneRoomFloor();
    f.roofs.rf1 = roof();
    const doc = mk(f);
    doc.execute(transformObjects({ roofs: ['rf1'] }, { kind: 'translate', delta: { x: 1, y: 1 } }));
    expect(doc.floor.roofs.rf1!.points![0]).toEqual({ x: 11, y: 1 });
  });

  it('ignores openings in the set and rejects an invalid result as a whole', () => {
    const doc = mk(twoRoomFloor());
    const before = structuredClone(doc.floor);
    const res = doc.tryExecute(
      transformObjects(
        { walls: ['w7'], openings: ['nope'] },
        { kind: 'translate', delta: { x: 6, y: 0 } },
      ),
    );
    expect(res.ok).toBe(false);
    expect(doc.floor.nodes).toEqual(before.nodes);
  });

  it('an empty set or a zero move changes nothing', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(transformObjects({}, { kind: 'translate', delta: { x: 1, y: 0 } }));
    doc.execute(transformObjects(ROOM, { kind: 'translate', delta: { x: 0, y: 0 } }));
    expect(doc.canUndo).toBe(false);
  });
});

describe('removeObjects', () => {
  it('removes walls, columns and openings in one step', () => {
    const f = oneRoomFloor();
    f.columns.c1 = { id: 'c1', x: 1, y: 1, shape: 'round', width: 0.3, rotation: 0 };
    const doc = mk(f);
    doc.execute(
      removeObjects({ walls: ['w1', 'w2'], columns: ['c1'], openings: ['o1'], nodes: ['n2'] }),
    );
    expect(Object.keys(doc.floor.walls).sort()).toEqual(['w3', 'w4']);
    expect(doc.floor.columns).toEqual({});
    expect(doc.floor.openings).toEqual({});
    expect(doc.floor.rooms).toEqual({});
    doc.undo();
    expect(Object.keys(doc.floor.walls)).toHaveLength(4);
    expect(doc.floor.columns.c1).toBeDefined();
    expect(Object.keys(doc.floor.rooms)).toEqual(['r1']);
  });

  it('removing nothing changes nothing', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(removeObjects({}));
    expect(doc.canUndo).toBe(false);
  });
});

describe('sample layouts', () => {
  it.each(['townhouse-3f.xml', 'townhouse-trapezoid.xml'])(
    '%s: every floor turned and turned back, or mirrored twice, is unchanged',
    (name) => {
      const doc = H3xDocument.fromXML(readFileSync(`examples/layouts/${name}`, 'utf8'), {
        presets: testPresets,
      });
      for (const floor of doc.project.floors) {
        doc.setActiveFloor(floor.id);
        const f = doc.floor;
        const all = {
          walls: Object.keys(f.walls),
          columns: Object.keys(f.columns),
          stairs: Object.keys(f.stairs),
          items: Object.keys(f.items),
          roofs: Object.keys(f.roofs),
        };
        const before = structuredClone(doc.floor);
        const center = { x: 1.3, y: -2.1 };
        doc.execute(transformObjects(all, { kind: 'rotate', center, angle: 0.7 }));
        doc.execute(transformObjects(all, { kind: 'rotate', center, angle: -0.7 }));
        const line = { kind: 'mirror', a: { x: 3, y: 1 }, b: { x: 4, y: 3 } } as const;
        doc.execute(transformObjects(all, line));
        doc.execute(transformObjects(all, line));
        for (const n of Object.values(before.nodes)) {
          expect(Math.abs(doc.floor.nodes[n.id]!.x - n.x)).toBeLessThan(1e-6);
          expect(Math.abs(doc.floor.nodes[n.id]!.y - n.y)).toBeLessThan(1e-6);
        }
        expect(doc.floor.openings).toEqual(before.openings);
        expect(doc.floor.rooms).toEqual(before.rooms);
        for (const s of Object.values(before.stairs)) {
          expect(doc.floor.stairs[s.id]!.hand).toBe(s.hand);
          expect(sameAngle(doc.floor.stairs[s.id]!.rotation, s.rotation)).toBe(true);
        }
      }
    },
  );
});
