import type { Vec2 } from '../types';
import { EPS, cross, distance, dot, sub } from './vec';

const same = (a: Vec2, b: Vec2): boolean => distance(a, b) < EPS;

/** Is c within the bounding box of ab (a, b, c collinear). */
function onSegment(a: Vec2, b: Vec2, c: Vec2): boolean {
  return (
    c.x >= Math.min(a.x, b.x) - EPS &&
    c.x <= Math.max(a.x, b.x) + EPS &&
    c.y >= Math.min(a.y, b.y) - EPS &&
    c.y <= Math.max(a.y, b.y) + EPS
  );
}

const orient = (a: Vec2, b: Vec2, c: Vec2): number => {
  const v = cross(sub(b, a), sub(c, a));
  return Math.abs(v) < EPS ? 0 : Math.sign(v);
};

/**
 * True for proper crossings, T-touches and collinear overlaps.
 * Touching only at a shared endpoint is false.
 */
export function segmentsIntersect(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2): boolean {
  const o1 = orient(p1, p2, q1);
  const o2 = orient(p1, p2, q2);
  const o3 = orient(q1, q2, p1);
  const o4 = orient(q1, q2, p2);

  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) return o1 !== o2 && o3 !== o4;

  if (o1 === 0 && o2 === 0) {
    // all collinear: overlap must have positive length
    const d = sub(p2, p1);
    const l2 = dot(d, d);
    if (l2 < EPS) return false;
    const t1 = dot(sub(q1, p1), d) / l2;
    const t2 = dot(sub(q2, p1), d) / l2;
    const lo = Math.max(0, Math.min(t1, t2));
    const hi = Math.min(1, Math.max(t1, t2));
    return (hi - lo) * Math.sqrt(l2) > EPS;
  }

  // touching cases: an endpoint lies on the other segment
  const touches: Array<[Vec2, Vec2, Vec2, number]> = [
    [p1, p2, q1, o1],
    [p1, p2, q2, o2],
    [q1, q2, p1, o3],
    [q1, q2, p2, o4],
  ];
  for (const [a, b, c, o] of touches) {
    if (o === 0 && onSegment(a, b, c)) {
      const shared = [p1, p2].some((e) => same(e, c)) && [q1, q2].some((e) => same(e, c));
      if (!shared) return true;
    }
  }
  return false;
}

export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < EPS) return { point: { x: a.x, y: a.y }, t: 0 };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return { point: { x: a.x + d.x * t, y: a.y + d.y * t }, t };
}
