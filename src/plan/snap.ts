import type { Vec2 } from '../core';

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
