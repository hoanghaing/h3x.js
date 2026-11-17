import { describe, expect, it } from 'vitest';
import type { EntityChange } from '../../src/core/document/changes';
import { syncRooms } from '../../src/core/rooms/sync';
import type { Floor, Room } from '../../src/core/types';
import { oneRoomFloor } from '../fixtures/floors';

/** Hand-built floor: nodes by coordinates, walls by node pair. */
function floor(
  nodes: Record<string, [number, number]>,
  walls: Record<string, [string, string]>,
  rooms: Room[] = [],
): Floor {
  return {
    id: 'f1',
    level: 0,
    elevation: 0,
    wallHeight: 3.2,
    slabThickness: 0.15,
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, [x, y]]) => [id, { id, x, y }])),
    walls: Object.fromEntries(
      Object.entries(walls).map(([id, [a, b]]) => [id, { id, a, b, thickness: 0.2, height: 3.2 }]),
    ),
    openings: {},
    rooms: Object.fromEntries(rooms.map((r) => [r.id, r])),
    items: {},
    columns: {},
  };
}

/** Rotates a loop so it starts at its smallest id (cycle-insensitive comparison). */
const cycle = (loop: string[]): string[] => {
  const i = loop.indexOf([...loop].sort()[0]!);
  return [...loop.slice(i), ...loop.slice(0, i)];
};

const roomChange = (changes: EntityChange[], id: string) => {
  const c = changes.find((x) => x.kind === 'room' && x.id === id);
  if (!c || c.kind !== 'room') throw new Error(`no change for ${id}`);
  return c;
};

const created = (changes: EntityChange[]): Room[] =>
  changes.flatMap((c) => (c.kind === 'room' && c.before === null && c.after ? [c.after] : []));

/** Square of side `s` at (x, y): nodes `${p}_0..3`, CCW walls `${p}0..3`. */
function square(
  nodes: Record<string, [number, number]>,
  walls: Record<string, [string, string]>,
  p: string,
  x: number,
  y: number,
  s: number,
): void {
  const corners: Array<[number, number]> = [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
  ];
  corners.forEach((c, i) => (nodes[`${p}_${i}`] = c));
  for (let i = 0; i < 4; i++) walls[`${p}${i}`] = [`${p}_${i}`, `${p}_${(i + 1) % 4}`];
}

/** 10x10 room `O` with a 2x2 box (room `B`) standing inside it as a hole. */
function holeFloor(): Floor {
  const nodes: Record<string, [number, number]> = {};
  const walls: Record<string, [string, string]> = {};
  square(nodes, walls, 'o', 0, 0, 10);
  square(nodes, walls, 'b', 4, 4, 2);
  return floor(nodes, walls, [
    {
      id: 'O',
      name: 'Hall',
      floorFinish: 'oak',
      walls: ['o0', 'o1', 'o2', 'o3'],
      holes: [['b3', 'b2', 'b1', 'b0']],
    },
    { id: 'B', name: 'Box', floorFinish: 'tile', walls: ['b0', 'b1', 'b2', 'b3'] },
  ]);
}

describe('syncRooms', () => {
  it('same face keeps identity', () => {
    const before = oneRoomFloor();
    before.rooms.r1!.floorFinish = 'oak';
    const after = structuredClone(before);
    after.nodes.n5 = { id: 'n5', x: 2, y: 0 };
    after.walls.w1 = { ...after.walls.w1!, b: 'n5' };
    after.walls.w9 = { id: 'w9', a: 'n5', b: 'n2', thickness: 0.2, height: 3.2 };
    const snapshot = structuredClone(before);

    const changes = syncRooms(before, after);

    expect(changes).toHaveLength(1);
    const c = roomChange(changes, 'r1');
    expect(c.before).toEqual(before.rooms.r1);
    expect(c.after).toMatchObject({ id: 'r1', name: 'Phòng khách', floorFinish: 'oak' });
    expect(cycle(c.after!.walls)).toEqual(cycle(['w1', 'w9', 'w2', 'w3', 'w4']));
    expect(c.after).not.toHaveProperty('holes');
    expect(before).toEqual(snapshot);
  });

  it('split room', () => {
    const before = floor(
      { a: [0, 0], b: [4, 0], c: [4, 6], d: [0, 6] },
      { s1: ['a', 'b'], s2: ['b', 'c'], s3: ['c', 'd'], s4: ['d', 'a'] },
      [{ id: 'r1', name: 'Hall', floorFinish: 'tile', walls: ['s1', 's2', 's3', 's4'] }],
    );
    const after = floor(
      { a: [0, 0], b: [4, 0], c: [4, 6], d: [0, 6], e: [4, 4], f: [0, 4] },
      {
        s1: ['a', 'b'],
        s2: ['b', 'e'],
        s5: ['e', 'c'],
        s3: ['c', 'd'],
        s4: ['d', 'f'],
        s6: ['f', 'a'],
        s7: ['e', 'f'],
      },
      Object.values(before.rooms),
    );

    const changes = syncRooms(before, after);

    expect(changes).toHaveLength(2);
    const kept = roomChange(changes, 'r1');
    expect(kept.after).toMatchObject({ name: 'Hall', floorFinish: 'tile' });
    expect(cycle(kept.after!.walls)).toEqual(cycle(['s1', 's2', 's7', 's6']));
    const [fresh] = created(changes);
    expect(fresh).toMatchObject({ name: '', floorFinish: 'tile' });
    expect(fresh!.id).not.toBe('r1');
    expect(cycle(fresh!.walls)).toEqual(cycle(['s5', 's3', 's4', 's7']));
  });

  it('merged rooms', () => {
    const nodes: Record<string, [number, number]> = {
      n1: [0, 0],
      n2: [4, 0],
      n3: [6, 0],
      n4: [6, 4],
      n5: [4, 4],
      n6: [0, 4],
    };
    const outer: Record<string, [string, string]> = {
      w1: ['n1', 'n2'],
      w2: ['n2', 'n3'],
      w3: ['n3', 'n4'],
      w4: ['n4', 'n5'],
      w5: ['n5', 'n6'],
      w6: ['n6', 'n1'],
    };
    const before = floor(nodes, { ...outer, w7: ['n2', 'n5'] }, [
      { id: 'big', name: 'Big', floorFinish: 'oak', walls: ['w1', 'w7', 'w5', 'w6'] },
      { id: 'small', name: 'Small', walls: ['w2', 'w3', 'w4', 'w7'] },
    ]);
    const after = floor(nodes, outer, Object.values(structuredClone(before.rooms)));

    const changes = syncRooms(before, after);

    expect(changes).toHaveLength(2);
    const big = roomChange(changes, 'big');
    expect(big.after).toMatchObject({ id: 'big', name: 'Big', floorFinish: 'oak' });
    expect(cycle(big.after!.walls)).toEqual(cycle(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']));
    const small = roomChange(changes, 'small');
    expect(small.before).toEqual(before.rooms.small);
    expect(small.after).toBeNull();
  });

  it('new face', () => {
    const before = oneRoomFloor();
    before.rooms = {};

    const changes = syncRooms(before, structuredClone(before));

    expect(changes).toHaveLength(1);
    const [room] = created(changes);
    expect(room!.name).toBe('');
    expect(room).not.toHaveProperty('floorFinish');
    expect(room).not.toHaveProperty('holes');
    expect(cycle(room!.walls)).toEqual(['w1', 'w2', 'w3', 'w4']);
  });

  it('loaded room that is not a face is deleted', () => {
    const before = oneRoomFloor();
    // An open loop, and a second room on r1's face (r1 has the smaller id and wins).
    before.rooms.broken = { id: 'broken', name: 'Broken', walls: ['w1', 'w2', 'missing'] };
    before.rooms.r1copy = { id: 'r1copy', name: 'Copy', walls: ['w1', 'w2', 'w3', 'w4'] };

    const changes = syncRooms(before, structuredClone(before));

    expect(changes.map((c) => [c.id, c.after])).toEqual([
      ['broken', null],
      ['r1copy', null],
    ]);
  });

  it('hole does not steal identity', () => {
    const before = holeFloor();
    const after = structuredClone(before);
    after.nodes.o_9 = { id: 'o_9', x: 5, y: 0 };
    after.walls.o0 = { ...after.walls.o0!, b: 'o_9' };
    after.walls.o9 = { id: 'o9', a: 'o_9', b: 'o_1', thickness: 0.2, height: 3.2 };

    const changes = syncRooms(before, after);

    expect(changes).toHaveLength(1);
    const o = roomChange(changes, 'O');
    expect(o.after).toMatchObject({ name: 'Hall', floorFinish: 'oak' });
    expect(cycle(o.after!.walls)).toEqual(cycle(['o0', 'o9', 'o1', 'o2', 'o3']));
    expect(o.after!.holes).toEqual([['b3', 'b2', 'b1', 'b0']]);
  });

  it('no-op', () => {
    const rotated = oneRoomFloor();
    rotated.rooms.r1!.walls = ['w3', 'w4', 'w1', 'w2'];
    const holes = holeFloor();
    holes.rooms.O!.holes = [['b1', 'b0', 'b3', 'b2']];
    for (const f of [oneRoomFloor(), rotated, holes]) {
      expect(syncRooms(f, f)).toEqual([]);
      expect(syncRooms(f, structuredClone(f))).toEqual([]);
    }
  });
});
