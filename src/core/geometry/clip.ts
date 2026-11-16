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
