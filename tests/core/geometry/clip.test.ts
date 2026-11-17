import { describe, expect, it } from 'vitest';
import { polygonOverlapArea } from '../../../src/core/geometry/clip';
import type { Vec2 } from '../../../src/core/types';

const sq = (x: number, y: number, s = 1): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];
const L: Vec2[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 0, y: 2 },
];

describe('polygonOverlapArea', () => {
  it('overlaps two offset unit squares', () => {
    expect(polygonOverlapArea(sq(0, 0), sq(0.5, 0))).toBeCloseTo(0.5, 9);
  });
  it('is 0 for disjoint polygons', () => {
    expect(polygonOverlapArea(sq(0, 0), sq(5, 5))).toBe(0);
  });
  it('is the full area for identical concave polygons', () => {
    expect(polygonOverlapArea(L, L)).toBeCloseTo(3, 9);
  });
  it('excludes the notch of an L-shape', () => {
    // square (0,0)-(2,2) covers the notch (1..2, 1..2) which is outside L.
    expect(polygonOverlapArea(L, sq(0, 0, 2))).toBeCloseTo(3, 9);
    expect(polygonOverlapArea(L, sq(1, 1))).toBeCloseTo(0, 9);
    expect(polygonOverlapArea(L, sq(0.5, 0.5, 1.5))).toBeCloseTo(1.25, 9);
  });
  it('is winding independent and symmetric', () => {
    const cw = [...sq(0.5, 0)].reverse();
    expect(polygonOverlapArea(sq(0, 0), cw)).toBeCloseTo(0.5, 9);
    expect(polygonOverlapArea([...L].reverse(), sq(0.5, 0.5, 1.5))).toBeCloseTo(
      polygonOverlapArea(sq(0.5, 0.5, 1.5), L),
      9,
    );
  });
});
