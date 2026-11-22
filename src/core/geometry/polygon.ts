import type { Vec2 } from '../types';
import { GEOM_TOL, MITER_LIMIT } from '../constants';
import { EPS, cross, distance, dot, leftNormal, normalize, sub } from './vec';
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
 * Each edge i (pts[i] to pts[i+1]) offset inward by distances[i], between its joins with the
 * neighbouring edges. Input must be CCW (inward = left). Edges meet at a miter point, except
 * where they carry straight on and that point is beyond MITER_LIMIT x the larger distance, or
 * does not exist: a nearly straight corner between different distances. There both end square
 * at the vertex, as the wall outlines do (computeJoins), so from[i] differs from to[i - 1].
 */
export function insetEdges(pts: Vec2[], distances: number[]): { from: Vec2[]; to: Vec2[] } {
  const lines = pts.map((p, i) => {
    const q = at(pts, i + 1);
    const dir = normalize(sub(q, p));
    const nrm = leftNormal(dir);
    const d = distances[i] ?? 0;
    return { p: { x: p.x + nrm.x * d, y: p.y + nrm.y * d }, dir, nrm, d };
  });
  const from: Vec2[] = [];
  const ends: Vec2[] = []; // ends[i]: where edge i - 1 ends, at vertex i
  pts.forEach((v, i) => {
    const l0 = at(lines, i - 1);
    const l1 = at(lines, i);
    const denom = cross(l0.dir, l1.dir);
    let miter: Vec2 | undefined;
    if (Math.abs(denom) >= EPS) {
      const t = cross(sub(l1.p, l0.p), l1.dir) / denom;
      miter = { x: l0.p.x + l0.dir.x * t, y: l0.p.y + l0.dir.y * t };
    }
    let end = miter ?? { x: l1.p.x, y: l1.p.y }; // parallel edges
    let start = end;
    const limit = MITER_LIMIT * Math.max(l0.d, l1.d);
    if (dot(l0.dir, l1.dir) > 0 && (!miter || distance(miter, v) > limit)) {
      const square = { x: v.x + l0.nrm.x * l0.d, y: v.y + l0.nrm.y * l0.d };
      start = { x: l1.p.x, y: l1.p.y };
      end = distance(square, start) > GEOM_TOL ? square : start;
    }
    ends.push(end);
    from.push(start);
  });
  return { from, to: pts.map((_, i) => at(ends, i + 1)) };
}

/**
 * The outline through `insetEdges`: one point per vertex, two where the corner is a step. So
 * its edges do not map one to one onto the input's.
 */
export function insetPolygon(pts: Vec2[], distances: number[]): Vec2[] {
  const { from, to } = insetEdges(pts, distances);
  return from.flatMap((start, i) => {
    const end = at(to, i - 1);
    return end === start ? [start] : [end, start];
  });
}

/**
 * Offsets edge i (pts[i] to pts[i+1]) outward (to the right of a CCW ring) by distances[i];
 * negative moves it inward. Consecutive offset lines meet at a miter point. When that point
 * overshoots the vertex (lies ahead of it along the incoming edge, as at an acute outward
 * corner or an acute reflex inset) and is farther than miterLimit x |distance| away, the
 * corner is bevelled into two points instead. A miter that lies behind the vertex (an inset
 * convex corner, an outward reflex corner) is always kept: it cannot spike. source[k] is the input edge that output edge k (points[k] to
 * points[k+1]) came from; a bevel edge takes the index of the edge before it.
 */
export function growPolygon(
  pts: Vec2[],
  distances: number[],
  miterLimit: number = MITER_LIMIT,
): { points: Vec2[]; source: number[] } {
  const n = pts.length;
  const lines = pts.map((p, i) => {
    const dir = normalize(sub(at(pts, i + 1), p));
    const nrm = { x: dir.y, y: -dir.x };
    const d = distances[i] ?? 0;
    return { p: { x: p.x + nrm.x * d, y: p.y + nrm.y * d }, dir, nrm, d };
  });
  const points: Vec2[] = [];
  const source: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = pts[i] as Vec2;
    const l0 = at(lines, i - 1);
    const l1 = at(lines, i);
    const limit = miterLimit * Math.max(Math.abs(l0.d), Math.abs(l1.d));
    const denom = cross(l0.dir, l1.dir);
    if (Math.abs(denom) < EPS) {
      points.push({ x: l1.p.x, y: l1.p.y }); // parallel edges
      source.push(i);
      continue;
    }
    const t = cross(sub(l1.p, l0.p), l1.dir) / denom;
    const m = { x: l0.p.x + l0.dir.x * t, y: l0.p.y + l0.dir.y * t };
    const overshoot = (m.x - v.x) * l0.dir.x + (m.y - v.y) * l0.dir.y > 0;
    if (!overshoot || Math.hypot(m.x - v.x, m.y - v.y) <= limit) {
      points.push(m);
      source.push(i);
      continue;
    }
    // Bevel: each offset vertex slides along its own edge until it is `limit` from v.
    const reach = (l: typeof l0): number => Math.sqrt(Math.max(0, limit * limit - l.d * l.d));
    const s0 = reach(l0);
    const s1 = reach(l1);
    points.push({
      x: v.x + l0.nrm.x * l0.d + l0.dir.x * s0,
      y: v.y + l0.nrm.y * l0.d + l0.dir.y * s0,
    });
    source.push((((i - 1) % n) + n) % n);
    points.push({
      x: v.x + l1.nrm.x * l1.d - l1.dir.x * s1,
      y: v.y + l1.nrm.y * l1.d - l1.dir.y * s1,
    });
    source.push(i);
  }
  return { points, source };
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
