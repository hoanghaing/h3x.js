import { GEOM_TOL, MIN_WALL_LENGTH } from '../constants';
import { H3xValidationError } from '../errors';
import { add, distance, dot, scale, sub } from '../geometry/vec';
import { inRange, openingRange, wallUsableRange } from '../validate/layout';
import type { Floor, Id, PresetResolver, Vec2, Wall } from '../types';
import { wallsAt } from './draft';

/** Two walls within this angle (radians) count as collinear. */
export const COLLINEAR_TOL = (1 * Math.PI) / 180;

const tidy = (n: number): number => Math.round(n * 1e9) / 1e9;

const fail = (code: string, ids: Id[], message: string): H3xValidationError =>
  new H3xValidationError([{ code, ids, message }]);

const notFound = (what: string, id: Id): H3xValidationError =>
  fail('not-found', [id], `${what} ${id} does not exist`);

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
    if (inRange(offset, r)) return offset;
    if (r.hi < r.lo - GEOM_TOL) throw fail(code, [id], `${id} ${why}`);
    return tidy(Math.min(Math.max(offset, r.lo), r.hi));
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

/** Deletes a wall, its openings and wall items, and any end node left with no wall. */
export function removeWallIn(draft: Floor, wallId: Id): void {
  const w = draft.walls[wallId];
  if (!w) throw notFound('Wall', wallId);
  for (const o of Object.values(draft.openings)) if (o.wall === wallId) delete draft.openings[o.id];
  for (const it of Object.values(draft.items)) {
    if (it.mount === 'wall' && it.wall === wallId) delete draft.items[it.id];
  }
  delete draft.walls[wallId];
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
    }
  }
  for (const it of Object.values(draft.items)) {
    if (it.mount !== 'wall') continue;
    if (it.wall === keep.id) it.offset = tidy(fromKeep(it.offset));
    else if (it.wall === other.id) {
      it.wall = keep.id;
      it.offset = tidy(fromOther(it.offset));
    }
  }
  delete draft.walls[other.id];
  delete draft.nodes[nodeId];
  fitOn(draft, [keep.id], presets, 'merge-drops-opening', 'does not fit on the merged wall');
}
