import type { Command, CommandContext, EntityChange } from '../document/changes';
import { applyChanges, mergeChanges } from '../document/changes';
import { deepEqual } from '../document/history';
import { signedArea } from '../geometry/polygon';
import { EPS, add, dot, scale, sub, tidy } from '../geometry/vec';
import { roomNodeLoop } from '../rooms/detect';
import type { Floor, Id, Project, Roof, RoofEdge, Vec2 } from '../types';
import { removeColumn } from './columns';
import { applyMoves } from './layout';
import { removeItem } from './objects';
import { removeOpening } from './openings';
import { removeRoof } from './roofs';
import { removeStair } from './stairs';
import { removeNode, removeWall } from './structure';

/** Ids of the objects of one floor that an edit acts on. */
export interface ObjectSet {
  walls?: readonly Id[];
  nodes?: readonly Id[];
  /** A room stands for its walls (outer loop and holes). */
  rooms?: readonly Id[];
  openings?: readonly Id[];
  items?: readonly Id[];
  columns?: readonly Id[];
  stairs?: readonly Id[];
  roofs?: readonly Id[];
}

/** A rigid plan transform: a move, a turn about `center` (radians CCW), or a mirror across the line a–b. */
export type Transform =
  | { kind: 'translate'; delta: Vec2 }
  | { kind: 'rotate'; center: Vec2; angle: number }
  | { kind: 'mirror'; a: Vec2; b: Vec2 };

const wrap = (r: number): number => tidy(Math.atan2(Math.sin(r), Math.cos(r)));

/** The point map of `t`, and the map of a direction angle (radians). */
function mapsOf(t: Transform): { point: (p: Vec2) => Vec2; angle: (r: number) => number } {
  const tidyPt = (p: Vec2): Vec2 => ({ x: tidy(p.x), y: tidy(p.y) });
  if (t.kind === 'translate') {
    return { point: (p) => tidyPt(add(p, t.delta)), angle: (r) => r };
  }
  if (t.kind === 'rotate') {
    const c = Math.cos(t.angle);
    const s = Math.sin(t.angle);
    return {
      point: (p) => {
        const v = sub(p, t.center);
        return tidyPt({ x: t.center.x + v.x * c - v.y * s, y: t.center.y + v.x * s + v.y * c });
      },
      angle: (r) => wrap(r + t.angle),
    };
  }
  const d = sub(t.b, t.a);
  const len = Math.hypot(d.x, d.y);
  const u = len > 0 ? scale(d, 1 / len) : { x: 1, y: 0 };
  const theta = Math.atan2(u.y, u.x);
  return {
    point: (p) => {
      const v = sub(p, t.a);
      return tidyPt(sub(add(t.a, scale(u, 2 * dot(v, u))), v));
    },
    angle: (r) => wrap(2 * theta - r),
  };
}

const change = <K extends EntityChange['kind']>(
  kind: K,
  id: Id,
  before: unknown,
  after: unknown,
): EntityChange => ({ kind, id, before: structuredClone(before), after }) as EntityChange;

/** Mirrored rings are clockwise: reverse them, and move each edge spec to the reversed edge. */
function reverseRing<E>(points: Vec2[], edges: E[] | undefined): { points: Vec2[]; edges?: E[] } {
  const n = points.length;
  const out = [...points].reverse();
  if (!edges) return { points: out };
  // New edge j runs p[n-1-j] -> p[n-2-j]: the old edge n-2-j, reversed.
  return { points: out, edges: out.map((_, j) => edges[(((n - 2 - j) % n) + n) % n]!) };
}

function mappedRoof(r: Roof, point: (p: Vec2) => Vec2, mirror: boolean): Roof {
  if (r.follow || !r.points) return r;
  const out: Roof = structuredClone(r);
  const pts = r.points.map(point);
  const holes = (r.holes ?? []).map((h) => h.map(point));
  if (!mirror) {
    out.points = pts;
    if (r.holes) out.holes = holes;
    return out;
  }
  const outer = reverseRing<RoofEdge>(pts, r.edges);
  out.points = outer.points;
  if (outer.edges) out.edges = outer.edges;
  if (r.holes) {
    const rings = holes.map((h, i) => reverseRing<RoofEdge>(h, r.holeEdges?.[i]));
    out.holes = rings.map((x) => x.points);
    if (r.holeEdges) out.holeEdges = rings.map((x, i) => x.edges ?? r.holeEdges![i]!);
  }
  return out;
}

/**
 * Moves, turns or mirrors a set of objects of the active floor as one change list. The nodes of
 * the set's walls (and rooms, and nodes) move; walls attached to them stretch and their openings
 * re-fit, as for `moveNode`. Openings and wall items ride their walls (ids of them in the set are
 * ignored); a mirror flips door swings, wall item sides and stair hands, and keeps rooms and roofs
 * counter-clockwise. Columns, floor / ceiling items, stairs and independent roofs in the set move
 * with it; follow roofs follow their rooms. Rejected as a whole when the result is invalid.
 */
export function transformObjects(set: Readonly<ObjectSet>, t: Transform): Command {
  return {
    label: 'transformObjects',
    run: (ctx) => {
      const floor = ctx.floor as Floor;
      const { point, angle } = mapsOf(t);
      const mirror = t.kind === 'mirror';

      const nodeIds = new Set<Id>(set.nodes?.filter((id) => floor.nodes[id]) ?? []);
      const wallIds = new Set<Id>(set.walls ?? []);
      for (const id of set.rooms ?? []) {
        const room = floor.rooms[id];
        if (room) for (const w of [room.walls, ...(room.holes ?? [])].flat()) wallIds.add(w);
      }
      for (const id of wallIds) {
        const w = floor.walls[id];
        if (w) nodeIds.add(w.a).add(w.b);
      }
      const moves = new Map<Id, Vec2>();
      for (const id of nodeIds) moves.set(id, point(floor.nodes[id]!));

      const changes = moves.size > 0 ? applyMoves(ctx, moves) : [];
      if (!changes.some((c) => c.kind === 'node')) {
        // Nothing moved (an empty set of nodes or a zero move): keep only the other objects.
        changes.length = 0;
      }
      const at = (kind: EntityChange['kind'], id: Id): EntityChange | undefined =>
        changes.find((c) => c.kind === kind && c.id === id);
      /** Replace `id`'s after with `edit(current after)`, adding a change when there is none. */
      const edit = <T>(kind: EntityChange['kind'], id: Id, before: T, fn: (cur: T) => T): void => {
        const prev = at(kind, id);
        const cur = structuredClone((prev ? prev.after : before) as T);
        const next = fn(cur);
        if (prev) (prev as { after: unknown }).after = next;
        else if (!deepEqual(before, next)) changes.push(change(kind, id, before, next));
      };

      if (mirror && moves.size > 0) {
        const rigid = (wallId: Id): boolean => {
          const w = floor.walls[wallId];
          return !!w && moves.has(w.a) && moves.has(w.b);
        };
        for (const o of Object.values(floor.openings)) {
          if (!rigid(o.wall)) continue;
          edit('opening', o.id, o, (cur) => ({
            ...cur,
            swing: cur.swing === 'left' ? ('right' as const) : ('left' as const),
          }));
        }
        for (const it of Object.values(floor.items)) {
          if (it.mount !== 'wall' || !rigid(it.wall)) continue;
          edit('item', it.id, it, (cur) =>
            cur.mount === 'wall'
              ? { ...cur, side: cur.side === 'left' ? ('right' as const) : ('left' as const) }
              : cur,
          );
        }
      }
      if (moves.size > 0 && changes.length > 0) {
        // A loop whose winding flipped (a mirror) is reversed so rooms stay CCW, holes CW.
        const moved: Floor = { ...floor, nodes: { ...floor.nodes } };
        for (const [id, p] of moves) moved.nodes[id] = { id, x: p.x, y: p.y };
        const winding = (f: Floor, walls: Id[]): number => {
          try {
            const loop = roomNodeLoop(f, { id: '', name: '', walls });
            return Math.sign(signedArea(loop.map((n) => f.nodes[n]!)));
          } catch {
            return 0;
          }
        };
        for (const room of Object.values(floor.rooms)) {
          const loops = [room.walls, ...(room.holes ?? [])];
          const flipped = loops.map((ws) => {
            const s0 = winding(floor, ws);
            return s0 !== 0 && winding(moved, ws) === -s0;
          });
          if (!flipped.some(Boolean)) continue;
          edit('room', room.id, room, (cur) => {
            const out = { ...cur, walls: flipped[0] ? [...cur.walls].reverse() : cur.walls };
            if (cur.holes) {
              out.holes = cur.holes.map((h, i) => (flipped[i + 1] ? [...h].reverse() : h));
            }
            return out;
          });
        }
      }

      const identity =
        t.kind === 'translate' && Math.abs(t.delta.x) < EPS && Math.abs(t.delta.y) < EPS;
      if (identity) return [];
      for (const id of set.columns ?? []) {
        const c = floor.columns[id];
        if (!c) continue;
        const p = point(c);
        changes.push(
          change('column', id, c, {
            ...structuredClone(c),
            x: p.x,
            y: p.y,
            rotation: angle(c.rotation),
          }),
        );
      }
      for (const id of set.items ?? []) {
        const it = floor.items[id];
        if (!it || it.mount === 'wall') continue;
        const p = point(it);
        changes.push(
          change('item', id, it, {
            ...structuredClone(it),
            x: p.x,
            y: p.y,
            rotation: angle(it.rotation),
          }),
        );
      }
      for (const id of set.stairs ?? []) {
        const s = floor.stairs[id];
        if (!s) continue;
        const p = point(s);
        const after = { ...structuredClone(s), x: p.x, y: p.y };
        if (mirror) {
          // The reflected frame is left-handed: flip local x back (turn by π) and swap the hand.
          after.rotation = wrap(angle(s.rotation) + Math.PI);
          after.hand = s.hand === 'left' ? 'right' : 'left';
        } else after.rotation = angle(s.rotation);
        changes.push(change('stair', id, s, after));
      }
      for (const id of set.roofs ?? []) {
        const r = floor.roofs[id];
        if (!r || r.follow) continue;
        changes.push(change('roof', id, r, mappedRoof(r, point, mirror)));
      }
      return changes;
    },
  };
}

/**
 * Runs commands one after another, each against the floor the earlier ones left, as one change
 * list. A step returns null to skip (e.g. its object is already gone).
 */
export function sequence(
  label: string,
  steps: Array<(floor: Readonly<Floor>) => Command | null>,
): Command {
  return {
    label,
    run: (ctx) => {
      const project = structuredClone(ctx.project) as Project;
      let all: EntityChange[] = [];
      for (const step of steps) {
        const floor = project.floors.find((f) => f.id === ctx.floorId)!;
        const cmd = step(floor);
        if (!cmd) continue;
        const sub: CommandContext = { ...ctx, floor, project };
        const changes = cmd
          .run(sub)
          .map((c) =>
            c.kind === 'site' || c.floorId ? c : ({ ...c, floorId: ctx.floorId } as EntityChange),
          );
        applyChanges(project, changes, 'forward');
        all = mergeChanges(all, changes);
      }
      return all.filter((c) => !deepEqual(c.before, c.after));
    },
  };
}

/**
 * Deletes every object of the set in one change list: openings, items, columns, stairs and roofs,
 * then walls (with their openings, wall items and orphaned nodes), then nodes. Ids already gone
 * are skipped. Rooms re-sync; a room id in the set is ignored.
 */
export function removeObjects(set: Readonly<ObjectSet>): Command {
  const steps: Array<(f: Readonly<Floor>) => Command | null> = [
    ...(set.openings ?? []).map(
      (id) => (f: Readonly<Floor>) => (f.openings[id] ? removeOpening(id) : null),
    ),
    ...(set.items ?? []).map((id) => (f: Readonly<Floor>) => (f.items[id] ? removeItem(id) : null)),
    ...(set.columns ?? []).map(
      (id) => (f: Readonly<Floor>) => (f.columns[id] ? removeColumn(id) : null),
    ),
    ...(set.stairs ?? []).map(
      (id) => (f: Readonly<Floor>) => (f.stairs[id] ? removeStair(id) : null),
    ),
    ...(set.roofs ?? []).map((id) => (f: Readonly<Floor>) => (f.roofs[id] ? removeRoof(id) : null)),
    ...(set.walls ?? []).map((id) => (f: Readonly<Floor>) => (f.walls[id] ? removeWall(id) : null)),
    ...(set.nodes ?? []).map((id) => (f: Readonly<Floor>) => (f.nodes[id] ? removeNode(id) : null)),
  ];
  return sequence('removeObjects', steps);
}
