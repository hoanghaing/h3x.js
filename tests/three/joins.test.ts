import { describe, expect, it } from 'vitest';
import type { Floor, Vec2 } from '../../src/core';
import { MITER_LIMIT, computeWallCorners, type WallCorners } from '../../src/three/walls/joins';
import { irregularFixtures } from '../fixtures/irregular';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';

const near = (p: Vec2, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
};

function floorOf(
  nodes: Record<string, [number, number]>,
  walls: [string, string, string, number][],
): Floor {
  return {
    id: 'f',
    level: 0,
    elevation: 0,
    wallHeight: 3,
    slabThickness: 0.15,
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, [x, y]]) => [id, { id, x, y }])),
    walls: Object.fromEntries(
      walls.map(([id, a, b, thickness]) => [id, { id, a, b, thickness, height: 3 }]),
    ),
    openings: {},
    rooms: {},
    items: {},
    columns: {},
    stairs: {},
    roofs: {},
  };
}

function corner(map: Record<string, WallCorners>, id: string): WallCorners {
  const c = map[id];
  if (!c) throw new Error(`no corners for ${id}`);
  return c;
}

describe('computeWallCorners', () => {
  it('isolated wall', () => {
    const c = corner(
      computeWallCorners(floorOf({ a: [0, 0], b: [4, 0] }, [['w', 'a', 'b', 0.2]])),
      'w',
    );
    near(c.startLeft, 0, 0.1);
    near(c.startRight, 0, -0.1);
    near(c.endLeft, 4, 0.1);
    near(c.endRight, 4, -0.1);
  });

  it('free end of a chain gets a square cap while the shared end is mitred', () => {
    const m = computeWallCorners(
      floorOf({ a: [0, 0], b: [4, 0], c: [4, 4] }, [
        ['w1', 'a', 'b', 0.2],
        ['w2', 'b', 'c', 0.2],
      ]),
    );
    const w1 = corner(m, 'w1');
    near(w1.startLeft, 0, 0.1);
    near(w1.startRight, 0, -0.1);
    near(w1.endLeft, 3.9, 0.1);
    near(w1.endRight, 4.1, -0.1);
    const w2 = corner(m, 'w2');
    near(w2.endLeft, 3.9, 4);
    near(w2.endRight, 4.1, 4);
  });

  it('square room corners', () => {
    const m = computeWallCorners(oneRoomFloor());
    const w1 = corner(m, 'w1');
    const w2 = corner(m, 'w2');
    near(w1.endLeft, 3.9, 0.1);
    near(w1.endRight, 4.1, -0.1);
    near(w2.startLeft, 3.9, 0.1);
    near(w2.startRight, 4.1, -0.1);
  });

  it('T junction', () => {
    const m = computeWallCorners(twoRoomFloor());
    const w7 = corner(m, 'w7');
    const w1 = corner(m, 'w1');
    const w2 = corner(m, 'w2');
    near(w7.startLeft, 3.9, 0.1);
    near(w7.startRight, 4.1, 0.1);
    near(w1.endLeft, 3.9, 0.1);
    near(w1.endRight, 4, -0.1);
    near(w2.startLeft, 4.1, 0.1);
    near(w2.startRight, 4, -0.1);
  });

  it('acute angle falls back to square', () => {
    const a = (5 * Math.PI) / 180;
    const m = computeWallCorners(
      floorOf({ o: [0, 0], p: [4, 0], q: [4 * Math.cos(a), 4 * Math.sin(a)] }, [
        ['w1', 'o', 'p', 0.2],
        ['w2', 'o', 'q', 0.2],
      ]),
    );
    for (const w of ['w1', 'w2']) {
      const c = corner(m, w);
      for (const p of [c.startLeft, c.startRight]) {
        expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(MITER_LIMIT * 0.1 + 1e-9);
      }
    }
  });

  it('walls of different thickness', () => {
    // w1 (0,0)->(4,0) t=0.2 ; w2 (4,0)->(4,4) t=0.4. Inner corner (left side).
    const m = computeWallCorners(
      floorOf({ a: [0, 0], b: [4, 0], c: [4, 4] }, [
        ['w1', 'a', 'b', 0.2],
        ['w2', 'b', 'c', 0.4],
      ]),
    );
    const w1 = corner(m, 'w1');
    const w2 = corner(m, 'w2');
    // w1 left offset line: y = 0.1 ; w2 left offset line: x = 4 - 0.2
    near(w1.endLeft, 3.8, 0.1);
    near(w2.startLeft, 3.8, 0.1);
    // outer: y = -0.1 ; x = 4.2
    near(w1.endRight, 4.2, -0.1);
    near(w2.startRight, 4.2, -0.1);
  });

  it('skips walls with missing nodes', () => {
    const f = floorOf({ a: [0, 0], b: [4, 0] }, [
      ['w', 'a', 'b', 0.2],
      ['bad', 'a', 'zz', 0.2],
    ]);
    expect(Object.keys(computeWallCorners(f))).toEqual(['w']);
  });
});

describe('computeWallCorners on irregular lots', () => {
  for (const [name, make] of Object.entries(irregularFixtures)) {
    it(`${name}: every outline point stays near its wall`, () => {
      const floor = make();
      const corners = computeWallCorners(floor);
      for (const w of Object.values(floor.walls)) {
        const a = floor.nodes[w.a]!;
        const b = floor.nodes[w.b]!;
        const c = corner(corners, w.id);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        for (const p of [c.startLeft, c.startRight, c.endLeft, c.endRight]) {
          const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
          const d = Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
          expect(d).toBeLessThanOrEqual((w.thickness / 2) * MITER_LIMIT + 1e-6);
        }
      }
    });
  }
});
