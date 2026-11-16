import { assertFreeId, fail, notFound } from '../commands/shared';
import { GEOM_TOL, MIN_WALL_LENGTH } from '../constants';
import { closestPointOnSegment } from '../geometry/segment';
import { EPS, add, cross, distance, dot, scale, sub, tidy } from '../geometry/vec';
import { createId } from '../ids';
import { clampIntoRange, openingRange, wallUsableRange } from '../validate/layout';
import type { Floor, Id, PresetResolver, Vec2, Wall } from '../types';
import { wallsAt } from './draft';

/** Two walls within this angle (radians) count as collinear. */
export const COLLINEAR_TOL = (1 * Math.PI) / 180;

function endsOf(draft: Floor, w: Wall): [Vec2, Vec2] {
  const a = draft.nodes[w.a];
  const b = draft.nodes[w.b];
  if (!a || !b) throw notFound('Node', !a ? w.a : w.b);
  return [a, b];
}

/**
 * Keeps every opening / wall item on `wallIds` in its usable range: in range stays,
 * otherwise it is clamped when it fits, else `code` is thrown.
 */
function fitOn(
  draft: Floor,
  wallIds: Id[],
  presets: PresetResolver | undefined,
  code: string,
  why: string,
): void {
  const clamp = (id: Id, offset: number, r: { lo: number; hi: number }): number => {
    const next = clampIntoRange(offset, r);
    if (next === null) throw fail(code, [id], `${id} ${why}`);
    return next;
  };
  for (const o of Object.values(draft.openings)) {
    if (!wallIds.includes(o.wall)) continue;
    o.offset = clamp(o.id, o.offset, openingRange(draft, o));
  }
  for (const it of Object.values(draft.items)) {
    if (it.mount !== 'wall' || !wallIds.includes(it.wall)) continue;
    const width = presets?.(it.preset)?.footprint.w ?? 0;
    it.offset = clamp(it.id, it.offset, wallUsableRange(draft, it.wall, { width }));
  }
}

/**
 * Splits `wallId` at the projection of `at`. The original wall keeps the half from
 * `a`; the half to the old `b` becomes `newWallId` (same thickness, height,
 * finishes). Openings / wall items follow the half holding their center.
 * Returns the new node id.
 */
export function splitAt(
  draft: Floor,
  wallId: Id,
  at: Vec2,
  newWallId: Id,
  newNodeId: Id,
  presets?: PresetResolver,
): Id {
  const w = draft.walls[wallId];
  if (!w) throw notFound('Wall', wallId);
  const [a, b] = endsOf(draft, w);
  const len = distance(a, b);
  const dir = sub(b, a);
  const s = len > 0 ? dot(sub(at, a), dir) / len : 0;
  if (s < MIN_WALL_LENGTH - GEOM_TOL || len - s < MIN_WALL_LENGTH - GEOM_TOL) {
    throw fail(
      'split-too-short',
      [wallId],
      `Splitting wall ${wallId} there leaves a part below ${MIN_WALL_LENGTH} m`,
    );
  }
  const p = add(a, scale(dir, s / len));
  draft.nodes[newNodeId] = { id: newNodeId, x: tidy(p.x), y: tidy(p.y) };
  draft.walls[newWallId] = { ...structuredClone(w), id: newWallId, a: newNodeId, b: w.b };
  w.b = newNodeId;
  for (const o of Object.values(draft.openings)) {
    if (o.wall === wallId && o.offset > s) {
      o.wall = newWallId;
      o.offset = tidy(o.offset - s);
    }
  }
  for (const it of Object.values(draft.items)) {
    if (it.mount === 'wall' && it.wall === wallId && it.offset > s) {
      it.wall = newWallId;
      it.offset = tidy(it.offset - s);
    }
  }
  fitOn(draft, [wallId, newWallId], presets, 'split-cuts-opening', 'does not fit after the split');
  return newNodeId;
}

/** Deletes a wall with its openings and wall items; end nodes stay. */
function dropWall(draft: Floor, wallId: Id): void {
  for (const o of Object.values(draft.openings)) if (o.wall === wallId) delete draft.openings[o.id];
  for (const it of Object.values(draft.items)) {
    if (it.mount === 'wall' && it.wall === wallId) delete draft.items[it.id];
  }
  delete draft.walls[wallId];
}

/** Deletes a wall, its openings and wall items, and any end node left with no wall. */
export function removeWallIn(draft: Floor, wallId: Id): void {
  const w = draft.walls[wallId];
  if (!w) throw notFound('Wall', wallId);
  dropWall(draft, wallId);
  for (const n of [w.a, w.b]) if (wallsAt(draft, n).length === 0) delete draft.nodes[n];
}

/**
 * Degree 2: merges the two walls into one straight wall between the outer nodes
 * (first wall in id order keeps its id, thickness, height, finishes); offsets are
 * re-based and clamped, `merge-drops-opening` when one cannot fit. Two walls that
 * would merge into a zero-length or duplicate wall, degree 1 or >= 3: deletes the
 * node and every wall at it.
 */
export function removeNodeIn(draft: Floor, nodeId: Id, presets?: PresetResolver): void {
  if (!draft.nodes[nodeId]) throw notFound('Node', nodeId);
  const walls = wallsAt(draft, nodeId);
  if (walls.length === 2) {
    const [keep, other] = walls as [Wall, Wall];
    const o1 = keep.a === nodeId ? keep.b : keep.a;
    const o2 = other.a === nodeId ? other.b : other.a;
    const duplicate = wallsAt(draft, o1).some((w) => w.a === o2 || w.b === o2);
    if (o1 !== o2 && !duplicate) {
      mergeAt(draft, nodeId, keep, other, o2, presets);
      return;
    }
  }
  for (const w of walls) removeWallIn(draft, w.id);
  delete draft.nodes[nodeId];
}

function mergeAt(
  draft: Floor,
  nodeId: Id,
  keep: Wall,
  other: Wall,
  o2: Id,
  presets: PresetResolver | undefined,
): void {
  const keepLen = distance(...endsOf(draft, keep));
  const otherLen = distance(...endsOf(draft, other));
  // `other` runs against the merged wall when both walls start (or both end) at the node.
  const reversed = (keep.a === nodeId) === (other.a === nodeId);
  // Distance of a point on each wall from the merged wall's start, along the old walls.
  let fromKeep: (off: number) => number;
  let fromOther: (off: number) => number;
  if (keep.b === nodeId) {
    // o1 -> node -> o2
    fromKeep = (off) => off;
    fromOther = (off) => keepLen + (other.a === nodeId ? off : otherLen - off);
    keep.b = o2;
  } else {
    // o2 -> node -> o1
    fromOther = (off) => (other.b === nodeId ? off : otherLen - off);
    fromKeep = (off) => otherLen + off;
    keep.a = o2;
  }
  for (const o of Object.values(draft.openings)) {
    if (o.wall === keep.id) o.offset = tidy(fromKeep(o.offset));
    else if (o.wall === other.id) {
      o.wall = keep.id;
      o.offset = tidy(fromOther(o.offset));
      // flip is relative to the wall direction (hinge end and swing side), so it mirrors too.
      if (reversed) o.flip = !o.flip;
    }
  }
  for (const it of Object.values(draft.items)) {
    if (it.mount !== 'wall') continue;
    if (it.wall === keep.id) it.offset = tidy(fromKeep(it.offset));
    else if (it.wall === other.id) {
      it.wall = keep.id;
      it.offset = tidy(fromOther(it.offset));
      if (reversed) it.side = it.side === 'left' ? 'right' : 'left';
    }
  }
  delete draft.walls[other.id];
  delete draft.nodes[nodeId];
  fitOn(draft, [keep.id], presets, 'merge-drops-opening', 'does not fit on the merged wall');
}

/** Openings plus wall items on a wall: the weight that decides which duplicate survives. */
function attachments(draft: Floor, wallId: Id): number {
  const openings = Object.values(draft.openings).filter((o) => o.wall === wallId).length;
  const items = Object.values(draft.items).filter(
    (it) => it.mount === 'wall' && it.wall === wallId,
  ).length;
  return openings + items;
}

/**
 * Re-attaches the walls of `drop` to `keep` and deletes `drop`. A wall that would join
 * `keep` to itself is deleted (with its openings / items); of two walls then joining the
 * same nodes, the one with more openings + wall items survives (ties: smaller id) and the
 * other's openings / items are deleted. Openings / wall items on re-attached walls are
 * clamped to the new length, `merge-drops-opening` when one cannot fit. Same node:
 * `invalid-target`.
 */
export function mergeNodesIn(draft: Floor, keep: Id, drop: Id, presets?: PresetResolver): void {
  if (!draft.nodes[keep]) throw notFound('Node', keep);
  if (!draft.nodes[drop]) throw notFound('Node', drop);
  if (keep === drop) {
    throw fail('invalid-target', [keep], `Cannot merge node ${keep} with itself`);
  }
  const moved: Id[] = [];
  for (const w of wallsAt(draft, drop)) {
    const far = w.a === drop ? w.b : w.a;
    if (far === keep) {
      dropWall(draft, w.id);
      continue;
    }
    if (w.a === drop) w.a = keep;
    else w.b = keep;
    moved.push(w.id);
  }
  delete draft.nodes[drop];
  const seen = new Map<Id, Wall>();
  for (const w of wallsAt(draft, keep)) {
    const far = w.a === keep ? w.b : w.a;
    const other = seen.get(far);
    if (!other) {
      seen.set(far, w);
      continue;
    }
    const [first, second] = other.id < w.id ? [other, w] : [w, other];
    const loser = attachments(draft, second.id) > attachments(draft, first.id) ? first : second;
    dropWall(draft, loser.id);
    seen.set(far, loser === first ? second : first);
  }
  fitOn(
    draft,
    moved.filter((id) => draft.walls[id]),
    presets,
    'merge-drops-opening',
    'does not fit on the re-attached wall',
  );
}

/**
 * Moves `nodeId` onto `target` and merges it, in one go: onto a node (`mergeNodesIn`) or
 * onto a point of a wall (the wall is split there, T-junction, then merged into the new
 * node). Dropping onto itself or onto one of its own walls: `invalid-target`.
 */
export function dropNodeIn(
  draft: Floor,
  nodeId: Id,
  target: { node: Id } | { wall: Id; at: Vec2 },
  ids: { wall: Id; node: Id },
  presets?: PresetResolver,
): void {
  if (!draft.nodes[nodeId]) throw notFound('Node', nodeId);
  if ('node' in target) {
    mergeNodesIn(draft, target.node, nodeId, presets);
    return;
  }
  const w = draft.walls[target.wall];
  if (!w) throw notFound('Wall', target.wall);
  if (w.a === nodeId || w.b === nodeId) {
    throw fail(
      'invalid-target',
      [nodeId, w.id],
      `Node ${nodeId} cannot be dropped on its own wall`,
    );
  }
  assertFreeId({ floor: draft }, ids.wall);
  assertFreeId({ floor: draft }, ids.node);
  const t = splitAt(draft, target.wall, target.at, ids.wall, ids.node, presets);
  mergeNodesIn(draft, t, nodeId, presets);
}

/** A wall end: an existing node, or a point (snapped to a node, or splitting a wall, when on one). */
export type WallEnd = { node: Id } | { at: Vec2 };

export interface NewWall {
  from: WallEnd;
  to: WallEnd;
  thickness: number;
  height?: number;
}

/** A point the new wall passes through: an existing node, a wall to split, or a free point. */
interface Stop {
  t: number;
  p: Vec2;
  node?: Id;
  wall?: Id;
}

function endPoint(draft: Floor, end: WallEnd): Vec2 {
  if ('at' in end) return end.at;
  const n = draft.nodes[end.node];
  if (!n) throw notFound('Node', end.node);
  return n;
}

/** The existing node an end stands on: the given node, or the nearest node within GEOM_TOL. */
function nodeOf(draft: Floor, end: WallEnd): Id | undefined {
  if ('node' in end) return end.node;
  let best: { id: Id; d: number } | undefined;
  for (const n of Object.values(draft.nodes)) {
    const d = distance(n, end.at);
    if (d < GEOM_TOL && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id;
}

const offLine = (c: Vec2, p: Vec2, q: Vec2): number =>
  Math.abs(cross(sub(q, p), sub(c, p))) / distance(p, q);

/**
 * Adds a wall from `from` to `to`. Ends reuse a node within GEOM_TOL or split the wall
 * they lie on (T-junction); existing nodes on the way and crossed walls split the new
 * wall, crossed walls are split too. `ids.wall` names the piece touching `from`,
 * `ids.endNode` a new node at `to`. Ends already joined by a wall: no change, that wall
 * is returned. Throws `wall-too-short`, `walls-overlap` (collinear overlap), `not-found`.
 */
export function addWallIn(
  draft: Floor,
  spec: NewWall,
  ids: { wall: Id; endNode: Id },
  presets?: PresetResolver,
): { wallId: Id; endNodeId: Id } {
  const p = endPoint(draft, spec.from);
  const q = endPoint(draft, spec.to);
  const len = distance(p, q);
  const tooShort = (): Error =>
    fail('wall-too-short', [ids.wall], `A wall must be at least ${MIN_WALL_LENGTH} m long`);
  if (len < MIN_WALL_LENGTH - GEOM_TOL) throw tooShort();
  const na = nodeOf(draft, spec.from);
  const nb = nodeOf(draft, spec.to);
  if (na && nb) {
    const dup = wallsAt(draft, na).find((w) => w.a === nb || w.b === nb);
    if (dup) return { wallId: dup.id, endNodeId: nb };
  }
  assertFreeId({ floor: draft }, ids.wall);
  assertFreeId({ floor: draft }, ids.endNode);

  const d = sub(q, p);
  const stops: Stop[] = [];
  for (const n of Object.values(draft.nodes)) {
    if (n.id === na) stops.push({ t: 0, p: n, node: n.id });
    else if (n.id === nb) stops.push({ t: 1, p: n, node: n.id });
    else {
      const c = closestPointOnSegment(n, p, q);
      if (distance(c.point, n) < GEOM_TOL) stops.push({ t: c.t, p: n, node: n.id });
    }
  }
  for (const w of Object.values(draft.walls)) {
    const [a, b] = endsOf(draft, w);
    const wl = distance(a, b);
    const collinear =
      (offLine(a, p, q) < GEOM_TOL && offLine(b, p, q) < GEOM_TOL) ||
      (wl > 0 && offLine(p, a, b) < GEOM_TOL && offLine(q, a, b) < GEOM_TOL);
    if (collinear) {
      const ta = dot(sub(a, p), d) / len;
      const tb = dot(sub(b, p), d) / len;
      const overlap = Math.min(len, Math.max(ta, tb)) - Math.max(0, Math.min(ta, tb));
      if (overlap > GEOM_TOL) {
        throw fail('walls-overlap', [ids.wall, w.id], `The new wall overlaps wall ${w.id}`);
      }
      continue;
    }
    const e = sub(b, a);
    const den = cross(d, e);
    if (Math.abs(den) < EPS) continue;
    const ap = sub(a, p);
    const t = cross(ap, e) / den;
    const u = cross(ap, d) / den;
    if (t < -GEOM_TOL / len || t > 1 + GEOM_TOL / len) continue;
    if (u < -GEOM_TOL / wl || u > 1 + GEOM_TOL / wl) continue;
    const x = add(p, scale(d, t));
    // Passing within GEOM_TOL of a wall end is passing through that node (a node stop).
    if (distance(x, a) < GEOM_TOL || distance(x, b) < GEOM_TOL) continue;
    stops.push({ t: Math.min(1, Math.max(0, t)), p: x, wall: w.id });
  }
  if (!stops.some((s) => distance(s.p, p) < GEOM_TOL)) stops.push({ t: 0, p });
  if (!stops.some((s) => distance(s.p, q) < GEOM_TOL)) stops.push({ t: 1, p: q });
  stops.sort((s1, s2) => s1.t - s2.t);

  const last = stops.length - 1;
  const nodeIds = stops.map((s, i) => {
    if (s.node) return s.node;
    const id = i === last ? ids.endNode : createId();
    if (s.wall) return splitAt(draft, s.wall, s.p, createId(), id, presets);
    draft.nodes[id] = { id, x: tidy(s.p.x), y: tidy(s.p.y) };
    return id;
  });
  for (let i = 0; i < last; i++) {
    const a = nodeIds[i]!;
    const b = nodeIds[i + 1]!;
    if (distance(draft.nodes[a]!, draft.nodes[b]!) < MIN_WALL_LENGTH - GEOM_TOL) throw tooShort();
    const id = i === 0 ? ids.wall : createId();
    draft.walls[id] = {
      id,
      a,
      b,
      thickness: spec.thickness,
      height: spec.height ?? draft.wallHeight,
    };
  }
  return { wallId: ids.wall, endNodeId: nodeIds[last]! };
}
