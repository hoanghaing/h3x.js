import type { Floor, Id, Vec2 } from '../core';
import { GEOM_TOL, MIN_WALL_LENGTH } from '../core/constants';
import { closestPointOnSegment } from '../core/geometry/segment';
import { roomPolygon } from '../core/rooms/detect';

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

type PlanNodeLike = Vec2 & { id: Id };

export type DrawSnapTarget =
  | { kind: 'node'; id: Id }
  | { kind: 'wall'; id: Id }
  | { kind: 'site-vertex' }
  | { kind: 'site-edge' }
  | { kind: 'free' };

/**
 * What a drawing snap locked onto, for the overlay: a wall's midpoint, the foot of the
 * perpendicular from the segment start, a wall's extension line (from its end), or an axis / 45°
 * ray from the segment start (Shift ortho or the angle lock). `from` starts the line drawn to `at`.
 */
export interface SnapMark {
  kind: 'midpoint' | 'perpendicular' | 'extension' | 'ray';
  at: Vec2;
  from?: Vec2;
}

export interface DrawSnapResult extends SnapResult {
  target: DrawSnapTarget;
  marks?: SnapMark[];
  /** Set when the point was locked to a 45-degree ray from `from`; the overlay may draw `from` to `to`. */
  angleLock?: { from: Vec2; to: Vec2 };
}

/** How far past a wall's end (m) its extension line is offered. */
const EXTENSION_REACH = 20;

/** `from` + the axis direction nearer to `p - from`; the length snaps to `grid`. */
function orthoPoint(p: Vec2, from: Vec2, grid: number): Vec2 {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const len = snapScalar(Math.abs(horizontal ? dx : dy), grid);
  const sign = (horizontal ? dx : dy) < 0 ? -1 : 1;
  return horizontal
    ? { x: tidy(from.x + sign * len), y: from.y }
    : { x: from.x, y: tidy(from.y + sign * len) };
}

const ANGLE_STEP = Math.PI / 4;
const ANGLE_TOLERANCE = (5 * Math.PI) / 180;

/**
 * Snap for drawing tools. Priority: node within `reach` > closest point on a
 * wall center line within `reach` > a `site` corner within `reach` > the closest point on a `site`
 * edge within `reach` > alignment to nodes and `extra` > 45-degree
 * angle lock from `from` (length grid-snapped) > grid. With `structure: false` the node and
 * wall targets are skipped (nodes still serve as alignment points). `exclude` nodes are neither
 * targets nor alignment points, and walls touching them are not targets. A wall hit closer than
 * `MIN_WALL_LENGTH` to an end of the wall (where a split would fail) snaps to that end node.
 * Through `ToolContext.snapDraw` the plan passes the project site whenever there is one, so site
 * corners and edges are targets for every tool using it: drawing (walls, columns, roofs) and
 * node, column and roof-vertex drags in the select tool alike; `site: false` turns them off.
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
    /** Site outline; its corners and edges are snap targets (ignores `structure` and `exclude`; callers omit it to turn site snapping off). */
    site?: readonly Vec2[];
    /**
     * With `from`: keep the point on the horizontal or vertical through `from` (the nearer one),
     * its length on the grid or aligned to a node; only a node or wall centre line lying exactly
     * on that ray stays a target.
     */
    ortho?: boolean;
  },
): DrawSnapResult {
  const skip = new Set(opts.exclude);
  const nodes = Object.values(floor.nodes).filter((n) => !skip.has(n.id));
  const liveWalls = Object.values(floor.walls).filter(
    (w) => !skip.has(w.a) && !skip.has(w.b) && floor.nodes[w.a] && floor.nodes[w.b],
  );

  if (opts.ortho && opts.from) {
    const from = opts.from;
    let point = orthoPoint(p, from, opts.grid);
    const horizontal = point.y === from.y;
    const guides: SnapGuide[] = [];
    if (opts.align) {
      // The free coordinate may align to a node (as in snapPoint), the other stays on the ray.
      const a = horizontal ? 'x' : 'y';
      let best: Vec2 | undefined;
      for (const o of [...nodes, ...(opts.extra ?? [])]) {
        const d = Math.abs(o[a] - p[a]);
        if (d <= opts.alignRadius && (!best || d < Math.abs(best[a] - p[a]))) best = o;
      }
      if (best) {
        point = horizontal ? { x: tidy(best.x), y: from.y } : { x: from.x, y: tidy(best.y) };
        guides.push({ axis: a, value: tidy(best[a]), from: best });
      }
    }
    const marks: SnapMark[] = [{ kind: 'ray', at: point, from }];
    const on = nodes.find((n) => Math.hypot(n.x - point.x, n.y - point.y) <= GEOM_TOL);
    if (on && (opts.structure ?? true)) {
      return { point: { x: on.x, y: on.y }, guides, target: { kind: 'node', id: on.id }, marks };
    }
    for (const w of opts.structure === false ? [] : liveWalls) {
      const a = floor.nodes[w.a]!;
      const b = floor.nodes[w.b]!;
      const q = closestPointOnSegment(point, a, b).point;
      const ends = Math.min(Math.hypot(q.x - a.x, q.y - a.y), Math.hypot(q.x - b.x, q.y - b.y));
      if (Math.hypot(q.x - point.x, q.y - point.y) <= GEOM_TOL && ends >= MIN_WALL_LENGTH) {
        return { point, guides, target: { kind: 'wall', id: w.id }, marks };
      }
    }
    return { point, guides, target: { kind: 'free' }, marks };
  }

  const structure = opts.structure ?? true;
  let nodeHit: { id: Id; d: number; at: Vec2 } | undefined;
  for (const n of structure ? nodes : []) {
    const d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d <= opts.reach && (!nodeHit || d < nodeHit.d))
      nodeHit = { id: n.id, d, at: { x: n.x, y: n.y } };
  }
  if (nodeHit) return { point: nodeHit.at, guides: [], target: { kind: 'node', id: nodeHit.id } };

  // A wall's midpoint, then the foot of the perpendicular from the segment start, both within
  // reach; neither closer than MIN_WALL_LENGTH to a wall end (a split there would fail).
  let special: { id: Id; d: number; at: Vec2; mark: SnapMark } | undefined;
  for (const w of structure ? liveWalls : []) {
    const a = floor.nodes[w.a]!;
    const b = floor.nodes[w.b]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len / 2 < MIN_WALL_LENGTH - GEOM_TOL) continue;
    const mid = { x: tidy((a.x + b.x) / 2), y: tidy((a.y + b.y) / 2) };
    const d = Math.hypot(mid.x - p.x, mid.y - p.y);
    if (d <= opts.reach && (!special || d < special.d)) {
      special = { id: w.id, d, at: mid, mark: { kind: 'midpoint', at: mid } };
    }
  }
  if (!special && opts.from) {
    const from = opts.from;
    for (const w of structure ? liveWalls : []) {
      const a = floor.nodes[w.a]!;
      const b = floor.nodes[w.b]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
      const t = (from.x - a.x) * u.x + (from.y - a.y) * u.y;
      if (t < MIN_WALL_LENGTH - GEOM_TOL || t > len - MIN_WALL_LENGTH + GEOM_TOL) continue;
      const foot = { x: tidy(a.x + u.x * t), y: tidy(a.y + u.y * t) };
      if (Math.hypot(foot.x - from.x, foot.y - from.y) <= GEOM_TOL) continue;
      const d = Math.hypot(foot.x - p.x, foot.y - p.y);
      if (d <= opts.reach && (!special || d < special.d)) {
        special = { id: w.id, d, at: foot, mark: { kind: 'perpendicular', at: foot, from } };
      }
    }
  }
  if (special) {
    return {
      point: special.at,
      guides: [],
      target: { kind: 'wall', id: special.id },
      marks: [special.mark],
    };
  }

  let wallHit:
    { id: Id; d: number; at: Vec2; a: Vec2 & { id: Id }; b: Vec2 & { id: Id } } | undefined;
  for (const w of structure ? liveWalls : []) {
    const a = floor.nodes[w.a]! as PlanNodeLike;
    const b = floor.nodes[w.b]! as PlanNodeLike;
    const { point } = closestPointOnSegment(p, a, b);
    const d = Math.hypot(point.x - p.x, point.y - p.y);
    if (d <= opts.reach && (!wallHit || d < wallHit.d)) wallHit = { id: w.id, d, at: point, a, b };
  }
  if (wallHit) {
    const { at, a, b } = wallHit;
    const da = Math.hypot(at.x - a.x, at.y - a.y);
    const db = Math.hypot(at.x - b.x, at.y - b.y);
    const end = da <= db ? { n: a, d: da } : { n: b, d: db };
    if (end.d < MIN_WALL_LENGTH - GEOM_TOL)
      return {
        point: { x: end.n.x, y: end.n.y },
        guides: [],
        target: { kind: 'node', id: end.n.id },
      };
    return { point: at, guides: [], target: { kind: 'wall', id: wallHit.id } };
  }

  const site = opts.site ?? [];
  let vertexHit: { d: number; at: Vec2 } | undefined;
  for (const v of site) {
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    if (d <= opts.reach && (!vertexHit || d < vertexHit.d)) vertexHit = { d, at: v };
  }
  if (vertexHit)
    return {
      point: { x: vertexHit.at.x, y: vertexHit.at.y },
      guides: [],
      target: { kind: 'site-vertex' },
    };
  let edgeHit: { d: number; at: Vec2 } | undefined;
  if (site.length >= 2)
    for (let i = 0; i < site.length; i++) {
      const { point } = closestPointOnSegment(p, site[i]!, site[(i + 1) % site.length]!);
      const d = Math.hypot(point.x - p.x, point.y - p.y);
      if (d <= opts.reach && (!edgeHit || d < edgeHit.d)) edgeHit = { d, at: point };
    }
  if (edgeHit) return { point: edgeHit.at, guides: [], target: { kind: 'site-edge' } };

  // A wall's extension line past either end, within reach of it; the distance from the end
  // snaps to the grid.
  let ext: { d: number; at: Vec2; end: Vec2 } | undefined;
  for (const w of structure ? liveWalls : []) {
    const a = floor.nodes[w.a]!;
    const b = floor.nodes[w.b]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    for (const [end, other] of [
      [b, a],
      [a, b],
    ] as const) {
      const u = { x: (end.x - other.x) / len, y: (end.y - other.y) / len };
      const t = (p.x - end.x) * u.x + (p.y - end.y) * u.y;
      if (t <= opts.reach || t > EXTENSION_REACH) continue;
      const d = Math.abs((p.x - end.x) * u.y - (p.y - end.y) * u.x);
      if (d > opts.reach || (ext && d >= ext.d)) continue;
      const tt = opts.grid > 0 ? snapScalar(t, opts.grid) : t;
      ext = {
        d,
        at: { x: tidy(end.x + u.x * tt), y: tidy(end.y + u.y * tt) },
        end: { x: end.x, y: end.y },
      };
    }
  }
  if (ext) {
    return {
      point: ext.at,
      guides: [],
      target: { kind: 'free' },
      marks: [{ kind: 'extension', at: ext.at, from: ext.end }],
    };
  }

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
  return {
    point,
    guides: [],
    target: free,
    angleLock: { from: opts.from, to: point },
    marks: [{ kind: 'ray', at: point, from: opts.from }],
  };
}

/** The nearest room wall-face (inner outline) vertex within `radius` of `p`, if any. */
export function nearestFaceVertex(p: Vec2, floor: Readonly<Floor>, radius: number): Vec2 | null {
  let best: Vec2 | null = null;
  let bestDist = Infinity;
  for (const room of Object.values(floor.rooms)) {
    for (const v of roomPolygon(floor as Floor, room, 'inner')) {
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d <= radius && d < bestDist) {
        best = v;
        bestDist = d;
      }
    }
  }
  return best;
}

/**
 * Snap for stair bay corners: with `align`, a room's inner-outline (wall face) vertex within
 * `alignRadius` wins; otherwise the point rounds to the grid.
 */
export function snapBayCorner(p: Vec2, floor: Readonly<Floor>, opts: SnapOptions): SnapResult {
  const best = opts.align ? nearestFaceVertex(p, floor, opts.alignRadius) : null;
  if (best) return { point: { x: best.x, y: best.y }, guides: [] };
  return { point: { x: snapScalar(p.x, opts.grid), y: snapScalar(p.y, opts.grid) }, guides: [] };
}
