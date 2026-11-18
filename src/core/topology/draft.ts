import type { Command, CommandContext, EntityChange } from '../document/changes';
import { deepEqual } from '../document/history';
import { syncRooms } from '../rooms/sync';
import type { Floor, Id, Wall } from '../types';

type FloorKind = 'node' | 'wall' | 'opening' | 'item' | 'column' | 'room' | 'roof';

const COLLECTIONS: [
  FloorKind,
  'nodes' | 'walls' | 'openings' | 'items' | 'columns' | 'rooms' | 'roofs',
][] = [
  ['node', 'nodes'],
  ['wall', 'walls'],
  ['opening', 'openings'],
  ['item', 'items'],
  ['column', 'columns'],
  ['room', 'rooms'],
  ['roof', 'roofs'],
];

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function diffKinds(
  before: Readonly<Floor>,
  after: Readonly<Floor>,
  kinds: ReadonlySet<FloorKind>,
): EntityChange[] {
  const out: EntityChange[] = [];
  for (const [kind, key] of COLLECTIONS) {
    if (!kinds.has(kind)) continue;
    const b = before[key] as Record<Id, unknown>;
    const a = after[key] as Record<Id, unknown>;
    const ids = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort(byId);
    for (const id of ids) {
      const prev = b[id] ?? null;
      const next = a[id] ?? null;
      if (deepEqual(prev, next)) continue;
      out.push({
        kind,
        id,
        before: structuredClone(prev),
        after: structuredClone(next),
      } as EntityChange);
    }
  }
  return out;
}

/**
 * Entity changes turning `before` into `after`, for every floor kind, in the order
 * node, wall, opening, item, column, room (ids sorted within a kind).
 */
export function diffFloors(before: Readonly<Floor>, after: Readonly<Floor>): EntityChange[] {
  return diffKinds(before, after, new Set(COLLECTIONS.map(([k]) => k)));
}

const NON_ROOM = new Set<FloorKind>(['node', 'wall', 'opening', 'item', 'column', 'roof']);

/**
 * A command that mutates a clone of the floor. Rooms in the draft are ignored:
 * room changes come from `syncRooms(ctx.floor, draft)` so the whole edit is one
 * change list (one undo step).
 */
export function structural(
  label: string,
  mutate: (draft: Floor, ctx: CommandContext) => void,
): Command {
  return {
    label,
    run: (ctx) => {
      const draft = structuredClone(ctx.floor) as Floor;
      mutate(draft, ctx);
      return [...diffKinds(ctx.floor, draft, NON_ROOM), ...syncRooms(ctx.floor, draft)];
    },
  };
}

/** Walls with `node` as an end, in id order. */
export function wallsAt(floor: Readonly<Floor>, node: Id): Wall[] {
  return Object.values(floor.walls)
    .filter((w) => w.a === node || w.b === node)
    .sort((p, q) => byId(p.id, q.id));
}
