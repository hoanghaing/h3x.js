import type { Command, CommandContext, EntityChange } from '../document/changes';
import { MIN_WALL_LENGTH } from '../constants';
import { H3xValidationError } from '../errors';
import { add, distance, dot, leftNormal, scale, sub } from '../geometry/vec';
import { openingRange } from '../validate/layout';
import type { Id, Vec2, WallItem } from '../types';

const EPS = 1e-9;
const tidy = (n: number): number => Math.round(n * 1e9) / 1e9;

function notFound(what: string, id: Id): H3xValidationError {
  return new H3xValidationError([
    { code: 'not-found', ids: [id], message: `${what} ${id} does not exist` },
  ]);
}

/** Node moves plus re-fit of openings / wall items on walls whose length changed. */
function applyMoves(ctx: CommandContext, moves: Map<Id, Vec2>): EntityChange[] {
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
    for (const o of Object.values(floor.openings)) {
      if (o.wall !== w.id) continue;
      const { lo, hi } = openingRange(len, o.width);
      if (hi < lo - EPS) continue;
      if (o.offset >= lo - EPS && o.offset <= hi + EPS) continue;
      const offset = tidy(Math.min(Math.max(o.offset, lo), hi));
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
      const half = (ctx.presets?.(it.preset)?.footprint.w ?? 0) / 2;
      if (len - half < half) continue;
      const offset = tidy(Math.min(Math.max(it.offset, half), len - half));
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

/** Node a stays fixed; node b moves along a to b. */
export function setWallLength(wallId: Id, length: number): Command {
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
      const dir = scale(sub(b, a), 1 / cur);
      return applyMoves(ctx, new Map([[w.b, add(a, scale(dir, length))]]));
    },
  };
}
