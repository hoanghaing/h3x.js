import type { Vec2 } from '../types';
import { signedArea } from './polygon';

/** Sutherland-Hodgman clip of `subject` against a CCW convex polygon. */
function clipConvex(subject: Vec2[], clip: Vec2[]): Vec2[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i] as Vec2;
    const b = clip[(i + 1) % clip.length] as Vec2;
    const side = (p: Vec2): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j] as Vec2;
      const q = input[(j + 1) % input.length] as Vec2;
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

/**
 * Area of the intersection of two simple polygons (any winding, convex or
 * concave). Fan-decomposes `a` into signed triangles and sums the area of `b`
 * clipped to each; clipping a concave `b` may leave degenerate edges but the
 * signed area of the result stays exact.
 */
export function polygonOverlapArea(a: Vec2[], b: Vec2[]): number {
  if (a.length < 3 || b.length < 3) return 0;
  const subject = signedArea(b) < 0 ? [...b].reverse() : b;
  const a0 = a[0] as Vec2;
  let total = 0;
  for (let i = 1; i + 1 < a.length; i++) {
    const tri = [a0, a[i] as Vec2, a[i + 1] as Vec2];
    const s = signedArea(tri);
    if (s === 0) continue;
    const ccw = s < 0 ? [...tri].reverse() : tri;
    total += Math.sign(s) * signedArea(clipConvex(subject, ccw));
  }
  return Math.abs(total);
}

/**
 * Area of the simple polygon `subject` that none of the simple polygons `covers` covers (any
 * winding; covers may overlap). Exact: between consecutive vertices and edge crossings the
 * uncovered length of a vertical line is linear in x, so sampling each slab at its middle is
 * enough.
 */
export function uncoveredArea(subject: Vec2[], covers: Vec2[][]): number {
  const rings = [subject, ...covers].map((ring) =>
    ring.map((a, i) => [a, ring[(i + 1) % ring.length] as Vec2] as const),
  );
  const edges = rings.flat();
  const xs = edges.map(([a]) => a.x);
  for (let i = 0; i < edges.length; i++) {
    const [a, b] = edges[i]!;
    for (let j = i + 1; j < edges.length; j++) {
      const [c, d] = edges[j]!;
      const denom = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (denom === 0) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / denom;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / denom;
      if (t > 0 && t < 1 && u > 0 && u < 1) xs.push(a.x + t * (b.x - a.x));
    }
  }
  xs.sort((p, q) => p - q);

  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    if (x1 <= x0) continue;
    const x = (x0 + x1) / 2;
    const spans = rings.map((ring) => {
      const ys: number[] = [];
      for (const [a, b] of ring) {
        if (a.x > x !== b.x > x) ys.push(a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y));
      }
      ys.sort((p, q) => p - q);
      const out: Array<{ lo: number; hi: number }> = [];
      for (let k = 0; k + 1 < ys.length; k += 2) out.push({ lo: ys[k]!, hi: ys[k + 1]! });
      return out;
    });
    const covered = spans.slice(1).flat();
    covered.sort((p, q) => p.lo - q.lo);
    let free = 0;
    for (const { lo, hi } of spans[0]!) {
      let y = lo;
      for (const c of covered) {
        if (c.lo >= hi) break;
        if (c.lo > y) free += c.lo - y;
        y = Math.max(y, c.hi);
      }
      if (hi > y) free += hi - y;
    }
    area += free * (x1 - x0);
  }
  return area;
}
