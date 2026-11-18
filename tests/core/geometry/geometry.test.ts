import { describe, expect, it } from 'vitest';
import { segmentsIntersect, closestPointOnSegment } from '../../../src/core/geometry/segment';
import {
  signedArea,
  isSimple,
  insetPolygon,
  growPolygon,
  pointInPolygon,
  polygonContainsPolygon,
} from '../../../src/core/geometry/polygon';
import { MITER_LIMIT } from '../../../src/core/constants';
import { obbOverlap, wallOBB, obbCorners } from '../../../src/core/geometry/obb';
import { leftNormal, normalize, length, distance } from '../../../src/core/geometry/vec';

const sq = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('vec', () => {
  it('basics', () => {
    expect(leftNormal({ x: 1, y: 0 })).toEqual({ x: -0, y: 1 });
    expect(length(normalize({ x: 3, y: 4 }))).toBeCloseTo(1);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('segmentsIntersect', () => {
  const P = (x: number, y: number) => ({ x, y });
  it('X-cross', () => expect(segmentsIntersect(P(0, 0), P(2, 2), P(0, 2), P(2, 0))).toBe(true));
  it('shared endpoint', () =>
    expect(segmentsIntersect(P(0, 0), P(1, 0), P(1, 0), P(1, 1))).toBe(false));
  it('collinear overlap', () =>
    expect(segmentsIntersect(P(0, 0), P(2, 0), P(1, 0), P(3, 0))).toBe(true));
  it('parallel apart', () =>
    expect(segmentsIntersect(P(0, 0), P(2, 0), P(0, 1), P(2, 1))).toBe(false));
  it('closestPointOnSegment', () => {
    const r = closestPointOnSegment(P(1, 1), P(0, 0), P(2, 0));
    expect(r.point).toEqual({ x: 1, y: 0 });
    expect(r.t).toBeCloseTo(0.5);
  });
});

describe('polygon', () => {
  it('signedArea', () => {
    expect(signedArea(sq(0, 0, 1, 1))).toBe(1);
    expect(signedArea(sq(0, 0, 1, 1).reverse())).toBe(-1);
  });
  it('isSimple', () => {
    expect(
      isSimple([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]),
    ).toBe(false);
    expect(isSimple(sq(0, 0, 1, 1))).toBe(true);
  });
  it('insetPolygon', () => {
    const r = insetPolygon(sq(0, 0, 4, 4), [0.1, 0.1, 0.1, 0.1]);
    const e = sq(0.1, 0.1, 3.9, 3.9);
    r.forEach((p, i) => {
      expect(Math.abs(p.x - e[i]!.x)).toBeLessThan(1e-9);
      expect(Math.abs(p.y - e[i]!.y)).toBeLessThan(1e-9);
    });
  });
  it('pointInPolygon', () => {
    expect(pointInPolygon({ x: 2, y: 2 }, sq(0, 0, 4, 4))).toBe(true);
    expect(pointInPolygon({ x: 5, y: 5 }, sq(0, 0, 4, 4))).toBe(false);
    expect(pointInPolygon({ x: 4, y: 2 }, sq(0, 0, 4, 4))).toBe(true);
  });
  describe('polygonContainsPolygon', () => {
    const outer = sq(0, 0, 4, 4);
    it('flush square shares collinear edge', () =>
      expect(polygonContainsPolygon(outer, sq(0, 0, 1, 1))).toBe(true));
    it('strictly inside', () => expect(polygonContainsPolygon(outer, sq(1, 1, 2, 2))).toBe(true));
    it('poking outside', () => expect(polygonContainsPolygon(outer, sq(3, 1, 5, 2))).toBe(false));
    it('L-shape notch spanned', () => {
      const L = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 2 },
        { x: 2, y: 2 },
        { x: 2, y: 4 },
        { x: 0, y: 4 },
      ];
      expect(polygonContainsPolygon(L, sq(1, 1, 3, 1.5))).toBe(true);
      // vertices (1,1.5)... all inside, but spans the notch region
      const span = [
        { x: 1, y: 1 },
        { x: 3.5, y: 1 },
        { x: 3.5, y: 1.9 },
        { x: 1.9, y: 3.5 },
        { x: 1, y: 3.5 },
      ];
      expect(polygonContainsPolygon(L, span)).toBe(false);
      expect(polygonContainsPolygon(L, sq(1.5, 1.5, 1.9, 3.9))).toBe(true);
      // diamond whose vertices lie on the notch walls but whose edge crosses the notch
      const diamond = [
        { x: 3, y: 2 },
        { x: 2, y: 3 },
        { x: 1, y: 2 },
        { x: 2, y: 1 },
      ];
      expect(polygonContainsPolygon(L, diamond)).toBe(false);
    });
  });
});

describe('obb', () => {
  const o = (x: number, y: number, rotation = 0) => ({
    center: { x, y },
    halfW: 0.5,
    halfD: 0.5,
    rotation,
  });
  it('overlap', () => expect(obbOverlap(o(0, 0), o(0.5, 0))).toBe(true));
  it('touching', () => expect(obbOverlap(o(0, 0), o(1, 0))).toBe(false));
  it('rotated', () => expect(obbOverlap(o(0, 0), o(1.2, 0, Math.PI / 4))).toBe(true));
  it('rotated apart', () => expect(obbOverlap(o(0, 0), o(1.3, 0, Math.PI / 4))).toBe(false));
  it('corners', () => expect(obbCorners(o(0, 0))).toHaveLength(4));
  it('wallOBB', () => {
    const w = wallOBB({ x: 0, y: 0 }, { x: 4, y: 0 }, 0.2);
    expect(w.center).toEqual({ x: 2, y: 0 });
    expect(w.halfW).toBe(2);
    expect(w.halfD).toBeCloseTo(0.1);
    expect(w.rotation).toBe(0);
  });
});

describe('growPolygon', () => {
  it('grows a square outward on every edge', () => {
    const { points, source } = growPolygon(sq(0, 0, 4, 4), [0.1, 0.1, 0.1, 0.1]);
    expect(points).toHaveLength(4);
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.2, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4.2, 9);
    expect(source).toEqual([0, 1, 2, 3]);
  });

  it('bevels a 10 degree corner instead of spiking', () => {
    const tri = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 * Math.tan((10 * Math.PI) / 180) },
    ];
    const { points, source } = growPolygon(tri, [0.1, 0.1, 0.1], MITER_LIMIT);
    expect(points).toHaveLength(4);
    expect(source).toEqual([2, 0, 1, 2]);
    // the two bevel points sit exactly MITER_LIMIT x d from the tip
    for (const p of points.slice(0, 2)) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(MITER_LIMIT * 0.1, 9);
    }
    for (const p of points) {
      const d = Math.min(...tri.map((v) => Math.hypot(p.x - v.x, p.y - v.y)));
      expect(d).toBeLessThanOrEqual(MITER_LIMIT * 0.1 + 1e-9);
    }
    expect(isSimple(points)).toBe(true);
    expect(signedArea(points)).toBeGreaterThanOrEqual(signedArea(tri));
  });

  const acuteTri = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 * Math.tan((10 * Math.PI) / 180) },
  ];
  // a square with a thin wedge notch (about 11 degrees) whose tip at (5, 5) is a reflex corner
  const notched = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 5.5, y: 10 },
    { x: 5, y: 5 },
    { x: 4.5, y: 10 },
    { x: 0, y: 10 },
  ];

  it('insets an acute convex corner with a plain miter (simple, shrinking ring)', () => {
    const { points } = growPolygon(acuteTri, [-0.1, -0.1, -0.1]);
    expect(points).toHaveLength(3);
    expect(isSimple(points)).toBe(true);
    expect(signedArea(points)).toBeGreaterThan(0);
    expect(signedArea(points)).toBeLessThan(signedArea(acuteTri));
  });

  it('grows a ring monotonically with the distance', () => {
    const areas = [0, 0.05, 0.1, 0.2].map((d) => {
      const { points } = growPolygon(acuteTri, [d, d, d]);
      expect(isSimple(points)).toBe(true);
      return signedArea(points);
    });
    expect(areas).toEqual([...areas].sort((a, b) => a - b));
  });

  it('keeps a notch (acute reflex corner) simple when growing and when insetting', () => {
    const out = growPolygon(
      notched,
      notched.map(() => 0.1),
    );
    expect(isSimple(out.points)).toBe(true);
    expect(signedArea(out.points)).toBeGreaterThan(signedArea(notched));
    const inn = growPolygon(
      notched,
      notched.map(() => -0.1),
    );
    expect(inn.points.length).toBeGreaterThan(notched.length); // the notch tip is bevelled
    expect(isSimple(inn.points)).toBe(true);
    expect(signedArea(inn.points)).toBeGreaterThan(0);
    expect(signedArea(inn.points)).toBeLessThan(signedArea(notched));
  });

  it('negative distances shrink', () => {
    const { points } = growPolygon(sq(0, 0, 4, 4), [-0.5, -0.5, -0.5, -0.5]);
    expect(Math.min(...points.map((p) => p.x))).toBeCloseTo(0.5, 9);
  });
});
