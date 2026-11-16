import { describe, expect, it } from 'vitest';
import { H3xValidationError } from '../../src/core/errors';
import { signedArea } from '../../src/core/geometry/polygon';
import {
  detectRooms,
  roomArea,
  roomNodeLoop,
  roomPolygon,
  roomShape,
} from '../../src/core/rooms/detect';
import type { DetectedRoom } from '../../src/core/rooms/detect';
import type { Floor } from '../../src/core/types';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';

const sorted = (a: string[]): string[] => [...a].sort();

/** Square room `o` of the given size at the origin plus free-standing square boxes. */
function boxFloor(
  size: number,
  boxes: Array<{ prefix: string; x: number; y: number; size: number }>,
): Floor {
  const floor = oneRoomFloor();
  floor.nodes = {};
  floor.walls = {};
  floor.rooms = {};
  floor.openings = {};
  const square = (prefix: string, x: number, y: number, s: number): void => {
    const corners = [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
    ] as const;
    corners.forEach(([cx, cy], i) => {
      floor.nodes[`${prefix}_${i}`] = { id: `${prefix}_${i}`, x: cx, y: cy };
    });
    for (let i = 0; i < 4; i++) {
      floor.walls[`${prefix}${i}`] = {
        id: `${prefix}${i}`,
        a: `${prefix}_${i}`,
        b: `${prefix}_${(i + 1) % 4}`,
        thickness: 0.2,
        height: 3.2,
      };
    }
  };
  square('o', 0, 0, size);
  for (const b of boxes) square(b.prefix, b.x, b.y, b.size);
  return floor;
}

const faceWith = (faces: DetectedRoom[], wall: string): DetectedRoom => {
  const f = faces.find((x) => x.walls.includes(wall));
  if (!f) throw new Error(`no face with ${wall}`);
  return f;
};

const loopArea = (floor: Floor, walls: string[]): number =>
  signedArea(roomNodeLoop(floor, { id: 'x', name: '', walls }).map((id) => floor.nodes[id]!));

describe('detectRooms', () => {
  it('finds one face in a single room', () => {
    const faces = detectRooms(oneRoomFloor());
    expect(faces).toHaveLength(1);
    expect(sorted(faces[0]!.walls)).toEqual(['w1', 'w2', 'w3', 'w4']);
  });

  it('finds two faces in a two-room floor', () => {
    const faces = detectRooms(twoRoomFloor());
    expect(faces).toHaveLength(2);
    const sets = faces.map((f) => sorted(f.walls).join(',')).sort();
    expect(sets).toEqual(
      [
        sorted(['w1', 'w7', 'w5', 'w6']).join(','),
        sorted(['w2', 'w3', 'w4', 'w7']).join(','),
      ].sort(),
    );
  });

  it('emits nodes and walls in matching CCW order', () => {
    const floor = twoRoomFloor();
    for (const face of detectRooms(floor)) {
      const pts = face.nodes.map((id) => floor.nodes[id]!);
      expect(signedArea(pts)).toBeGreaterThan(0);
      face.walls.forEach((wid, i) => {
        const w = floor.walls[wid]!;
        const n0 = face.nodes[i]!;
        const n1 = face.nodes[(i + 1) % face.nodes.length]!;
        expect([w.a, w.b].sort()).toEqual([n0, n1].sort());
      });
    }
  });

  it('ignores a spur ending inside a room', () => {
    const floor = oneRoomFloor();
    floor.nodes.n5 = { id: 'n5', x: 2, y: 2 };
    floor.walls.w5 = { id: 'w5', a: 'n1', b: 'n5', thickness: 0.2, height: 3.2 };
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.walls).toHaveLength(4);
    expect(sorted(faces[0]!.walls)).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(new Set(faces[0]!.nodes).size).toBe(4);
  });

  it('finds two disjoint rooms', () => {
    const floor = oneRoomFloor();
    const corners = [
      [10, 0],
      [14, 0],
      [14, 4],
      [10, 4],
    ] as const;
    corners.forEach(([x, y], i) => {
      floor.nodes[`m${i}`] = { id: `m${i}`, x, y };
    });
    for (let i = 0; i < 4; i++) {
      floor.walls[`v${i}`] = {
        id: `v${i}`,
        a: `m${i}`,
        b: `m${(i + 1) % 4}`,
        thickness: 0.2,
        height: 3.2,
      };
    }
    expect(detectRooms(floor)).toHaveLength(2);
  });

  it('ignores dangling walls', () => {
    const floor = oneRoomFloor();
    floor.nodes.n5 = { id: 'n5', x: 6, y: 0 };
    floor.walls.w5 = { id: 'w5', a: 'n2', b: 'n5', thickness: 0.2, height: 3.2 };
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(1);
    expect(sorted(faces[0]!.walls)).toEqual(['w1', 'w2', 'w3', 'w4']);
  });

  it('partial wall leaves one room', () => {
    const floor = oneRoomFloor();
    floor.nodes.p = { id: 'p', x: 2, y: 1.5 };
    floor.walls.wp = { id: 'wp', a: 'n2', b: 'p', thickness: 0.2, height: 3.2 };
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.walls).not.toContain('wp');
    expect(faces[0]!.holes).toEqual([]);
  });

  it('inner box is a hole', () => {
    const floor = boxFloor(6, [{ prefix: 'b', x: 2, y: 2, size: 2 }]);
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(2);
    const outer = faceWith(faces, 'o0');
    const box = faceWith(faces, 'b0');
    expect(outer.holes).toHaveLength(1);
    expect(sorted(outer.holes[0]!)).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect(loopArea(floor, outer.holes[0]!)).toBeLessThan(0);
    expect(box.holes).toEqual([]);
    expect(sorted(box.walls)).toEqual(['b0', 'b1', 'b2', 'b3']);
  });

  it('bridge to inner box is ignored', () => {
    const floor = boxFloor(6, [{ prefix: 'b', x: 2, y: 2, size: 2 }]);
    floor.walls.br = { id: 'br', a: 'o_0', b: 'b_0', thickness: 0.2, height: 3.2 };
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(2);
    for (const f of faces) {
      expect(f.walls).not.toContain('br');
      for (const h of f.holes) expect(h).not.toContain('br');
    }
    const outer = faceWith(faces, 'o0');
    expect(sorted(outer.walls)).toEqual(['o0', 'o1', 'o2', 'o3']);
    expect(outer.holes.map((h) => sorted(h))).toEqual([['b0', 'b1', 'b2', 'b3']]);
    expect(faceWith(faces, 'b0').holes).toEqual([]);
  });

  it('pinched hole', () => {
    // Quad (0,0) (2,1) (3,3) (1,2) touches the outer ring only at corner o_0.
    const floor = boxFloor(6, [{ prefix: 'b', x: 1, y: 1, size: 2 }]);
    delete floor.nodes.b_0;
    floor.nodes.b_1 = { id: 'b_1', x: 2, y: 1 };
    floor.nodes.b_2 = { id: 'b_2', x: 3, y: 3 };
    floor.nodes.b_3 = { id: 'b_3', x: 1, y: 2 };
    floor.walls.b0!.a = 'o_0';
    floor.walls.b3!.b = 'o_0';
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(2);
    const outer = faceWith(faces, 'o0');
    expect(sorted(outer.walls)).toEqual(['o0', 'o1', 'o2', 'o3']);
    expect(new Set(outer.nodes).size).toBe(4);
    expect(outer.holes.map((h) => sorted(h))).toEqual([['b0', 'b1', 'b2', 'b3']]);
    expect(loopArea(floor, outer.holes[0]!)).toBeLessThan(0);
    expect(faceWith(faces, 'b0').holes).toEqual([]);
  });

  it('nested', () => {
    const floor = boxFloor(10, [
      { prefix: 'b', x: 2, y: 2, size: 6 },
      { prefix: 'c', x: 4, y: 4, size: 2 },
    ]);
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(3);
    expect(faceWith(faces, 'o0').holes.map((h) => sorted(h))).toEqual([['b0', 'b1', 'b2', 'b3']]);
    expect(faceWith(faces, 'b0').holes.map((h) => sorted(h))).toEqual([['c0', 'c1', 'c2', 'c3']]);
    expect(faceWith(faces, 'c0').holes).toEqual([]);
  });

  it('tiny face dropped', () => {
    // 4x4 room whose left wall is split at (0,2); a 0.3 x 2 strip is closed off
    // by a wall parallel to it at x = 0.3.
    const pts = [
      ['a', 0, 0],
      ['b', 0.3, 0],
      ['c', 4, 0],
      ['d', 4, 4],
      ['e', 0, 4],
      ['f', 0, 2],
    ] as const;
    const floor = oneRoomFloor();
    floor.nodes = {};
    floor.walls = {};
    floor.rooms = {};
    floor.openings = {};
    pts.forEach(([id, x, y]) => (floor.nodes[id] = { id, x, y }));
    floor.nodes.g = { id: 'g', x: 0.3, y: 2 };
    const wall = (id: string, a: string, b: string): void => {
      floor.walls[id] = { id, a, b, thickness: 0.2, height: 3.2 };
    };
    pts.forEach(([id], i) => wall(`w${i}`, id, pts[(i + 1) % pts.length]![0]));
    wall('s1', 'b', 'g');
    wall('s2', 'g', 'f');
    const faces = detectRooms(floor);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.walls).toContain('w2');
    expect(faces[0]!.walls).not.toContain('w0');
    expect(faces[0]!.walls).not.toContain('w5');
  });
});

describe('roomArea / roomPolygon', () => {
  it('computes center and inner area', () => {
    const f = oneRoomFloor();
    expect(roomArea(f, f.rooms.r1!, 'center')).toBeCloseTo(16, 9);
    expect(roomArea(f, f.rooms.r1!)).toBeCloseTo(14.44, 9);
  });

  it('insets by half thickness in a two-room floor', () => {
    const f = twoRoomFloor();
    expect(roomArea(f, f.rooms.r1!)).toBeCloseTo(14.44, 9);
    expect(roomArea(f, f.rooms.r2!)).toBeCloseTo(14.44, 9);
  });

  it('yields a clockwise polygon when nodes are flipped', () => {
    const f = oneRoomFloor();
    f.nodes.n3 = { id: 'n3', x: -1, y: -1 };
    expect(signedArea(roomPolygon(f, f.rooms.r1!, 'center'))).toBeLessThan(0);
    expect(roomArea(f, f.rooms.r1!, 'center')).toBeLessThan(0);
  });
});

describe('roomNodeLoop', () => {
  it('follows walls order', () => {
    const f = oneRoomFloor();
    expect(roomNodeLoop(f, f.rooms.r1!)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  const expectOpen = (fn: () => unknown): void => {
    try {
      fn();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(H3xValidationError);
      expect((e as H3xValidationError).issues[0]!.code).toBe('room-open');
    }
  };

  it('throws room-open for an open chain', () => {
    const f = oneRoomFloor();
    expectOpen(() => roomNodeLoop(f, { id: 'r', name: 'x', walls: ['w1', 'w2', 'w3'] }));
  });

  it('throws room-open for missing wall ids and too few walls', () => {
    const f = oneRoomFloor();
    expectOpen(() => roomNodeLoop(f, { id: 'r', name: 'x', walls: ['w1', 'w2', 'zz', 'w4'] }));
    expectOpen(() => roomNodeLoop(f, { id: 'r', name: 'x', walls: ['w1', 'w2'] }));
  });
});

describe('roomShape with holes', () => {
  const holeFloor = (): Floor => {
    const f = oneRoomFloor();
    f.openings = {};
    const pts = [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ] as const;
    pts.forEach(([x, y], i) => (f.nodes[`n${i + 1}`] = { id: `n${i + 1}`, x, y }));
    // Hole box 2x2 at (2,2), stored clockwise.
    const hp = [
      [2, 2],
      [2, 4],
      [4, 4],
      [4, 2],
    ] as const;
    hp.forEach(([x, y], i) => {
      f.nodes[`h${i}`] = { id: `h${i}`, x, y };
      f.walls[`hw${i}`] = {
        id: `hw${i}`,
        a: `h${i}`,
        b: `h${(i + 1) % 4}`,
        thickness: 0.1,
        height: 3.2,
      };
    });
    f.rooms.r1!.holes = [['hw0', 'hw1', 'hw2', 'hw3']];
    return f;
  };

  it('subtracts hole area', () => {
    const f = holeFloor();
    expect(roomArea(f, f.rooms.r1!, 'center')).toBeCloseTo(36 - 4, 9);
    expect(roomArea(f, f.rooms.r1!, 'inner')).toBeCloseTo(5.8 * 5.8 - 2.1 * 2.1, 9);
  });

  it('outsets the hole loop by half the wall thickness', () => {
    const f = holeFloor();
    const { outer, holes } = roomShape(f, f.rooms.r1!, 'inner');
    expect(outer).toHaveLength(4);
    expect(holes).toHaveLength(1);
    const xs = holes[0]!.map((p) => p.x);
    const ys = holes[0]!.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2.1, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.1, 9);
  });

  it('has no holes for a plain room', () => {
    const f = oneRoomFloor();
    expect(roomShape(f, f.rooms.r1!, 'center').holes).toEqual([]);
  });
});
