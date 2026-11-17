import type { Floor, PlanNode, PresetInfo, PresetResolver, Wall } from '../../src/core/types';

const node = (id: string, x: number, y: number): PlanNode => ({ id, x, y });
const wall = (id: string, a: string, b: string): Wall => ({
  id,
  a,
  b,
  thickness: 0.2,
  height: 3.2,
});

function byId<T extends { id: string }>(list: T[]): Record<string, T> {
  return Object.fromEntries(list.map((e) => [e.id, e]));
}

export function oneRoomFloor(): Floor {
  return {
    id: 'f1',
    level: 0,
    elevation: 0,
    wallHeight: 3.2,
    slabThickness: 0.15,
    nodes: byId([node('n1', 0, 0), node('n2', 4, 0), node('n3', 4, 4), node('n4', 0, 4)]),
    walls: byId([
      wall('w1', 'n1', 'n2'),
      wall('w2', 'n2', 'n3'),
      wall('w3', 'n3', 'n4'),
      wall('w4', 'n4', 'n1'),
    ]),
    openings: byId([
      {
        id: 'o1',
        wall: 'w1',
        preset: 'door-single-01',
        offset: 1.2,
        width: 0.9,
        height: 2.1,
        sill: 0,
        flip: false,
      },
    ]),
    rooms: byId([{ id: 'r1', walls: ['w1', 'w2', 'w3', 'w4'], name: 'Phòng khách' }]),
    items: {},
    columns: {},
  };
}

export function twoRoomFloor(): Floor {
  return {
    id: 'f1',
    level: 0,
    elevation: 0,
    wallHeight: 3.2,
    slabThickness: 0.15,
    nodes: byId([
      node('n1', 0, 0),
      node('n2', 4, 0),
      node('n3', 8, 0),
      node('n4', 8, 4),
      node('n5', 4, 4),
      node('n6', 0, 4),
    ]),
    walls: byId([
      wall('w1', 'n1', 'n2'),
      wall('w2', 'n2', 'n3'),
      wall('w3', 'n3', 'n4'),
      wall('w4', 'n4', 'n5'),
      wall('w5', 'n5', 'n6'),
      wall('w6', 'n6', 'n1'),
      wall('w7', 'n2', 'n5'),
    ]),
    openings: {},
    rooms: byId([
      { id: 'r1', walls: ['w1', 'w7', 'w5', 'w6'], name: 'Room 1' },
      { id: 'r2', walls: ['w2', 'w3', 'w4', 'w7'], name: 'Room 2' },
    ]),
    items: {},
    columns: {},
  };
}

const presets: Record<string, PresetInfo> = {
  'door-single-01': { mount: 'opening', footprint: { w: 0.9, d: 0.05, h: 2.1 }, sill: 0 },
  'window-01': { mount: 'opening', footprint: { w: 1.2, d: 0.05, h: 1.4 }, sill: 0.9 },
  'sofa-3s-01': { mount: 'floor', footprint: { w: 2.1, d: 0.9, h: 0.85 } },
  'bed-01': { mount: 'floor', footprint: { w: 1.6, d: 2.0, h: 0.5 } },
  'rug-01': { mount: 'floor', footprint: { w: 2, d: 1.5, h: 0.01 }, layer: 'covering' },
  'outlet-01': { mount: 'wall', footprint: { w: 0.08, d: 0.02, h: 0.08 } },
  'lamp-01': { mount: 'ceiling', footprint: { w: 0.4, d: 0.4, h: 0.3 } },
};

export const testPresets: PresetResolver = (id) => {
  const p = presets[id];
  return p ? { ...p, footprint: { ...p.footprint } } : undefined;
};

/** A 10 x 10 room (r1, walls w1-w4) with a 2 x 2 hole (walls hw0-hw3, clockwise) at its centre. */
export function holedRoomFloor(): Floor {
  const f = oneRoomFloor();
  f.openings = {};
  [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ].forEach(([x, y], i) => (f.nodes[`n${i + 1}`] = { id: `n${i + 1}`, x: x!, y: y! }));
  const ring = [
    [4, 4],
    [4, 6],
    [6, 6],
    [6, 4],
  ];
  ring.forEach(([x, y], i) => (f.nodes[`hn${i}`] = { id: `hn${i}`, x: x!, y: y! }));
  ring.forEach((_, i) => {
    const id = `hw${i}`;
    f.walls[id] = wall(id, `hn${i}`, `hn${(i + 1) % 4}`);
  });
  f.rooms.r1!.holes = [['hw0', 'hw1', 'hw2', 'hw3']];
  return f;
}
