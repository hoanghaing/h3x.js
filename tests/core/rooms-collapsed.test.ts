// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { addWall, H3xDocument, moveNode } from '../../src/core';
import { detectRooms, roomArea, roomPolygon } from '../../src/core/rooms/detect';
import { uncoveredArea } from '../../src/core/geometry/clip';
import { isSimple, signedArea } from '../../src/core/geometry/polygon';
import { wallOutlines } from '../../src/core/shapes';
import { computeJoins } from '../../src/core/walls/joins';
import type { Floor, Vec2 } from '../../src/core/types';
import { oneRoomFloor } from '../fixtures/floors';

/** Walls w<i> from pts[i] to pts[i + 1], listed counter-clockwise; room `r` uses all of them. */
function ringFloor(pts: Array<[number, number]>, thickness: number[] = []): Floor {
  const f = oneRoomFloor();
  f.nodes = {};
  f.walls = {};
  f.openings = {};
  pts.forEach(([x, y], i) => {
    f.nodes[`n${i}`] = { id: `n${i}`, x, y };
    f.walls[`w${i}`] = {
      id: `w${i}`,
      a: `n${i}`,
      b: `n${(i + 1) % pts.length}`,
      thickness: thickness[i] ?? 0.2,
      height: 3,
    };
  });
  f.rooms = { r: { id: 'r', name: '', walls: pts.map((_, i) => `w${i}`) } };
  return f;
}

/** Floor of room `r` that the drawn walls (outlines and junction fills) and holes leave free. */
function drawnFloor(f: Floor): number {
  const room = f.rooms.r!;
  const holes = (room.holes ?? []).map((walls) => roomPolygon(f, { ...room, walls }, 'center'));
  const junctions = Object.values(computeJoins(f).junctions).map((j) => j.points);
  return uncoveredArea(roomPolygon(f, { ...room, holes: [] }, 'center'), [
    ...holes,
    ...Object.values(wallOutlines(f)),
    ...junctions,
  ]);
}

const collapsed: Array<[string, Array<[number, number]>, number[]?]> = [
  [
    'triangle rounded to 4 decimals',
    [
      [4.5, 12.4],
      [4.4048, 12.0861],
      [3.0216, 7.5251],
    ],
    [0.2, 0.1, 0.1],
  ],
  [
    'triangle with an inradius of half the inset',
    [
      [0, 0],
      [20, 0],
      [10, 0.1],
    ],
  ],
  [
    'triangle thinner still',
    [
      [0, 0],
      [20, 0],
      [10, 0.04],
    ],
  ],
  [
    'rhombus',
    [
      [0, 0],
      [10, -0.03],
      [20, 0],
      [10, 0.03],
    ],
  ],
  [
    'pentagon',
    [
      [0, 0],
      [10, -0.02],
      [20, 0],
      [15, 0.02],
      [5, 0.02],
    ],
  ],
  [
    'strip along collinear walls of unequal thickness',
    [
      [0, 0],
      [0.3, 0],
      [20.3, 0],
      [20.6, 0],
      [20.6, 0.34],
      [0, 0.34],
    ],
    [0.1, 0.5, 0.1, 0.2, 0.2, 0.2],
  ],
  [
    'strip under a thick wall with a thin continuation',
    [
      [0, 0],
      [20, 0],
      [20.3, 0],
      [20.3, 0.5],
      [0, 0.5],
    ],
    [0.9, 0.1, 0.1, 0.1, 0.1],
  ],
];

describe('rooms narrower than their walls', () => {
  it.each(collapsed)('%s: no room is detected', (_, pts, thickness) => {
    expect(detectRooms(ringFloor(pts, thickness))).toEqual([]);
  });

  it.each(collapsed)('%s: a stored room has no inner area', (_, pts, thickness) => {
    const f = ringFloor(pts, thickness);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeLessThan(0.999);
  });

  it('a collapsed spike does not add to the area of the room it hangs off', () => {
    const f = ringFloor([
      [0, 0],
      [5, 0],
      [5, 2.49],
      [15, 2.5],
      [5, 2.51],
      [5, 5],
      [0, 5],
    ]);
    expect(detectRooms(f)).toHaveLength(1);
    const area = roomArea(f, f.rooms.r!, 'inner');
    // Inside the square's inner faces, plus at most the mouth of the spike.
    expect(area).toBeGreaterThanOrEqual(4.8 * 4.8 - 1e-6);
    expect(area).toBeLessThan(4.8 * 4.8 + 0.01);
  });

  it('a room with a chamfer shorter than the inset keeps its area', () => {
    const f = ringFloor([
      [0, 0],
      [4, 0],
      [4, 2.95],
      [3.95, 3],
      [0, 3],
    ]);
    expect(detectRooms(f)).toHaveLength(1);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(3.8 * 2.8, 2);
  });

  const triangle = (): { doc: H3xDocument; apex: string } => {
    const doc = H3xDocument.create();
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 4 },
    ];
    pts.forEach((at, i) =>
      doc.execute(addWall({ from: { at }, to: { at: pts[(i + 1) % 3]! }, thickness: 0.2 })),
    );
    return { doc, apex: Object.values(doc.floor.nodes).find((n) => n.y === 4)!.id };
  };

  it.each([0.16, 0.1, 0.04, 0.02])('rejects a drag that flattens a room to %s m', (y) => {
    const { doc, apex } = triangle();
    const before = doc.toXML();
    const res = doc.tryExecute(moveNode(apex, { x: 10, y }));
    expect(res.ok ? [] : res.issues.map((i) => i.code)).toContain('room-degenerate');
    expect(doc.toXML()).toBe(before);
  });

  it('loads a saved sliver of walls without a room', () => {
    const xml = `<h3x version="1" unit="m"><floor id="f1" level="0" wallHeight="3">
      <node id="n0" x="4.5" y="12.4"/><node id="n1" x="4.4048" y="12.0861"/>
      <node id="n2" x="3.0216" y="7.5251"/>
      <wall id="a" a="n0" b="n1" thickness="0.2" height="3"/>
      <wall id="b" a="n1" b="n2" thickness="0.1" height="3"/>
      <wall id="c" a="n2" b="n0" thickness="0.1" height="3"/>
    </floor></h3x>`;
    expect(Object.keys(H3xDocument.fromXML(xml).floor.rooms)).toEqual([]);
  });

  it('reports a collapsed room stored in a file', () => {
    const xml = `<h3x version="1" unit="m"><floor id="f1" level="0" wallHeight="3">
      <node id="n0" x="0" y="0"/><node id="n1" x="20" y="0"/><node id="n2" x="10" y="0.04"/>
      <wall id="a" a="n0" b="n1" thickness="0.2" height="3"/>
      <wall id="b" a="n1" b="n2" thickness="0.2" height="3"/>
      <wall id="c" a="n2" b="n0" thickness="0.2" height="3"/>
      <room id="r" walls="a b c" name=""/>
    </floor></h3x>`;
    const codes = H3xDocument.fromXML(xml)
      .validateLayout()
      .map((i) => i.code);
    expect(codes).toContain('room-degenerate');
  });
});

describe('walls of unequal thickness in one straight line', () => {
  /** A 10 x 3 room whose bottom side is a 0.4 and a 0.1 wall meeting at (5, bend). */
  const split = (bend: number): Floor =>
    ringFloor(
      [
        [0, 0],
        [5, bend],
        [10, 0],
        [10, 3],
        [0, 3],
      ],
      [0.4, 0.1, 0.2, 0.2, 0.2],
    );
  // 9.8 wide, inner faces at y 0.2 up to x = 5 and 0.05 after it, up to y 2.9.
  const area = 4.9 * 2.7 + 4.9 * 2.85;

  it.each([0, 1e-4, -1e-4, 1e-12, -1e-12])('bend %s: the room follows the wall faces', (bend) => {
    const f = split(bend);
    expect(detectRooms(f)).toHaveLength(1);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(area, 2);
    const outline = roomPolygon(f, f.rooms.r!, 'inner');
    expect(signedArea(outline)).toBeCloseTo(area, 2);
    const faces = Object.values(computeJoins(f).corners).flatMap((c) => Object.values(c) as Vec2[]);
    for (const p of outline) {
      const gap = Math.min(...faces.map((q) => Math.hypot(p.x - q.x, p.y - q.y)));
      expect(gap).toBeLessThan(1e-6);
    }
  });

  it('keeps rotated rooms through rounding to 4 decimals', () => {
    for (let deg = 0; deg < 360; deg += 1) {
      const t = (deg * Math.PI) / 180;
      const pts = [
        [0, 0],
        [2.3, 0],
        [6, 0],
        [6, 4],
        [0, 4],
      ].map(([x, y]): [number, number] => [
        +(x! * Math.cos(t) - y! * Math.sin(t)).toFixed(4),
        +(x! * Math.sin(t) + y! * Math.cos(t)).toFixed(4),
      ]);
      const f = ringFloor(pts, [0.2, 0.1, 0.2, 0.2, 0.2]);
      const want = 2.2 * 3.8 + 3.6 * 3.85;
      expect(detectRooms(f), `${deg} degrees`).toHaveLength(1);
      expect(signedArea(roomPolygon(f, f.rooms.r!, 'inner')), `${deg} degrees`).toBeCloseTo(
        want,
        1,
      );
    }
  });
});

describe('holes narrower than their walls', () => {
  function withBlock(outer: Array<[number, number]>, block: Array<[number, number]>): Floor {
    const f = ringFloor(outer);
    block.forEach(([x, y], i) => {
      f.nodes[`b${i}`] = { id: `b${i}`, x, y };
      f.walls[`h${i}`] = {
        id: `h${i}`,
        a: `b${i}`,
        b: `b${(i + 1) % block.length}`,
        thickness: 0.2,
        height: 3,
      };
    });
    f.rooms.r!.holes = [block.map((_, i) => `h${i}`)];
    return f;
  }
  const square: Array<[number, number]> = [
    [0, 0],
    [12, 0],
    [12, 12],
    [0, 12],
  ];

  it('a notched block filling a room leaves no room around it', () => {
    const f = withBlock(square, [
      [0.19, 0.19],
      [0.19, 11.81],
      [11.81, 11.81],
      [11.81, 6.005],
      [3.81, 6],
      [11.81, 5.995],
      [11.81, 0.19],
    ]);
    expect(detectRooms(f).filter((r) => r.holes.length > 0)).toEqual([]);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeLessThan(0.999);
  });

  it('a notch in a block does not add floor to the room around it', () => {
    const f = withBlock(square, [
      [2, 2],
      [2, 10],
      [10, 10],
      [10, 6.01],
      [3, 6],
      [10, 5.99],
      [10, 2],
    ]);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeLessThanOrEqual(11.8 * 11.8 - 8.2 * 8.2 + 0.2);
  });
});

describe('inner area of nearly collapsed rooms', () => {
  it.each<[string, Array<[number, number]>, number[]]>([
    [
      'inside out',
      [
        [3.67, 0.041],
        [1.2, 0.172],
        [-7.79, 0.104],
        [-4.13, -0.055],
        [-1.28, -0.09],
        [9.47, -0.033],
      ],
      [0.4, 0.1, 0.4, 0.4, 0.4, 0.4],
    ],
    [
      'two corners in one place',
      [
        [0, 0],
        [20, 0],
        [10, 0.04],
        [10, 0.04],
      ],
      [0.2, 0.2, 0.2, 0.2],
    ],
    [
      'intact',
      [
        [1.18, 0.358],
        [-0.58, 0.631],
        [-1.04, -0.066],
        [-1.26, -0.277],
        [0.61, -0.222],
      ],
      [0.1, 0.4, 0.2, 0.1, 0.1],
    ],
    [
      'inside out with floor left',
      [
        [8.17, 0.058],
        [2.3, 0.151],
        [-5.57, 0.21],
        [-7.52, -0.035],
        [-2.38, -0.209],
        [2.09, -0.168],
        [6.82, -0.075],
      ],
      [0.4, 0.1, 0.4, 0.4, 0.2, 0.4, 0.1],
    ],
    [
      'each wall covers half its own thickness',
      [
        [9.64, 0.051],
        [-5.63, 0.12],
        [-7.65, -0.224],
        [4.4, -0.164],
      ],
      [0.1, 0.4, 0.1, 0.4],
    ],
    [
      'crossing wall halves',
      [
        [4.5, 0.316],
        [-2.99, 0.077],
        [-2.28, -0.167],
        [0.47, -0.676],
      ],
      [0.4, 0.1, 0.2, 0.4],
    ],
  ])('%s', (_, pts, thickness) => {
    const f = ringFloor(pts, thickness);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(drawnFloor(f), 6);
  });
});

describe('the inner area is the floor the drawn walls leave free', () => {
  it('stays negative for a flipped outline thrown beyond its centre line', () => {
    const f = ringFloor(
      [
        [0, 0],
        [6, 1e-8],
        [2, 0],
      ],
      [0.2, 0.4, 0.2],
    );
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeLessThan(0);
  });

  it('a room keeps its floor beside a stretch that is all wall', () => {
    const f = ringFloor(
      [
        [0, 0],
        [6, 0],
        [7.3, 0],
        [7.3, 1.1],
        [6, 1.1],
        [6, 0.3],
        [0, 0.3],
      ],
      [0.5, 0.1, 0.1, 0.1, 0.1, 0.2, 0.2],
    );
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(1.2075, 4);
    expect(detectRooms(f)).toHaveLength(1);
  });

  it('a sharp block does not take floor from the room around it', () => {
    const f = ringFloor([
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ]);
    const block = [
      [3, 2],
      [5, 2.01],
      [7, 2],
    ];
    block.forEach(([x, y], i) => {
      f.nodes[`b${i}`] = { id: `b${i}`, x: x!, y: y! };
      f.walls[`h${i}`] = {
        id: `h${i}`,
        a: `b${i}`,
        b: `b${(i + 1) % 3}`,
        thickness: 0.2,
        height: 3,
      };
    });
    f.rooms.r!.holes = [['h0', 'h1', 'h2']];
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(drawnFloor(f), 2);
    expect(detectRooms(f).filter((r) => r.holes.length > 0)).toHaveLength(1);
  });

  it('stays negative for a flipped room with a collapsed corner', () => {
    const f = ringFloor([
      [0, 0],
      [0, 4],
      [3.95, 4],
      [4, 3.95],
      [4, 0],
    ]);
    f.walls.w2!.thickness = 0.6;
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeLessThan(0);
  });

  const withBlocks = (...blocks: Array<Array<[number, number]>>): Floor => {
    const f = ringFloor([
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ]);
    f.rooms.r!.holes = blocks.map((block, k) =>
      block.map(([x, y], i) => {
        f.nodes[`b${k}_${i}`] = { id: `b${k}_${i}`, x, y };
        f.walls[`h${k}_${i}`] = {
          id: `h${k}_${i}`,
          a: `b${k}_${i}`,
          b: `b${k}_${(i + 1) % block.length}`,
          thickness: 0.2,
          height: 3,
        };
        return `h${k}_${i}`;
      }),
    );
    return f;
  };
  const box = (x: number, y: number, w: number, h: number): Array<[number, number]> => [
    [x, y],
    [x, y + h],
    [x + w, y + h],
    [x + w, y],
  ];

  it('a block whose wall merges with the room wall', () => {
    const f = withBlocks(box(3, 0.15, 2, 1));
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(drawnFloor(f), 6);
  });

  it('two blocks whose walls merge', () => {
    const f = withBlocks(box(2, 1, 2, 2), box(4.15, 1, 2, 2));
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(drawnFloor(f), 6);
  });

  it('the fill of a bevelled block tip is not floor', () => {
    const f = withBlocks(box(3, 0.15, 2, 1), [
      [6, 2],
      [8, 2.3],
      [8, 1.7],
    ]);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(drawnFloor(f), 6);
  });

  it('matches the drawn walls on random rooms, wide and collapsed', () => {
    let seed = 7;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    let checked = 0;
    for (let k = 0; k < 4000; k++) {
      const n = 3 + Math.floor(random() * 6);
      const size = 1 + random() * 14;
      const squash = [1, 0.3, 0.1, 0.03, 0.005][k % 5]!;
      const pts = Array.from({ length: n }, (_, i): [number, number] => {
        const t = ((i + random() * 0.9) / n) * 2 * Math.PI;
        const r = 0.3 + random() * 0.7;
        return [Math.cos(t) * r * size, Math.sin(t) * r * size * squash];
      });
      const v = pts.map(([x, y]) => ({ x, y }));
      if (signedArea(v) <= 1e-6 || !isSimple(v)) continue;
      if (v.some((p, i) => Math.hypot(v[(i + 1) % n]!.x - p.x, v[(i + 1) % n]!.y - p.y) < 0.3)) {
        continue;
      }
      const f = ringFloor(
        pts,
        pts.map(() => [0.1, 0.2, 0.22, 0.4][Math.floor(random() * 4)]!),
      );
      const error = Math.abs(roomArea(f, f.rooms.r!, 'inner') - drawnFloor(f));
      // Not a bound in general: at very sharp tips the square wall ends reach past the mitred
      // outline. The bound holds for this seed and family of shapes.
      expect(error, JSON.stringify(pts)).toBeLessThan(0.02);
      checked++;
    }
    expect(checked).toBeGreaterThan(2000);
  });
});
