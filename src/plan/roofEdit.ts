import {
  detachRoof,
  floorOutline,
  roofGeometry,
  updateRoof,
  type Command,
  type CommandContext,
  type Floor,
  type Id,
  type Roof,
  type RoofEdge,
  type RoofGeometry,
  type Vec2,
} from '../core';
import { closestPointOnSegment } from '../core/geometry/segment';

/** A vertex of a roof outline: `hole` undefined is the outer ring (follow roofs: the first body's). */
export interface RoofVertexRef {
  hole?: number;
  index: number;
}

/** An edge of a roof outline; `wallId` is set for follow roofs. */
export interface RoofEdgeRef extends RoofVertexRef {
  wallId?: Id;
}

export interface RoofHandle extends RoofVertexRef {
  at: Vec2;
}

/** Screen reach (px) of a roof vertex handle, and of a click on a roof edge. */
export const ROOF_HANDLE_PX = 8;
export const ROOF_EDGE_PX = 6;

const cached = (roof: Roof, floor: Readonly<Floor>, geo?: RoofGeometry): RoofGeometry =>
  geo ?? roofGeometry(roof, floor);

/**
 * Vertex handles of a roof. An independent roof offers its points and its holes' points; a follow
 * roof the outer ring of its first body (the ring `detachRoof` keeps on the roof).
 */
export function roofHandles(roof: Roof, floor: Readonly<Floor>, geo?: RoofGeometry): RoofHandle[] {
  if (roof.follow) {
    const ring = cached(roof, floor, geo).bodies[0]?.outline[0] ?? [];
    return ring.map((at, index) => ({ index, at }));
  }
  const out: RoofHandle[] = (roof.points ?? []).map((at, index) => ({ index, at }));
  (roof.holes ?? []).forEach((h, hole) => h.forEach((at, index) => out.push({ hole, index, at })));
  return out;
}

/** Rings (with their edge refs) that can be clicked: outline and holes, or a follow roof's walls. */
function edgeRings(
  roof: Roof,
  floor: Readonly<Floor>,
): { ring: readonly Vec2[]; hole?: number; walls?: readonly Id[] }[] {
  if (roof.follow) {
    return floorOutline(floor, roof.rooms ?? []).map((r) => ({ ring: r.points, walls: r.walls }));
  }
  const out: { ring: readonly Vec2[]; hole?: number }[] = [];
  if (roof.points) out.push({ ring: roof.points });
  (roof.holes ?? []).forEach((ring, hole) => out.push({ ring, hole }));
  return out;
}

/** The nearest roof outline edge within `reach` meters of `p`, with the current spec of that edge. */
export function roofEdgeAt(
  roof: Roof,
  floor: Readonly<Floor>,
  p: Vec2,
  reach: number,
): { ref: RoofEdgeRef; current: RoofEdge } | null {
  let best: { ref: RoofEdgeRef; d: number } | null = null;
  for (const { ring, hole, walls } of edgeRings(roof, floor)) {
    ring.forEach((a, index) => {
      const b = ring[(index + 1) % ring.length]!;
      const q = closestPointOnSegment(p, a, b).point;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > reach || (best && best.d <= d)) return;
      const wallId = walls?.[index];
      best = {
        d,
        ref: {
          index,
          ...(hole !== undefined ? { hole } : {}),
          ...(wallId !== undefined ? { wallId } : {}),
        },
      };
    });
  }
  const found = best as { ref: RoofEdgeRef; d: number } | null;
  if (!found) return null;
  const { ref } = found;
  const fallback: RoofEdge = { kind: 'slope', pitch: roof.pitch };
  const current = roof.follow
    ? (roof.wallEdges?.[ref.wallId ?? ''] ?? fallback)
    : ref.hole === undefined
      ? (roof.edges?.[ref.index] ?? fallback)
      : (roof.holeEdges?.[ref.hole]?.[ref.index] ?? fallback);
  return { ref, current: structuredClone(current) };
}

/** The nearest vertex handle of `handles` within `reach` meters of `p`. */
export function nearestHandle(
  handles: readonly RoofHandle[],
  p: Vec2,
  reach: number,
): RoofHandle | null {
  let best: RoofHandle | null = null;
  let bestD = reach;
  for (const h of handles) {
    const d = Math.hypot(h.at.x - p.x, h.at.y - p.y);
    if (d <= bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

function moved(points: readonly Vec2[], index: number, to: Vec2): Vec2[] {
  return points.map((p, i) => (i === index ? { x: to.x, y: to.y } : { x: p.x, y: p.y }));
}

/** Patch that moves one vertex of an independent roof. */
function vertexPatch(roof: Roof, ref: RoofVertexRef, to: Vec2): Partial<Roof> {
  if (ref.hole === undefined) return { points: moved(roof.points ?? [], ref.index, to) };
  return {
    holes: (roof.holes ?? []).map((h, i) => (i === ref.hole ? moved(h, ref.index, to) : h)),
  };
}

/** Command moving one vertex of an independent roof. */
export function moveRoofVertex(id: Id, roof: Roof, ref: RoofVertexRef, to: Vec2): Command {
  return updateRoof(id, vertexPatch(roof, ref, to));
}

/** Command translating every point and hole point of an independent roof. */
export function translateRoof(id: Id, roof: Roof, d: Vec2): Command {
  const shift = (ring: readonly Vec2[]): Vec2[] =>
    ring.map((p) => ({ x: p.x + d.x, y: p.y + d.y }));
  return updateRoof(id, {
    points: shift(roof.points ?? []),
    ...(roof.holes ? { holes: roof.holes.map(shift) } : {}),
  });
}

/**
 * One command that detaches a follow roof and moves an outer-ring vertex of the detached roof, so a
 * single undo restores the follow roof. `newIds` is filled by `run` (see `detachRoof`).
 */
export function detachAndMoveVertex(id: Id, index: number, to: Vec2): Command & { newIds: Id[] } {
  const detach = detachRoof(id);
  return {
    label: 'detachRoof',
    newIds: detach.newIds,
    run: (ctx: CommandContext) => {
      const changes = detach.run(ctx);
      const own = changes.find((c) => c.kind === 'roof' && c.id === id);
      if (!own || own.kind !== 'roof' || !own.after || !own.before) return changes;
      const floor = { ...ctx.floor, roofs: { ...ctx.floor.roofs, [id]: own.after } };
      const patched = updateRoof(id, vertexPatch(own.after, { index }, to)).run({ ...ctx, floor });
      const after = patched.find((c) => c.kind === 'roof' && c.id === id);
      if (after?.kind !== 'roof' || !after.after) return changes;
      return changes.map((c) => (c === own ? { ...own, after: after.after } : c));
    },
  };
}
