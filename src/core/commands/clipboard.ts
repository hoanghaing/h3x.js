import type { Command, EntityChange } from '../document/changes';
import { createId } from '../ids';
import { enclosedRooms } from '../rooms/sync';
import type {
  Column,
  Floor,
  Id,
  Item,
  Opening,
  PlanNode,
  Roof,
  Room,
  Stair,
  Vec2,
  Wall,
} from '../types';
import { sequence, transformObjects, type ObjectSet, type Transform } from './transform';

/**
 * Copied objects of one floor as plain data (JSON-safe), ready to paste on any floor. Walls bring
 * their nodes, openings and wall items; rooms whose walls were all copied bring their name and
 * finish.
 */
export interface Clipboard {
  version: 1;
  nodes: PlanNode[];
  walls: Wall[];
  openings: Opening[];
  items: Item[];
  columns: Column[];
  stairs: Stair[];
  /** Independent roofs only: a roof that follows rooms is not copied. */
  roofs: Roof[];
  rooms: Array<Pick<Room, 'name' | 'walls' | 'holes' | 'floorFinish'>>;
}

/** Copies `set` from `floor` (see `Clipboard`). Node ids alone, without a wall, copy nothing. */
export function copyObjects(floor: Readonly<Floor>, set: Readonly<ObjectSet>): Clipboard {
  const f = floor as Floor;
  const wallIds = new Set<Id>((set.walls ?? []).filter((id) => f.walls[id]));
  for (const id of set.rooms ?? []) {
    const r = f.rooms[id];
    if (r) for (const w of [r.walls, ...(r.holes ?? [])].flat()) if (f.walls[w]) wallIds.add(w);
  }
  const walls = [...wallIds].map((id) => f.walls[id]!).filter((w) => f.nodes[w.a] && f.nodes[w.b]);
  const nodeIds = new Set(walls.flatMap((w) => [w.a, w.b]));
  const kept = new Set(walls.map((w) => w.id));
  const pick = <T>(ids: readonly Id[] | undefined, from: Record<Id, T>): T[] =>
    (ids ?? []).map((id) => from[id]).filter((x): x is T => x !== undefined);
  const items = [
    ...Object.values(f.items).filter((it) => it.mount === 'wall' && kept.has(it.wall)),
    ...pick(set.items, f.items).filter((it) => it.mount !== 'wall'),
  ];
  const rooms = Object.values(f.rooms)
    .filter((r) => [r.walls, ...(r.holes ?? [])].flat().every((w) => kept.has(w)))
    .map((r) => {
      const out: Clipboard['rooms'][number] = { name: r.name, walls: [...r.walls] };
      if (r.holes) out.holes = r.holes.map((h) => [...h]);
      if (r.floorFinish !== undefined) out.floorFinish = r.floorFinish;
      return out;
    });
  const clip = structuredClone({
    version: 1 as const,
    nodes: [...nodeIds].map((id) => f.nodes[id]!),
    walls,
    openings: Object.values(f.openings).filter((o) => kept.has(o.wall)),
    items,
    columns: pick(set.columns, f.columns),
    stairs: pick(set.stairs, f.stairs),
    roofs: pick(set.roofs, f.roofs).filter((r) => !r.follow),
    rooms,
  });
  // A copy is a new object: it does not inherit the lock.
  for (const e of [
    ...clip.walls,
    ...clip.openings,
    ...clip.items,
    ...clip.columns,
    ...clip.stairs,
    ...clip.roofs,
  ]) {
    delete (e as { locked?: boolean }).locked;
  }
  return clip;
}

/** Whether the clipboard holds anything to paste. */
export function clipboardIsEmpty(clip: Readonly<Clipboard>): boolean {
  return (
    clip.walls.length +
      clip.items.length +
      clip.columns.length +
      clip.stairs.length +
      clip.roofs.length ===
    0
  );
}

/** Centre of the clipboard's bounding box (null when it is empty). */
export function clipboardCenter(clip: Readonly<Clipboard>): Vec2 | null {
  const pts: Vec2[] = [
    ...clip.nodes,
    ...clip.columns,
    ...clip.stairs,
    ...clip.items.filter((it) => it.mount !== 'wall').map((it) => it as { x: number; y: number }),
    ...clip.roofs.flatMap((r) => r.points ?? []),
  ];
  if (pts.length === 0) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

/** The clipboard's objects with fresh ids, as `before: null` changes (rooms come in `pasteRooms`). */
function pasteInPlace(clip: Readonly<Clipboard>, ids: Map<Id, Id>): Command {
  const id = (old: Id): Id => ids.get(old)!;
  return {
    label: 'paste',
    run: () => {
      const add = <T extends { id: Id }>(kind: EntityChange['kind'], after: T): EntityChange =>
        ({ kind, id: after.id, before: null, after }) as unknown as EntityChange;
      const changes: EntityChange[] = [
        ...clip.nodes.map((n) => add('node', { ...n, id: id(n.id) })),
        ...clip.walls.map((w) => add('wall', { ...w, id: id(w.id), a: id(w.a), b: id(w.b) })),
        ...clip.openings.map((o) => add('opening', { ...o, id: id(o.id), wall: id(o.wall) })),
        ...clip.items.map((it) =>
          add(
            'item',
            it.mount === 'wall'
              ? { ...it, id: id(it.id), wall: id(it.wall) }
              : { ...it, id: id(it.id) },
          ),
        ),
        ...clip.columns.map((c) => add('column', { ...c, id: id(c.id) })),
        ...clip.stairs.map((s) => add('stair', { ...s, id: id(s.id) })),
        ...clip.roofs.map((r) => add('roof', { ...structuredClone(r), id: id(r.id) })),
      ];
      return changes;
    },
  };
}

/**
 * The rooms the pasted walls enclose, once they stand where they go (a paste in place on top of
 * the original would overlap and enclose nothing); a copied room passes on its name and finish,
 * also to a room an earlier step already found for the same walls.
 */
function pasteRooms(clip: Readonly<Clipboard>, ids: Map<Id, Id>): Command {
  return {
    label: 'pasteRooms',
    run: (ctx) => {
      const floor = ctx.floor as Floor;
      const fresh = new Set(clip.walls.map((w) => ids.get(w.id)!));
      const without: Floor = {
        ...floor,
        walls: Object.fromEntries(Object.entries(floor.walls).filter(([id]) => !fresh.has(id))),
        rooms: Object.fromEntries(
          Object.entries(floor.rooms).filter(([, r]) => !r.walls.some((w) => fresh.has(w))),
        ),
      };
      const key = (walls: readonly Id[]): string => [...walls].sort().join(',');
      const named = new Map(clip.rooms.map((r) => [key(r.walls.map((w) => ids.get(w)!)), r]));
      const stored = new Set(Object.values(floor.rooms).map((r) => key(r.walls)));
      const changes: EntityChange[] = enclosedRooms(without, floor).filter(
        (c) => !stored.has(key((c.after as Room).walls)),
      );
      for (const r of Object.values(floor.rooms)) {
        if (named.has(key(r.walls)))
          changes.push({
            kind: 'room',
            id: r.id,
            before: structuredClone(r),
            after: structuredClone(r),
          });
      }
      for (const c of changes) {
        const room = c.after as Room;
        const src = named.get(key(room.walls));
        if (!src) continue;
        room.name = src.name;
        if (src.floorFinish !== undefined) room.floorFinish = src.floorFinish;
      }
      return changes;
    },
  };
}

/**
 * Pastes the clipboard on the active floor with fresh ids, then moves, turns or mirrors it by `t`
 * (default: where it was copied), as one change list. `created` names the new objects (for
 * selecting them). Pasted walls do not join walls already there; an overlap is rejected as for
 * any edit.
 */
export function pasteObjects(
  clip: Readonly<Clipboard>,
  t?: Transform,
): Command & { created: ObjectSet } {
  const ids = new Map<Id, Id>();
  for (const e of [
    ...clip.nodes,
    ...clip.walls,
    ...clip.openings,
    ...clip.items,
    ...clip.columns,
    ...clip.stairs,
    ...clip.roofs,
  ]) {
    ids.set(e.id, createId());
  }
  const created: ObjectSet = {
    walls: clip.walls.map((w) => ids.get(w.id)!),
    openings: clip.openings.map((o) => ids.get(o.id)!),
    items: clip.items.map((it) => ids.get(it.id)!),
    columns: clip.columns.map((c) => ids.get(c.id)!),
    stairs: clip.stairs.map((s) => ids.get(s.id)!),
    roofs: clip.roofs.map((r) => ids.get(r.id)!),
  };
  const steps = [
    () => pasteInPlace(clip, ids),
    ...(t ? [() => transformObjects(created, t)] : []),
    () => pasteRooms(clip, ids),
  ];
  return { ...sequence('pasteObjects', steps), created };
}

/**
 * `count` copies of `set`, the k-th moved by k × `delta` (k = 1..count), as one change list; the
 * originals stay.
 */
export function arrayObjects(set: Readonly<ObjectSet>, count: number, delta: Vec2): Command {
  return {
    label: 'arrayObjects',
    run: (ctx) => {
      const clip = copyObjects(ctx.floor, set);
      const n = Math.max(0, Math.floor(count));
      const steps = Array.from(
        { length: n },
        (_, i) => () =>
          pasteObjects(clip, {
            kind: 'translate',
            delta: { x: delta.x * (i + 1), y: delta.y * (i + 1) },
          }),
      );
      return sequence('arrayObjects', steps).run(ctx);
    },
  };
}
