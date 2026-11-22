import { describe, expect, it } from 'vitest';
import { polygonOverlapArea, uncoveredArea } from '../../../src/core/geometry/clip';
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

describe('uncoveredArea', () => {
  it('is the whole area without covers', () => {
    expect(uncoveredArea(L, [])).toBeCloseTo(3, 9);
  });
  it('counts overlapping covers once', () => {
    expect(uncoveredArea(sq(0, 0, 4), [sq(0, 0, 2), sq(1, 1, 2)])).toBeCloseTo(9, 9);
  });
  it('ignores the part of a cover outside the polygon', () => {
    expect(uncoveredArea(L, [sq(1, 1, 5)])).toBeCloseTo(3, 9);
    expect(uncoveredArea(sq(0, 0, 2), [sq(1, -1, 5)])).toBeCloseTo(2, 9);
  });
  it('handles slanted edges and either winding', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ];
    expect(uncoveredArea(sq(0, 0, 4), [[...tri].reverse()])).toBeCloseTo(8, 9);
  });
  it('handles two spans on one line', () => {
    const u = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ];
    const turned = u.map((p) => ({ x: p.y, y: p.x }));
    expect(uncoveredArea(turned, [])).toBeCloseTo(7, 9);
    expect(uncoveredArea(turned, [sq(1, 0, 0.5), sq(0, 5, 2)])).toBeCloseTo(6.75, 9);
  });
  it('splits slabs where covers cross', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ];
    const b = [
      { x: 0, y: 4 },
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ];
    expect(uncoveredArea(sq(0, 0, 4), [a, b])).toBeCloseTo(4, 9);
  });
  it('holds far from the origin', () => {
    expect(uncoveredArea(sq(1e5, 1e5, 4), [sq(1e5, 1e5, 2)])).toBeCloseTo(12, 6);
  });
  it('is 0 when fully covered', () => {
    expect(uncoveredArea(sq(1, 1), [sq(0, 0, 3)])).toBe(0);
  });
});
