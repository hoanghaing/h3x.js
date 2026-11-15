import { describe, expect, it } from 'vitest';
import { H3xValidationError } from '../../src/core/errors';
import { signedArea } from '../../src/core/geometry/polygon';
import {
  detectRooms,
  roomArea,
  roomNodeLoop,
  roomPolygon,
} from '../../src/core/rooms/detect';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';

const sorted = (a: string[]): string[] => [...a].sort();

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
    expect(sets).toEqual([sorted(['w1', 'w7', 'w5', 'w6']).join(','), sorted(['w2', 'w3', 'w4', 'w7']).join(',')].sort());
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
    const corners = [[10, 0], [14, 0], [14, 4], [10, 4]] as const;
    corners.forEach(([x, y], i) => {
      floor.nodes[`m${i}`] = { id: `m${i}`, x, y };
    });
    for (let i = 0; i < 4; i++) {
      floor.walls[`v${i}`] = { id: `v${i}`, a: `m${i}`, b: `m${(i + 1) % 4}`, thickness: 0.2, height: 3.2 };
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
