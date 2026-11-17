import { GEOM_TOL } from './constants';
import { obbCorners } from './geometry/obb';
import { add, dot, leftNormal, normalize, scale, sub } from './geometry/vec';
import type { Column, Floor, Id, Item, Opening, PresetResolver, Vec2 } from './types';
import { computeJoins, type WallCorners } from './walls/joins';

/*
 * One plan outline per kind. The plan draws, highlights and hit-tests these, and the validators
 * measure overlap and containment against the same shapes, so what is drawn is what is checked.
 */

/** Thickness (m) of the box drawn for a wall-mounted item. */
export const WALL_ITEM_DEPTH = 0.1;
/** Segments of the polygon standing in for a round column in polygon overlap tests. */
const ROUND_SEGMENTS = 64;

/** Wall outline from its joined corners: [startLeft, endLeft, endRight, startRight]. */
export function wallOutline(c: WallCorners): Vec2[] {
  return [c.startLeft, c.endLeft, c.endRight, c.startRight];
}

/** The drawn (mitred) outline of every wall of `floor`, keyed by wall id. */
export function wallOutlines(floor: Floor): Record<Id, Vec2[]> {
  const out: Record<Id, Vec2[]> = {};
  for (const [id, c] of Object.entries(computeJoins(floor).corners)) out[id] = wallOutline(c);
  return out;
}

/** A column's plan shape: a circle, or the (rotated) rectangle's corners. */
export function columnShape(
  c: Column,
): { kind: 'circle'; cx: number; cy: number; r: number } | { kind: 'polygon'; points: Vec2[] } {
  if (c.shape === 'round') return { kind: 'circle', cx: c.x, cy: c.y, r: c.width / 2 };
  return {
    kind: 'polygon',
    points: obbCorners({
      center: { x: c.x, y: c.y },
      halfW: c.width / 2,
      halfD: (c.depth ?? c.width) / 2,
      rotation: c.rotation,
    }),
  };
}

/**
 * `columnShape` as a polygon: the rectangle, or a 64-gon inscribed in the circle (at most
 * r × 1.2e-3 inside it, 0.2 mm for a 0.3 m column) for overlap tests against polygons.
 */
export function columnPolygon(c: Column): Vec2[] {
  const s = columnShape(c);
  if (s.kind === 'polygon') return s.points;
  return Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
    const t = (i / ROUND_SEGMENTS) * Math.PI * 2;
    return { x: s.cx + Math.cos(t) * s.r, y: s.cy + Math.sin(t) * s.r };
  });
}

/** Overlap area of two circles (exact lens area). */
export function circleOverlapArea(
  a: { cx: number; cy: number; r: number },
  b: { cx: number; cy: number; r: number },
): number {
  const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
  if (d >= a.r + b.r) return 0;
  const small = Math.min(a.r, b.r);
  if (d <= Math.abs(a.r - b.r)) return Math.PI * small * small;
  const lens = (r: number, R: number): number =>
    r * r * Math.acos(Math.min(1, Math.max(-1, (d * d + r * r - R * R) / (2 * d * r))));
  const k = (-d + a.r + b.r) * (d + a.r - b.r) * (d - a.r + b.r) * (d + a.r + b.r);
  return lens(a.r, b.r) + lens(b.r, a.r) - 0.5 * Math.sqrt(Math.max(0, k));
}

/** The span [lo, hi] (offsets along its wall) an opening of `width` centred at `offset` covers. */
export function openingSpan(o: Pick<Opening, 'offset' | 'width'>): { lo: number; hi: number } {
  return { lo: o.offset - o.width / 2, hi: o.offset + o.width / 2 };
}

/** Length of the overlap of two spans (≤ 0 when they are apart). */
export function spanOverlap(a: { lo: number; hi: number }, b: { lo: number; hi: number }): number {
  return Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
}

/**
 * Plan footprint of an item, or undefined when its preset (or wall) does not resolve: the
 * rotated w × d rectangle for floor / ceiling items, a WALL_ITEM_DEPTH box against the wall face
 * for wall items.
 */
export function itemFootprint(
  item: Item,
  floor: Floor,
  presets?: PresetResolver,
): Vec2[] | undefined {
  const fp = presets?.(item.preset)?.footprint;
  if (!fp) return undefined;

  if (item.mount === 'wall') {
    const wall = floor.walls[item.wall];
    const a = wall && floor.nodes[wall.a];
    const b = wall && floor.nodes[wall.b];
    if (!wall || !a || !b) return undefined;
    const d = normalize(sub(b, a));
    const sign = item.side === 'left' ? 1 : -1;
    const n = scale(leftNormal(d), sign);
    const centre = add(
      add(a, scale(d, item.offset)),
      scale(n, wall.thickness / 2 + WALL_ITEM_DEPTH / 2),
    );
    const u = scale(d, fp.w / 2);
    const v = scale(n, WALL_ITEM_DEPTH / 2);
    return [
      sub(sub(centre, u), v),
      sub(add(centre, u), v),
      add(add(centre, u), v),
      add(sub(centre, u), v),
    ];
  }

  return obbCorners({
    center: { x: item.x, y: item.y },
    halfW: fp.w / 2,
    halfD: fp.d / 2,
    rotation: item.rotation,
  });
}

/**
 * Separating-axis test for two convex polygons (either winding): true when they overlap by more
 * than GEOM_TOL along every edge normal of both, so touching outlines do not overlap.
 */
export function convexOverlap(a: Vec2[], b: Vec2[]): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      if (len < 1e-12) continue;
      const axis = { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
      const pa = a.map((v) => dot(v, axis));
      const pb = b.map((v) => dot(v, axis));
      const overlap =
        Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
      if (overlap <= GEOM_TOL) return false;
    }
  }
  return true;
}
