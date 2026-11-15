import type { Vec2 } from '../types';
import { GEOM_TOL } from '../constants';
import { EPS, cross, leftNormal, normalize, sub } from './vec';
import { closestPointOnSegment, segmentsIntersect } from './segment';

const BOUNDARY_TOL = GEOM_TOL;

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

/** Ray casting; points within GEOM_TOL of the boundary count as inside. */
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
  // Signed distance of r from line pq; within BOUNDARY_TOL counts as on the line.
  const o = (p: Vec2, q: Vec2, r: Vec2): number => {
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < EPS) return 0;
    const v = cross(sub(q, p), sub(r, p)) / len;
    return Math.abs(v) <= BOUNDARY_TOL ? 0 : Math.sign(v);
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
    const a = at(inner, i);
    const b = at(inner, i + 1);
    for (let j = 0; j < n; j++) {
      if (properCross(a, b, at(outer, j), at(outer, j + 1))) return false;
    }
    // Split the edge where it touches the outer boundary; each piece must stay inside.
    const d = sub(b, a);
    const l2 = d.x * d.x + d.y * d.y;
    if (l2 < EPS) continue;
    const ts = [0, 1];
    for (let j = 0; j < n; j++) {
      const c = at(outer, j);
      const e = at(outer, j + 1);
      const onEdge = closestPointOnSegment(c, a, b);
      if (Math.hypot(onEdge.point.x - c.x, onEdge.point.y - c.y) <= BOUNDARY_TOL) ts.push(onEdge.t);
      const f = sub(e, c);
      const denom = cross(d, f);
      if (Math.abs(denom) < EPS) continue;
      const t = cross(sub(c, a), f) / denom;
      const u = cross(sub(c, a), d) / denom;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k] as number;
      const t1 = ts[k + 1] as number;
      if (t1 - t0 < 1e-12) continue;
      const tm = (t0 + t1) / 2;
      if (!pointInPolygon({ x: a.x + d.x * tm, y: a.y + d.y * tm }, outer)) return false;
    }
  }
  return true;
}
