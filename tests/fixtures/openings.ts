import type { Floor, Opening, OpeningType, Vec2 } from '../../src/core/types';

/** A lone wall from (0, 0) to `wall.b` (4, 0) with one opening o1, 1.2 wide, centred at 2. */
export function openingFloor(
  over: Partial<Opening> = {},
  wall: { b?: Vec2; thickness?: number; height?: number } = {},
): Floor {
  const { b = { x: 4, y: 0 }, thickness = 0.2, height = 3.2 } = wall;
  return {
    id: 'f',
    level: 0,
    elevation: 0,
    wallHeight: 3.2,
    slabThickness: 0.15,
    nodes: { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', ...b } },
    walls: { w: { id: 'w', a: 'a', b: 'b', thickness, height } },
    openings: {
      o1: {
        id: 'o1',
        wall: 'w',
        preset: 'p',
        offset: 2,
        width: 1.2,
        height: 2.1,
        sill: 0,
        type: 'door-swing',
        hinge: 'a',
        swing: 'left',
        ...over,
      },
    },
    rooms: {},
    items: {},
    columns: {},
    stairs: {},
    roofs: {},
  };
}

const counts = (lo: number, hi: number): Array<Partial<Opening>> =>
  Array.from({ length: hi - lo + 1 }, (_, i) => ({ leaves: lo + i }));

const SHAPES: Array<[OpeningType, Array<Partial<Opening>>]> = [
  ['door-swing', [{}]],
  ['door-double', [{ split: 0.5 }, { split: 0.67 }]],
  ['door-sliding', counts(1, 4)],
  ['door-folding', counts(2, 8)],
  ['door-rolling', [{}]],
  ['opening', [{}]],
  ['window-casement', counts(1, 4)],
  ['window-sliding', counts(2, 4)],
  ['window-awning', counts(1, 4)],
  ['window-fixed', counts(1, 6)],
];

/** Every type with each allowed leaf count, in all four orientations. */
export const OPENING_CASES = SHAPES.flatMap(([type, shapes]) =>
  shapes.flatMap((shape) =>
    (['a', 'b'] as const).flatMap((hinge) =>
      (['left', 'right'] as const).map((swing) => ({
        name: [type, shape.leaves ?? shape.split, hinge, swing].filter(Boolean).join(' '),
        over: {
          type,
          ...shape,
          hinge,
          swing,
          ...(type.startsWith('window') ? { sill: 0.9, height: 1.4 } : {}),
        },
      })),
    ),
  ),
);
