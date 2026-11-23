import type { Command, EntityChange } from '../document/changes';
import type { H3xDocument, Validator } from '../document/H3xDocument';
import { deepEqual } from '../document/history';
import type { Floor, Id, Issue } from '../types';
import type { ObjectSet } from './transform';

/** The kinds that can be locked, and the ObjectSet key naming them. */
const LOCKABLE = {
  wall: 'walls',
  opening: 'openings',
  item: 'items',
  column: 'columns',
  stair: 'stairs',
  roof: 'roofs',
} as const;
type LockableKind = keyof typeof LOCKABLE;

const unlocked = <T extends { locked?: boolean }>(e: T): Omit<T, 'locked'> => {
  const rest = { ...e };
  delete rest.locked;
  return rest;
};

/**
 * Locks (`locked: true`) or unlocks walls, openings, items, columns, stairs and roofs of the set
 * (a room id stands for its walls). A locked object rejects every other edit, and so do the
 * nodes of a locked wall, until it is unlocked. Saved in XML as `locked="true"`.
 */
export function setLocked(set: Readonly<ObjectSet>, locked: boolean): Command {
  return {
    label: 'setLocked',
    run: (ctx) => {
      const f = ctx.floor as Floor;
      const walls = new Set(set.walls ?? []);
      for (const id of set.rooms ?? []) {
        const r = f.rooms[id];
        if (r) for (const w of [r.walls, ...(r.holes ?? [])].flat()) walls.add(w);
      }
      const ids: Record<LockableKind, Iterable<Id>> = {
        wall: walls,
        opening: set.openings ?? [],
        item: set.items ?? [],
        column: set.columns ?? [],
        stair: set.stairs ?? [],
        roof: set.roofs ?? [],
      };
      const changes: EntityChange[] = [];
      for (const kind of Object.keys(LOCKABLE) as LockableKind[]) {
        const coll = f[LOCKABLE[kind]] as Record<Id, { id: Id; locked?: boolean }>;
        for (const id of ids[kind]) {
          const e = coll[id];
          if (!e || !!e.locked === locked) continue;
          const after = locked
            ? { ...structuredClone(e), locked: true }
            : unlocked(structuredClone(e));
          changes.push({ kind, id, before: structuredClone(e), after } as EntityChange);
        }
      }
      return changes;
    },
  };
}

/**
 * Rejects (`object-locked`) any change to a locked object other than unlocking it, and any move
 * or removal of a node of a locked wall.
 */
export const lockValidator: Validator = (doc: H3xDocument, changes: EntityChange[]): Issue[] => {
  const floor = doc.floor as Floor;
  const issues: Issue[] = [];
  const say = (id: Id, what: string): void => {
    issues.push({ code: 'object-locked', ids: [id], message: `${what} ${id} is locked` });
  };
  let lockedNodes: Set<Id> | undefined;
  for (const c of changes) {
    if (c.kind === 'node') {
      if (deepEqual(c.before, c.after)) continue;
      lockedNodes ??= new Set(
        Object.values(floor.walls)
          .filter((w) => w.locked)
          .flatMap((w) => [w.a, w.b]),
      );
      // A removed node: its walls are gone from the floor now; look at the walls removed with it.
      const removedLocked = changes.some(
        (x) =>
          x.kind === 'wall' &&
          x.after === null &&
          x.before?.locked &&
          (x.before.a === c.id || x.before.b === c.id),
      );
      if (lockedNodes.has(c.id) || removedLocked) say(c.id, 'A node of a locked wall,');
      continue;
    }
    if (!(c.kind in LOCKABLE)) continue;
    const before = c.before as { locked?: boolean } | null;
    if (!before?.locked) continue;
    const after = c.after as { locked?: boolean } | null;
    // Locking state changes are allowed; nothing else may change.
    if (after && deepEqual(unlocked(before), unlocked(after))) continue;
    say(c.id, c.kind[0]!.toUpperCase() + c.kind.slice(1));
  }
  return issues;
};
