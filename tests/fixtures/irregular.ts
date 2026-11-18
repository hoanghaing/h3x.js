import type { Floor, PlanNode, Wall } from '../../src/core/types';
import { detectRooms } from '../../src/core/rooms/detect';

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** A floor whose walls trace each ring (0.2 thick, 3 high); rooms come from detectRooms. */
function floorOfRings(rings: [number, number][][], extra: [string, string][] = []): Floor {
  const nodes: Record<string, PlanNode> = {};
  const walls: Record<string, Wall> = {};
  const addWall = (a: string, b: string): void => {
    const id = `w${Object.keys(walls).length + 1}`;
    walls[id] = { id, a, b, thickness: 0.2, height: 3 };
  };
  rings.forEach((ring, r) => {
    ring.forEach(([x, y], i) => {
      const id = `n${r}_${i}`;
      nodes[id] = { id, x, y };
    });
    ring.forEach((_, i) => addWall(`n${r}_${i}`, `n${r}_${(i + 1) % ring.length}`));
  });
  extra.forEach(([a, b]) => addWall(a, b));
  const floor: Floor = {
    id: 'f1',
    level: 0,
    elevation: 0,
    wallHeight: 3,
    slabThickness: 0.15,
    nodes,
    walls,
    openings: {},
    rooms: {},
    items: {},
    columns: {},
    stairs: {},
  };
  detectRooms(floor).forEach((d, i) => {
    floor.rooms[`r${i + 1}`] = { id: `r${i + 1}`, walls: d.walls, name: `Room ${i + 1}` };
  });
  return floor;
}

/** Front 5 m, depth 18 m, rear side skewed 15 degrees. */
export function trapezoidFloor(): Floor {
  return floorOfRings([
    [
      [0, 0],
      [5, 0],
      [5, 18],
      [0, 18 + 5 * Math.tan(rad(15))],
    ],
  ]);
}

/** A triangle with one 25 degree corner at the origin. */
export function acuteFloor(): Floor {
  return floorOfRings([
    [
      [0, 0],
      [10, 0],
      [10, 10 * Math.tan(rad(25))],
    ],
  ]);
}

export function lFloor(): Floor {
  return floorOfRings([
    [
      [0, 0],
      [8, 0],
      [8, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ],
  ]);
}

/** An L whose upper arm leans 20 degrees off vertical. */
export function skewLFloor(): Floor {
  const dx = 9.4 * Math.tan(rad(20));
  return floorOfRings([
    [
      [0, 0],
      [8, 0],
      [8, 4],
      [4, 4],
      [4 + dx, 13.4],
      [dx, 13.4],
      [0, 4],
    ],
  ]);
}

export function uFloor(): Floor {
  return floorOfRings([
    [
      [0, 0],
      [9, 0],
      [9, 8],
      [6, 8],
      [6, 3],
      [3, 3],
      [3, 8],
      [0, 8],
    ],
  ]);
}

export function tFloor(): Floor {
  return floorOfRings([
    [
      [0, 0],
      [9, 0],
      [9, 3],
      [6, 3],
      [6, 8],
      [3, 8],
      [3, 3],
      [0, 3],
    ],
  ]);
}

/** Four rooms in a ring around a 2 x 3 m light well (the well itself is not a room). */
export function courtyardFloor(): Floor {
  const floor = floorOfRings(
    [
      [
        [0, 0],
        [8, 0],
        [8, 9],
        [0, 9],
      ],
      [
        [3, 3],
        [5, 3],
        [5, 6],
        [3, 6],
      ],
    ],
    [
      ['n0_0', 'n1_0'],
      ['n0_1', 'n1_1'],
      ['n0_2', 'n1_2'],
      ['n0_3', 'n1_3'],
    ],
  );
  for (const room of Object.values(floor.rooms)) {
    const onlyWell = room.walls.every((w) => floor.walls[w]?.a.startsWith('n1_'));
    if (onlyWell) delete floor.rooms[room.id];
  }
  return floor;
}

/** 4 x 20 m with the rear edge skewed 10 degrees. */
export function narrowTownhouseFloor(): Floor {
  return floorOfRings([
    [
      [0, 0],
      [4, 0],
      [4, 20],
      [0, 20 + 4 * Math.tan(rad(10))],
    ],
  ]);
}

export function pentagonFloor(): Floor {
  return floorOfRings([
    Array.from({ length: 5 }, (_, i): [number, number] => [
      5 * Math.cos(rad(90 + 72 * i)),
      5 * Math.sin(rad(90 + 72 * i)),
    ]),
  ]);
}

export const irregularFixtures: Record<string, () => Floor> = {
  trapezoidFloor,
  acuteFloor,
  lFloor,
  skewLFloor,
  uFloor,
  tFloor,
  courtyardFloor,
  narrowTownhouseFloor,
  pentagonFloor,
};
