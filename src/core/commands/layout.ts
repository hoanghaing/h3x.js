import type { Command, CommandContext, EntityChange } from '../document/changes';
import { GEOM_TOL, MIN_WALL_LENGTH } from '../constants';
import { H3xValidationError } from '../errors';
import { add, distance, dot, leftNormal, scale, sub } from '../geometry/vec';
import { inRange, openingRange, wallUsableRange } from '../validate/layout';
import type { Id, Vec2, WallItem } from '../types';

const EPS = 1e-9;
const tidy = (n: number): number => Math.round(n * 1e9) / 1e9;

function notFound(what: string, id: Id): H3xValidationError {
  return new H3xValidationError([
    { code: 'not-found', ids: [id], message: `${what} ${id} does not exist` },
  ]);
}

/**
 * Node moves plus re-fit of openings / wall items on walls whose length changed. `shift` first
 * adds `by` to the offsets of the openings and wall items on one wall (to keep them fixed
 * relative to node b when node a moves).
 */
function applyMoves(
  ctx: CommandContext,
  moves: Map<Id, Vec2>,
  shift?: { wall: Id; by: number },
): EntityChange[] {
  const { floor } = ctx;
  const changes: EntityChange[] = [];
  const pos = (id: Id): Vec2 | undefined => moves.get(id) ?? floor.nodes[id];
  for (const [id, to] of moves) {
    const n = floor.nodes[id];
    if (!n) throw notFound('Node', id);
    if (Math.abs(n.x - to.x) < EPS && Math.abs(n.y - to.y) < EPS) continue;
    changes.push({ kind: 'node', id, before: structuredClone(n), after: { id, x: to.x, y: to.y } });
  }
  for (const w of Object.values(floor.walls)) {
    if (!moves.has(w.a) && !moves.has(w.b)) continue;
    const a0 = floor.nodes[w.a];
    const b0 = floor.nodes[w.b];
    const a1 = pos(w.a);
    const b1 = pos(w.b);
    if (!a0 || !b0 || !a1 || !b1) continue;
    const len = distance(a1, b1);
    if (Math.abs(distance(a0, b0) - len) < EPS) continue;
    const by = shift?.wall === w.id ? shift.by : 0;
    for (const o of Object.values(floor.openings)) {
      if (o.wall !== w.id) continue;
      const range = openingRange(floor, o, len);
      const { lo, hi } = range;
      const start = by === 0 ? o.offset : tidy(o.offset + by);
      const fits = hi >= lo - GEOM_TOL;
      const offset =
        !fits || inRange(start, range) ? start : tidy(Math.min(Math.max(start, lo), hi));
      if (offset === o.offset) continue;
      changes.push({
        kind: 'opening',
        id: o.id,
        before: structuredClone(o),
        after: { ...structuredClone(o), offset },
      });
    }
    for (const it of Object.values(floor.items)) {
      if (it.mount !== 'wall' || it.wall !== w.id) continue;
      const width = ctx.presets?.(it.preset)?.footprint.w ?? 0;
      const range = wallUsableRange(floor, w.id, { width, length: len });
      const start = by === 0 ? it.offset : tidy(it.offset + by);
      const fits = range.hi >= range.lo - GEOM_TOL;
      const offset =
        !fits || inRange(start, range)
          ? start
          : tidy(Math.min(Math.max(start, range.lo), range.hi));
      if (Math.abs(offset - it.offset) < EPS) continue;
      const after: WallItem = { ...structuredClone(it), offset };
      changes.push({ kind: 'item', id: it.id, before: structuredClone(it), after });
    }
  }
  return changes;
}

export function moveNode(nodeId: Id, to: Vec2): Command {
  return {
    label: 'moveNode',
    run: (ctx) => applyMoves(ctx, new Map([[nodeId, { x: to.x, y: to.y }]])),
  };
}

/** `delta` is projected onto the wall's left normal; both nodes move by the projection. */
export function moveWall(wallId: Id, delta: Vec2): Command {
  return {
    label: 'moveWall',
    run: (ctx) => {
      const w = ctx.floor.walls[wallId];
      if (!w) throw notFound('Wall', wallId);
      const a = ctx.floor.nodes[w.a];
      const b = ctx.floor.nodes[w.b];
      if (!a || !b) throw notFound('Node', !a ? w.a : w.b);
      const n = leftNormal(sub(b, a));
      const d = scale(n, dot(delta, n));
      return applyMoves(
        ctx,
        new Map([
          [w.a, add(a, d)],
          [w.b, add(b, d)],
        ]),
      );
    },
  };
}

/**
 * Resizes a wall along its own direction. `anchor: 'a'` (default) keeps node a fixed and moves
 * node b; `'b'` keeps node b fixed and moves node a.
 */
export function setWallLength(wallId: Id, length: number, opts?: { anchor?: 'a' | 'b' }): Command {
  return {
    label: 'setWallLength',
    run: (ctx) => {
      if (!(length >= MIN_WALL_LENGTH)) {
        throw new H3xValidationError([
          {
            code: 'wall-too-short',
            ids: [wallId],
            message: `Wall length ${length} is below the minimum ${MIN_WALL_LENGTH} m`,
          },
        ]);
      }
      const w = ctx.floor.walls[wallId];
      if (!w) throw notFound('Wall', wallId);
      const a = ctx.floor.nodes[w.a];
      const b = ctx.floor.nodes[w.b];
      if (!a || !b) throw notFound('Node', !a ? w.a : w.b);
      const cur = distance(a, b);
      if (cur < EPS) throw notFound('Direction of wall', wallId);
      const anchorB = opts?.anchor === 'b';
      const [fixed, moving, movingId] = anchorB ? [b, a, w.a] : [a, b, w.b];
      const dir = scale(sub(moving, fixed), 1 / cur);
      const moves = new Map([[movingId, add(fixed, scale(dir, length))]]);
      // Offsets are measured from node a; with b fixed, shift them so contents stay put.
      return applyMoves(ctx, moves, anchorB ? { wall: wallId, by: length - cur } : undefined);
    },
  };
}
