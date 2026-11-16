import type { Floor, Id, Vec2 } from '../core';
import { closestPointOnSegment } from '../core/geometry/segment';

export interface SnapOptions {
  /** Grid step in meters; `<= 0` disables grid snapping. */
  grid: number;
  /** Whether to align to other nodes. */
  align: boolean;
  /** Alignment reach in meters (callers pass `8 / view.scale`). */
  alignRadius: number;
}

export interface SnapGuide {
  axis: 'x' | 'y';
  value: number;
  /** Position of the node that was aligned to. */
  from: Vec2;
}

export interface SnapResult {
  point: Vec2;
  guides: SnapGuide[];
}

const tidy = (n: number): number => {
  const r = Math.round(n * 1e9) / 1e9;
  return r === 0 ? 0 : r;
};

/** Rounds `v` to the nearest multiple of `grid`; a non-positive grid leaves it as is. */
export function snapScalar(v: number, grid: number): number {
  if (!(grid > 0)) return v;
  return tidy(Math.round(v / grid) * grid);
}

/**
 * Snaps a point per axis: alignment to the nearest other node within
 * `alignRadius` wins over the grid; otherwise the axis rounds to the grid.
 */
export function snapPoint(p: Vec2, others: Vec2[], opts: SnapOptions): SnapResult {
  const guides: SnapGuide[] = [];
  const axis = (a: 'x' | 'y'): number => {
    if (opts.align) {
      let best: Vec2 | undefined;
      let bestDist = Infinity;
      for (const o of others) {
        const d = Math.abs(o[a] - p[a]);
        if (d <= opts.alignRadius && d < bestDist) {
          best = o;
          bestDist = d;
        }
      }
      if (best) {
        guides.push({ axis: a, value: tidy(best[a]), from: best });
        return tidy(best[a]);
      }
    }
    return opts.grid > 0 ? snapScalar(p[a], opts.grid) : p[a];
  };
  return { point: { x: axis('x'), y: axis('y') }, guides };
}

export type DrawSnapTarget = { kind: 'node'; id: Id } | { kind: 'wall'; id: Id } | { kind: 'free' };

export interface DrawSnapResult extends SnapResult {
  target: DrawSnapTarget;
  /** Set when the point was locked to a 45-degree ray from `from`; the overlay may draw `from` to `to`. */
  angleLock?: { from: Vec2; to: Vec2 };
}

const ANGLE_STEP = Math.PI / 4;
const ANGLE_TOLERANCE = (5 * Math.PI) / 180;

/**
 * Snap for drawing tools. Priority: node within `reach` > closest point on a
 * wall center line within `reach` > alignment to nodes and `extra` > 45-degree
 * angle lock from `from` (length grid-snapped) > grid. With `structure: false` the node and
 * wall targets are skipped (nodes still serve as alignment points). `exclude` nodes are neither
 * targets nor alignment points, and walls touching them are not targets.
 */
export function snapDraw(
  p: Vec2,
  floor: Readonly<Floor>,
  opts: SnapOptions & {
    reach: number;
    from?: Vec2;
    extra?: Vec2[];
    structure?: boolean;
    exclude?: Id[];
  },
): DrawSnapResult {
  const skip = new Set(opts.exclude);
  const nodes = Object.values(floor.nodes).filter((n) => !skip.has(n.id));

  const structure = opts.structure ?? true;
  let nodeHit: { id: Id; d: number; at: Vec2 } | undefined;
  for (const n of structure ? nodes : []) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= opts.reach && (!nodeHit || d < nodeHit.d))
      nodeHit = { id: n.id, d, at: { x: n.x, y: n.y } };
  }
  if (nodeHit) return { point: nodeHit.at, guides: [], target: { kind: 'node', id: nodeHit.id } };

  let wallHit: { id: Id; d: number; at: Vec2 } | undefined;
  for (const w of structure ? Object.values(floor.walls) : []) {
    if (skip.has(w.a) || skip.has(w.b)) continue;
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (!a || !b) continue;
    const { point } = closestPointOnSegment(p, a, b);
    const d = Math.hypot(point.x - p.x, point.y - p.y);
    if (d <= opts.reach && (!wallHit || d < wallHit.d)) wallHit = { id: w.id, d, at: point };
  }
  if (wallHit) return { point: wallHit.at, guides: [], target: { kind: 'wall', id: wallHit.id } };

  const snapped = snapPoint(p, [...nodes, ...(opts.extra ?? [])], opts);
  const free: DrawSnapTarget = { kind: 'free' };
  if (snapped.guides.length > 0 || !opts.from) return { ...snapped, target: free };

  const dx = p.x - opts.from.x;
  const dy = p.y - opts.from.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return { ...snapped, target: free };
  const angle = Math.atan2(dy, dx);
  const step = Math.round(angle / ANGLE_STEP) * ANGLE_STEP;
  if (Math.abs(angle - step) > ANGLE_TOLERANCE) return { ...snapped, target: free };

  const snappedLen = opts.grid > 0 ? snapScalar(len, opts.grid) : len;
  const point = {
    x: tidy(opts.from.x + snappedLen * Math.cos(step)),
    y: tidy(opts.from.y + snappedLen * Math.sin(step)),
  };
  return { point, guides: [], target: free, angleLock: { from: opts.from, to: point } };
}
