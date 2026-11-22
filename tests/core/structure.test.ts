// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import {
  dropNode,
  mergeNodes,
  removeNode,
  removeWall,
  splitWall,
} from '../../src/core/commands/structure';
import { diffFloors, wallsAt } from '../../src/core/topology/draft';
import { H3xValidationError } from '../../src/core/errors';
import type { Floor, Project, Wall, WallItem } from '../../src/core/types';
import { ctxFor, oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';

const mk = (floor: Floor): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof H3xValidationError) return err.issues[0]?.code;
    throw err;
  }
  return undefined;
}

const outlet = (id: string, wall: string, offset: number): WallItem => ({
  id,
  mount: 'wall',
  preset: 'outlet-01',
  wall,
  side: 'left',
  offset,
  elevation: 0.3,
});

const wallBetween = (f: Readonly<Floor>, p: string, q: string): Wall | undefined =>
  Object.values(f.walls).find((w) => (w.a === p && w.b === q) || (w.a === q && w.b === p));

describe('splitWall', () => {
  it('projects the point, splits the wall, moves openings and keeps the room; one undo', () => {
    const floor = oneRoomFloor();
    floor.walls.w1!.finishLeft = 'paint-white';
    floor.openings.o1!.offset = 3;
    const doc = mk(floor);
    const original = structuredClone(doc.floor);
    const cmd = splitWall('w1', { x: 1.5, y: 0.02 });
    doc.execute(cmd);
    const f = doc.floor;
    const nid = cmd.createdId;
    expect(f.nodes[nid]).toEqual({ id: nid, x: 1.5, y: 0 });
    expect(f.walls.w1).toMatchObject({ a: 'n1', b: nid, thickness: 0.2, height: 3.2 });
    const other = Object.values(f.walls).find((w) => w.a === nid)!;
    expect(other).toMatchObject({ b: 'n2', thickness: 0.2, height: 3.2 });
    expect(other.finishLeft).toBe('paint-white');
    expect(f.openings.o1).toMatchObject({ wall: other.id, offset: 1.5 });
    expect(f.rooms.r1!.name).toBe('Phòng khách');
    expect(f.rooms.r1!.walls).toHaveLength(5);
    expect(Object.keys(f.rooms)).toEqual(['r1']);
    doc.undo();
    expect(doc.floor).toEqual(original);
    expect(doc.canUndo).toBe(false);
  });

  it('re-running the same command object is deterministic', () => {
    const cmd = splitWall('w1', { x: 2, y: 0 });
    const ctx = ctxFor(oneRoomFloor(), testPresets);
    expect(cmd.run(ctx)).toEqual(cmd.run(ctx));
  });

  it('executing the same command twice throws duplicate-id', () => {
    const doc = mk(oneRoomFloor());
    const cmd = splitWall('w1', { x: 2, y: 0 });
    doc.execute(cmd);
    expect(codeOf(() => doc.execute(cmd))).toBe('duplicate-id');
  });

  it('rejects a half shorter than MIN_WALL_LENGTH', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(splitWall('w1', { x: 0.1, y: 0 })))).toBe('split-too-short');
    expect(codeOf(() => doc.execute(splitWall('w1', { x: 3.9, y: 0 })))).toBe('split-too-short');
    expect(codeOf(() => doc.execute(splitWall('w1', { x: 5, y: 0 })))).toBe('split-too-short');
  });

  it('rejects a split through an opening whose center half cannot hold it', () => {
    const floor = oneRoomFloor();
    floor.openings.o1!.offset = 0.7;
    const doc = mk(floor);
    expect(codeOf(() => doc.execute(splitWall('w1', { x: 0.75, y: 0 })))).toBe(
      'split-cuts-opening',
    );
  });

  it('rejects a straddling opening instead of pushing it into a half', () => {
    const doc = mk(oneRoomFloor()); // o1 at 1.2, width 0.9
    expect(codeOf(() => doc.execute(splitWall('w1', { x: 1, y: 0 })))).toBe('split-cuts-opening');
    expect(doc.floor.openings.o1!.offset).toBe(1.2);
  });

  it('moves wall items with the half holding their center', () => {
    const floor = oneRoomFloor();
    floor.items.i1 = outlet('i1', 'w1', 0.5);
    floor.items.i2 = outlet('i2', 'w1', 3.5);
    const doc = mk(floor);
    const cmd = splitWall('w1', { x: 2.5, y: 0 });
    doc.execute(cmd);
    const other = Object.values(doc.floor.walls).find((w) => w.a === cmd.createdId)!;
    expect(doc.floor.items.i1).toMatchObject({ wall: 'w1', offset: 0.5 });
    expect(doc.floor.items.i2).toMatchObject({ wall: other.id, offset: 1 });
  });

  it('throws not-found for a missing wall', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(splitWall('nope', { x: 1, y: 0 })))).toBe('not-found');
  });
});

describe('removeWall', () => {
  it('merges two rooms on a shared wall, the bigger keeps its name', () => {
    const floor = twoRoomFloor();
    floor.nodes.n2!.x = 3;
    floor.nodes.n5!.x = 3;
    const doc = mk(floor);
    doc.execute(removeWall('w7'));
    const f = doc.floor;
    expect(f.walls.w7).toBeUndefined();
    expect(Object.keys(f.rooms)).toEqual(['r2']);
    expect(f.rooms.r2!.name).toBe('Room 2');
    expect(f.rooms.r2!.walls).toHaveLength(6);
    expect(f.nodes.n2).toBeDefined();
    doc.undo();
    expect(Object.keys(doc.floor.rooms).sort()).toEqual(['r1', 'r2']);
  });

  it('deletes the room, openings and wall items when an outer wall goes', () => {
    const floor = oneRoomFloor();
    floor.items.i1 = outlet('i1', 'w1', 2.5);
    floor.items.i2 = outlet('i2', 'w2', 2);
    const doc = mk(floor);
    doc.execute(removeWall('w1'));
    const f = doc.floor;
    expect(f.rooms).toEqual({});
    expect(f.openings).toEqual({});
    expect(Object.keys(f.items)).toEqual(['i2']);
    expect(f.nodes.n1).toBeDefined();
    expect(f.nodes.n2).toBeDefined();
  });

  it('deletes orphaned nodes', () => {
    const floor = oneRoomFloor();
    floor.nodes.n5 = { id: 'n5', x: 6, y: 0 };
    floor.walls.w5 = { id: 'w5', a: 'n2', b: 'n5', thickness: 0.2, height: 3.2 };
    const doc = mk(floor);
    doc.execute(removeWall('w5'));
    expect(doc.floor.nodes.n5).toBeUndefined();
    expect(doc.floor.nodes.n2).toBeDefined();
    expect(doc.floor.rooms.r1).toBeDefined();
  });

  it('throws not-found for a missing wall', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(removeWall('nope')))).toBe('not-found');
  });
});

describe('removeNode', () => {
  it('merges a collinear degree-2 node back, re-basing openings; the room keeps its id', () => {
    const floor = oneRoomFloor();
    floor.openings.o1!.offset = 3;
    floor.items.i1 = outlet('i1', 'w1', 0.5);
    const doc = mk(floor);
    const split = splitWall('w1', { x: 1.5, y: 0 });
    doc.execute(split);
    doc.execute(removeNode(split.createdId));
    const f = doc.floor;
    expect(f.nodes[split.createdId]).toBeUndefined();
    expect(Object.keys(f.walls)).toHaveLength(4);
    const merged = wallBetween(f, 'n1', 'n2')!;
    expect(merged).toBeDefined();
    const fromN1 = (off: number): number => (merged.a === 'n1' ? off : 4 - off);
    expect(f.openings.o1!.wall).toBe(merged.id);
    expect(fromN1(f.openings.o1!.offset)).toBeCloseTo(3);
    expect((f.items.i1 as WallItem).wall).toBe(merged.id);
    expect(fromN1((f.items.i1 as WallItem).offset)).toBeCloseTo(0.5);
    expect(Object.keys(f.rooms)).toEqual(['r1']);
    expect(f.rooms.r1!.walls).toHaveLength(4);
  });

  it('re-bases offsets and mirrors side / flip on the reversed wall', () => {
    const base = oneRoomFloor().openings.o1!;
    const floor: Floor = {
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
        oa: { ...base, id: 'oa', wall: 'wa', width: 0.6, offset: 1 }, // at x = 1
        ob: { ...base, id: 'ob', wall: 'wb', width: 0.6, offset: 1 }, // at x = 3
      },
      items: { ia: outlet('ia', 'wa', 0.5), ib: outlet('ib', 'wb', 2) }, // at x = 1.5, x = 4
      rooms: {},
    };
    const doc = mk(floor);
    doc.execute(removeNode('n'));
    const f = doc.floor;
    expect(f.walls.wb).toBeUndefined();
    expect(f.walls.wa).toMatchObject({ a: 'q', b: 'p' });
    // wa (n -> p) keeps its direction; wb (n -> q) runs against the merged q -> p wall.
    expect(f.openings.oa).toMatchObject({ wall: 'wa', offset: 4, flip: false });
    expect(f.openings.ob).toMatchObject({ wall: 'wa', offset: 2, flip: true });
    expect(f.items.ia).toMatchObject({ wall: 'wa', offset: 3.5, side: 'left' });
    expect(f.items.ib).toMatchObject({ wall: 'wa', offset: 1, side: 'right' });
  });

  it('keeps side / flip when the other wall runs with the merged wall', () => {
    const floor = oneRoomFloor();
    floor.openings.o1!.offset = 3;
    floor.openings.o1!.flip = true;
    floor.items.i1 = outlet('i1', 'w1', 3.5);
    const doc = mk(floor);
    const split = splitWall('w1', { x: 1.5, y: 0 });
    doc.execute(split);
    doc.execute(removeNode(split.createdId));
    expect(doc.floor.openings.o1!.flip).toBe(true);
    expect((doc.floor.items.i1 as WallItem).side).toBe('left');
  });

  it('deletes a triangle corner whose merge would duplicate a wall, and the room', () => {
    const floor: Floor = {
      ...oneRoomFloor(),
      nodes: {
        n1: { id: 'n1', x: 0, y: 0 },
        n2: { id: 'n2', x: 4, y: 0 },
        n3: { id: 'n3', x: 0, y: 4 },
      },
      walls: {
        w1: { id: 'w1', a: 'n1', b: 'n2', thickness: 0.2, height: 3.2 },
        w2: { id: 'w2', a: 'n2', b: 'n3', thickness: 0.2, height: 3.2 },
        w3: { id: 'w3', a: 'n3', b: 'n1', thickness: 0.2, height: 3.2 },
      },
      openings: {},
      rooms: { r1: { id: 'r1', walls: ['w1', 'w2', 'w3'], name: 'T' } },
    };
    const doc = mk(floor);
    doc.execute(removeNode('n2'));
    const f = doc.floor;
    expect(f.nodes.n2).toBeUndefined();
    expect(Object.keys(f.walls)).toEqual(['w3']);
    expect(Object.keys(f.nodes).sort()).toEqual(['n1', 'n3']);
    expect(f.rooms).toEqual({});
  });

  it('merges a corner into a straight wall; the triangle room keeps its id', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(removeNode('n3'));
    const f = doc.floor;
    expect(f.nodes.n3).toBeUndefined();
    expect(f.walls.w3).toBeUndefined();
    expect(f.walls.w2).toMatchObject({ a: 'n2', b: 'n4', thickness: 0.2, height: 3.2 });
    expect(Object.keys(f.rooms)).toEqual(['r1']);
    expect(f.rooms.r1!.name).toBe('Phòng khách');
    expect(f.rooms.r1!.walls).toHaveLength(3);
  });

  it('deletes a degree-3 node with its walls', () => {
    const doc = mk(twoRoomFloor());
    doc.execute(removeNode('n2'));
    const f = doc.floor;
    expect(f.nodes.n2).toBeUndefined();
    for (const id of ['w1', 'w2', 'w7']) expect(f.walls[id]).toBeUndefined();
    expect(Object.keys(f.walls).sort()).toEqual(['w3', 'w4', 'w5', 'w6']);
    expect(f.rooms).toEqual({});
  });

  it('deletes a degree-1 node with its wall and the orphaned far node', () => {
    const floor = oneRoomFloor();
    floor.nodes.n5 = { id: 'n5', x: 6, y: 0 };
    floor.walls.w5 = { id: 'w5', a: 'n2', b: 'n5', thickness: 0.2, height: 3.2 };
    const doc = mk(floor);
    doc.execute(removeNode('n5'));
    expect(doc.floor.nodes.n5).toBeUndefined();
    expect(doc.floor.walls.w5).toBeUndefined();
    expect(doc.floor.nodes.n2).toBeDefined();
  });

  it('rejects a merge whose opening no longer fits', () => {
    const floor: Floor = {
      ...oneRoomFloor(),
      nodes: {
        a: { id: 'a', x: 0, y: 0 },
        n: { id: 'n', x: 3, y: 0 },
        b: { id: 'b', x: 0, y: 0.5 },
      },
      walls: {
        wa: { id: 'wa', a: 'a', b: 'n', thickness: 0.2, height: 3.2 },
        wb: { id: 'wb', a: 'n', b: 'b', thickness: 0.2, height: 3.2 },
      },
      openings: {
        o1: { ...oneRoomFloor().openings.o1!, wall: 'wa', offset: 1.5 },
      },
      rooms: {},
    };
    const doc = mk(floor);
    expect(codeOf(() => doc.execute(removeNode('n')))).toBe('merge-drops-opening');
  });

  it('throws not-found for a missing node', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(removeNode('nope')))).toBe('not-found');
  });
});

const chainFloor = (): Floor => ({
  ...oneRoomFloor(),
  nodes: {
    a: { id: 'a', x: 0, y: 0 },
    b: { id: 'b', x: 3, y: 0 },
    c: { id: 'c', x: 3.4, y: 0 },
    d: { id: 'd', x: 3.4, y: 3 },
  },
  walls: {
    wab: { id: 'wab', a: 'a', b: 'b', thickness: 0.2, height: 3.2 },
    wcd: { id: 'wcd', a: 'c', b: 'd', thickness: 0.2, height: 3.2 },
  },
  openings: {},
  rooms: {},
});

describe('mergeNodes', () => {
  it('joins the walls of two chains at keep and deletes drop', () => {
    const doc = mk(chainFloor());
    doc.execute(mergeNodes('b', 'c'));
    const f = doc.floor;
    expect(f.nodes.c).toBeUndefined();
    expect(f.walls.wcd).toMatchObject({ a: 'b', b: 'd' });
    expect(wallsAt(f, 'b').map((w) => w.id)).toEqual(['wab', 'wcd']);
    doc.undo();
    expect(doc.floor.nodes.c).toBeDefined();
    expect(doc.canUndo).toBe(false);
  });

  it('deletes the wall joining the two nodes, with its openings', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(mergeNodes('n1', 'n2'));
    const f = doc.floor;
    expect(f.walls.w1).toBeUndefined();
    expect(f.openings.o1).toBeUndefined();
    expect(f.nodes.n2).toBeUndefined();
    expect(f.walls.w2).toMatchObject({ a: 'n1', b: 'n3' });
    expect(Object.keys(f.rooms)).toEqual(['r1']);
    expect(f.rooms.r1!.walls).toHaveLength(3);
  });

  it('keeps keep when the only wall between the nodes goes', () => {
    const doc = mk(chainFloor());
    doc.execute(mergeNodes('c', 'd'));
    expect(doc.floor.nodes.c).toBeDefined();
    expect(doc.floor.walls.wcd).toBeUndefined();
  });

  it('splits a room when a free wall end lands on the opposite node (identity rule)', () => {
    const floor = oneRoomFloor();
    floor.nodes.n5 = { id: 'n5', x: 2, y: 2 };
    floor.walls.w5 = { id: 'w5', a: 'n1', b: 'n5', thickness: 0.2, height: 3.2 };
    const doc = mk(floor);
    doc.execute(mergeNodes('n3', 'n5'));
    const f = doc.floor;
    expect(f.walls.w5).toMatchObject({ a: 'n1', b: 'n3' });
    expect(Object.keys(f.rooms)).toHaveLength(2);
    expect(f.rooms.r1).toBeDefined();
    expect(f.rooms.r1!.name).toBe('Phòng khách');
  });

  it('resolves duplicate walls: more openings + items wins, then smaller id', () => {
    const floor = oneRoomFloor();
    floor.items.i1 = outlet('i1', 'w2', 1);
    floor.items.i2 = outlet('i2', 'w2', 2);
    floor.items.i3 = outlet('i3', 'w4', 1);
    const doc = mk(floor);
    doc.execute(mergeNodes('n1', 'n3'));
    const f = doc.floor;
    // w1 (1 opening) vs w2 (2 items): w2 survives; w3 (0) vs w4 (1 item): w4 survives.
    expect(f.walls.w1).toBeUndefined();
    expect(f.openings.o1).toBeUndefined();
    expect(f.walls.w2).toMatchObject({ a: 'n2', b: 'n1' });
    expect(Object.keys(f.items).sort()).toEqual(['i1', 'i2', 'i3']);
    expect(f.walls.w3).toBeUndefined();
    expect(f.walls.w4).toBeDefined();
    expect(f.rooms).toEqual({});
  });

  it('ties go to the smaller wall id', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(mergeNodes('n1', 'n3'));
    expect(doc.floor.walls.w1).toBeDefined(); // w1 has o1
    expect(doc.floor.walls.w2).toBeUndefined();
    expect(doc.floor.walls.w3).toBeDefined(); // tie at 0: w3 < w4
    expect(doc.floor.walls.w4).toBeUndefined();
  });

  it('re-fits openings on walls that change length, or rejects', () => {
    const floor: Floor = {
      ...oneRoomFloor(),
      nodes: {
        x: { id: 'x', x: 0, y: 0 },
        y: { id: 'y', x: 3, y: 0 },
        k: { id: 'k', x: 0, y: 0.5 },
      },
      walls: { wx: { id: 'wx', a: 'x', b: 'y', thickness: 0.2, height: 3.2 } },
      openings: { o1: { ...oneRoomFloor().openings.o1!, wall: 'wx', offset: 1.5 } },
      rooms: {},
    };
    const doc = mk(floor);
    expect(codeOf(() => doc.execute(mergeNodes('k', 'y')))).toBe('merge-drops-opening');
  });

  it('rejects merging a node with itself and unknown nodes', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(mergeNodes('n1', 'n1')))).toBe('invalid-target');
    expect(codeOf(() => doc.execute(mergeNodes('n1', 'nope')))).toBe('not-found');
    expect(codeOf(() => doc.execute(mergeNodes('nope', 'n1')))).toBe('not-found');
  });
});

describe('dropNode', () => {
  it('drops onto a node it shares a wall with, in one undo step', () => {
    const floor = chainFloor();
    floor.nodes.c = { id: 'c', x: 3, y: 0.4 };
    floor.nodes.d = { id: 'd', x: 3, y: 3 };
    floor.walls.wbc = { id: 'wbc', a: 'b', b: 'c', thickness: 0.2, height: 3.2 };
    const doc = mk(floor);
    const original = structuredClone(doc.floor);
    doc.execute(dropNode('b', { node: 'c' }));
    const f = doc.floor;
    expect(f.nodes.b).toBeUndefined();
    expect(f.walls.wbc).toBeUndefined();
    expect(f.walls.wab).toMatchObject({ a: 'a', b: 'c' });
    doc.undo();
    expect(doc.floor).toEqual(original);
    expect(doc.canUndo).toBe(false);
  });

  it('drops onto a wall, making a T; the room splits and keeps its id', () => {
    const floor = oneRoomFloor();
    floor.nodes.n5 = { id: 'n5', x: 2, y: 2 };
    floor.walls.w5 = { id: 'w5', a: 'n5', b: 'n4', thickness: 0.2, height: 3.2 };
    const doc = mk(floor);
    doc.execute(dropNode('n5', { wall: 'w1', at: { x: 2, y: 0.05 } }));
    const f = doc.floor;
    expect(f.nodes.n5).toBeUndefined();
    const t = Object.values(f.nodes).find((n) => n.x === 2 && n.y === 0)!;
    expect(t).toBeDefined();
    expect(wallsAt(f, t.id)).toHaveLength(3);
    expect(f.walls.w5).toMatchObject({ a: t.id, b: 'n4' });
    expect(Object.keys(f.rooms)).toHaveLength(2);
    expect(f.rooms.r1).toBeDefined();
    doc.undo();
    expect(doc.floor.nodes.n5).toBeDefined();
    expect(doc.canUndo).toBe(false);
  });

  it('is deterministic when the command object runs twice on the same context', () => {
    const floor = oneRoomFloor();
    floor.nodes.n5 = { id: 'n5', x: 2, y: 2 };
    floor.walls.w5 = { id: 'w5', a: 'n5', b: 'n4', thickness: 0.2, height: 3.2 };
    const cmd = dropNode('n5', { wall: 'w1', at: { x: 2, y: 0 } });
    const ctx = ctxFor(floor, testPresets);
    // new room ids are random, so compare the structural part of the change list
    const structure = (): unknown[] => cmd.run(ctx).filter((c) => c.kind !== 'room');
    expect(structure()).toEqual(structure());
  });

  it('rejects dropping a node on itself or on one of its own walls', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(dropNode('n1', { node: 'n1' })))).toBe('invalid-target');
    expect(codeOf(() => doc.execute(dropNode('n1', { wall: 'w1', at: { x: 2, y: 0 } })))).toBe(
      'invalid-target',
    );
    expect(codeOf(() => doc.execute(dropNode('n1', { wall: 'w4', at: { x: 0, y: 2 } })))).toBe(
      'invalid-target',
    );
  });

  it('throws not-found for missing node or wall', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(dropNode('nope', { node: 'n1' })))).toBe('not-found');
    expect(codeOf(() => doc.execute(dropNode('n1', { node: 'nope' })))).toBe('not-found');
    expect(codeOf(() => doc.execute(dropNode('n1', { wall: 'nope', at: { x: 0, y: 0 } })))).toBe(
      'not-found',
    );
  });
});

describe('diffFloors', () => {
  it('is empty for identical floors', () => {
    const f = twoRoomFloor();
    expect(diffFloors(f, f)).toEqual([]);
    expect(diffFloors(f, structuredClone(f))).toEqual([]);
  });

  it('lists changes in kind order', () => {
    const before = oneRoomFloor();
    const after = structuredClone(before);
    after.rooms.r1!.name = 'x';
    after.columns.c1 = { id: 'c1', x: 1, y: 1, shape: 'round', width: 0.3, rotation: 0 };
    delete after.openings.o1;
    after.nodes.n1!.x = -1;
    expect(diffFloors(before, after).map((c) => `${c.kind}:${c.id}`)).toEqual([
      'node:n1',
      'opening:o1',
      'column:c1',
      'room:r1',
    ]);
  });
});
