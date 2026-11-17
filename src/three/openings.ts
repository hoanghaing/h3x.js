import { ShapeUtils, Vector2, type Vector3 } from 'three';
import type { Vec2 } from '../core';
import { signedArea } from '../core/geometry/polygon';
import type { TriangleSink } from './triangulate';

/** Pieces smaller than this (m²) are dropped as clipping slivers. */
const MIN_AREA = 1e-10;
/** Distance (m) of the side probes used to tell material from void next to an edge. */
const PROBE = 1e-5;

/** Triangulates a planar contour with holes into plan triangles. */
export function triangulate2D(contour: Vec2[], holes: Vec2[][]): Vec2[][] {
  // triangulateShape drops a closing duplicate point in place: index into the cleaned copies.
  const c = contour.map((p) => new Vector2(p.x, p.y));
  const hs = holes.map((h) => h.map((p) => new Vector2(p.x, p.y)));
  const tris = ShapeUtils.triangulateShape(c, hs);
  const pts = [c, ...hs].flat();
  const out: Vec2[][] = [];
  for (const [i = -1, j = -1, k = -1] of tris) {
    const a = pts[i];
    const b = pts[j];
    const d = pts[k];
    if (a && b && d) out.push([a, b, d].map((v) => ({ x: v.x, y: v.y })));
  }
  return out;
}

/** Counter-clockwise copy of a polygon. */
export const ccw = (poly: Vec2[]): Vec2[] => (signedArea(poly) < 0 ? [...poly].reverse() : poly);

/** Sutherland–Hodgman clip of a convex polygon to the half-plane `sign · side(a→b) ≥ 0`. */
function clipHalf(poly: Vec2[], a: Vec2, b: Vec2, sign: number): Vec2[] {
  const side = (p: Vec2): number => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp >= 0) out.push(p);
    if (sp >= 0 !== sq >= 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

/**
 * `poly − cut` for a convex `poly` and a convex counter-clockwise `cut`, as convex pieces: for
 * each edge of `cut`, the part of what remains that lies outside it.
 */
function subtractConvex(poly: Vec2[], cut: Vec2[]): Vec2[][] {
  const out: Vec2[][] = [];
  let rest = poly;
  for (let i = 0; i < cut.length && rest.length >= 3; i++) {
    const a = cut[i]!;
    const b = cut[(i + 1) % cut.length]!;
    const outside = clipHalf(rest, a, b, -1);
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > MIN_AREA) out.push(outside);
    rest = clipHalf(rest, a, b, 1);
  }
  // `rest` now lies inside `cut` and is dropped.
  return out;
}

/**
 * Removes the convex `openings` from a list of convex plan polygons (e.g. triangles), returning
 * convex pieces. Openings are normalized to counter-clockwise; degenerate ones are ignored.
 */
export function cutConvex(polys: Vec2[][], openings: Vec2[][]): Vec2[][] {
  let out = polys;
  for (const o of openings) {
    if (o.length < 3 || !(Math.abs(signedArea(o)) > MIN_AREA)) continue;
    const cut = ccw(o);
    out = out.flatMap((p) => subtractConvex(p, cut));
  }
  return out;
}

/** Emits convex plan polygons as triangle fans. */
export function emitConvex(
  sink: TriangleSink,
  polys: Vec2[][],
  toW: (p: Vec2) => Vector3,
  want: Vector3,
): void {
  for (const poly of polys) {
    const w = poly.map(toW);
    for (let i = 1; i + 1 < w.length; i++) sink.tri(w[0]!, w[i]!, w[i + 1]!, want);
  }
}

/** Crossing-number point-in-polygon (boundary points are undefined; callers probe off edges). */
export function insideRing(p: Vec2, ring: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Parameters in (0, 1) where segment p→q crosses an edge of any of the rings. */
function crossings(p: Vec2, q: Vec2, rings: Vec2[][]): number[] {
  const out: number[] = [];
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const sx = b.x - a.x;
      const sy = b.y - a.y;
      const den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-15) continue; // parallel: the probes decide
      const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den;
      const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t);
    }
  }
  return out;
}

/**
 * Splits segment p→q where it crosses any of `rings` and returns the sub-segments whose
 * material-side probe (at `PROBE` to the left when `left`, else to the right) passes `keep`.
 */
export function keptPieces(
  p: Vec2,
  q: Vec2,
  rings: Vec2[][],
  left: boolean,
  keep: (probe: Vec2) => boolean,
): [Vec2, Vec2][] {
  const len = Math.hypot(q.x - p.x, q.y - p.y);
  if (!(len > 1e-9)) return [];
  const s = left ? 1 : -1;
  const nx = (-(q.y - p.y) / len) * s;
  const ny = ((q.x - p.x) / len) * s;
  const ts = [0, ...crossings(p, q, rings).sort((a, b) => a - b), 1];
  const at = (t: number): Vec2 => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    if ((t1 - t0) * len < 1e-9) continue;
    const m = at((t0 + t1) / 2);
    if (keep({ x: m.x + nx * PROBE, y: m.y + ny * PROBE })) out.push([at(t0), at(t1)]);
  }
  return out;
}
