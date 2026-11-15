import { describe, expect, it } from 'vitest';
import { segmentsIntersect, closestPointOnSegment } from '../../../src/core/geometry/segment';
import {
  signedArea,
  isSimple,
  insetPolygon,
  pointInPolygon,
  polygonContainsPolygon,
} from '../../../src/core/geometry/polygon';
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
    expect(isSimple([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }])).toBe(false);
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
    it('strictly inside', () =>
      expect(polygonContainsPolygon(outer, sq(1, 1, 2, 2))).toBe(true));
    it('poking outside', () =>
      expect(polygonContainsPolygon(outer, sq(3, 1, 5, 2))).toBe(false));
    it('L-shape notch spanned', () => {
      const L = [
        { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 },
        { x: 2, y: 2 }, { x: 2, y: 4 }, { x: 0, y: 4 },
      ];
      expect(polygonContainsPolygon(L, sq(1, 1, 3, 1.5))).toBe(true);
      // vertices (1,1.5)... all inside, but spans the notch region
      const span = [{ x: 1, y: 1 }, { x: 3.5, y: 1 }, { x: 3.5, y: 1.9 }, { x: 1.9, y: 3.5 }, { x: 1, y: 3.5 }];
      expect(polygonContainsPolygon(L, span)).toBe(false);
      expect(polygonContainsPolygon(L, sq(1.5, 1.5, 1.9, 3.9))).toBe(true);
      // diamond whose vertices lie on the notch walls but whose edge crosses the notch
      const diamond = [{ x: 3, y: 2 }, { x: 2, y: 3 }, { x: 1, y: 2 }, { x: 2, y: 1 }];
      expect(polygonContainsPolygon(L, diamond)).toBe(false);
    });
  });
});

describe('obb', () => {
  const o = (x: number, y: number, rotation = 0) => ({ center: { x, y }, halfW: 0.5, halfD: 0.5, rotation });
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
