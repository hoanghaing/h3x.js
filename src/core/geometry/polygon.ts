import type { Vec2 } from '../types';
import { EPS, cross, leftNormal, normalize, sub } from './vec';
import { closestPointOnSegment, segmentsIntersect } from './segment';

const BOUNDARY_TOL = 1e-6;

const at = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length] as T;

/** Shoelace area; CCW is positive. */
export function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = at(pts, i);
    const b = at(pts, i + 1);
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** O(n^2): no two non-adjacent edges intersect. */
export function isSimple(pts: Vec2[]): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(at(pts, i), at(pts, i + 1), at(pts, j), at(pts, j + 1))) return false;
    }
  }
  return true;
}

/**
 * Offsets each edge inward by distances[i] (edge i to i+1) and intersects
 * consecutive offset lines. Input must be CCW (inward = left).
 */
export function insetPolygon(pts: Vec2[], distances: number[]): Vec2[] {
  const lines = pts.map((p, i) => {
    const q = at(pts, i + 1);
    const dir = normalize(sub(q, p));
    const nrm = leftNormal(dir);
    const d = distances[i] ?? 0;
    return { p: { x: p.x + nrm.x * d, y: p.y + nrm.y * d }, dir };
  });
  return pts.map((_, i) => {
    const l0 = at(lines, i - 1);
    const l1 = at(lines, i);
    const denom = cross(l0.dir, l1.dir);
    if (Math.abs(denom) < EPS) return { x: l1.p.x, y: l1.p.y }; // parallel edges
    const t = cross(sub(l1.p, l0.p), l1.dir) / denom;
    return { x: l0.p.x + l0.dir.x * t, y: l0.p.y + l0.dir.y * t };
  });
}

/** Ray casting; points within 1e-6 of the boundary count as inside. */
export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const { point } = closestPointOnSegment(p, at(pts, i), at(pts, i + 1));
    if (Math.hypot(point.x - p.x, point.y - p.y) <= BOUNDARY_TOL) return true;
  }
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = pts[i] as Vec2;
    const b = pts[j] as Vec2;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Strict interior crossing of both segments (touching / collinear excluded). */
function properCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2): number => {
    const v = cross(sub(q, p), sub(r, p));
    return Math.abs(v) < BOUNDARY_TOL ? 0 : Math.sign(v);
  };
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Every inner vertex is inside outer (boundary tolerant) and no inner edge
 * properly crosses an outer edge. Touching / collinear overlap is allowed.
 */
export function polygonContainsPolygon(outer: Vec2[], inner: Vec2[]): boolean {
  if (!inner.every((p) => pointInPolygon(p, outer))) return false;
  const n = outer.length;
  const m = inner.length;
  for (let i = 0; i < m; i++) {
    const a = inner[i] as Vec2;
    const b = inner[(i + 1) % m] as Vec2;
    for (let j = 0; j < n; j++) {
      if (properCross(a, b, at(outer, j), at(outer, j + 1))) return false;
    }
  }
  return true;
}
