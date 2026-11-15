import type {
  EntityKind,
  Floor,
  Id,
  Item,
  Opening,
  PlanNode,
  PresetResolver,
  Room,
  Wall,
} from '../types';

interface EntityByKind {
  node: PlanNode;
  wall: Wall;
  opening: Opening;
  room: Room;
  item: Item;
}

/**
 * One entity's state change, discriminated by `kind` so `before` / `after`
 * narrow to the entity type. null = absent. Snapshots are plain data.
 */
export type EntityChange = {
  [K in EntityKind]: {
    kind: K;
    id: Id;
    before: EntityByKind[K] | null;
    after: EntityByKind[K] | null;
  };
}[EntityKind];

export interface CommandContext {
  floor: Readonly<Floor>;
  presets?: PresetResolver;
}

/** `run` must not mutate ctx.floor; it may throw H3xValidationError for bad input. */
export interface Command {
  label: string;
  run(ctx: CommandContext): EntityChange[];
}

const COLLECTION = {
  node: 'nodes',
  wall: 'walls',
  opening: 'openings',
  room: 'rooms',
  item: 'items',
} as const;

function put(floor: Floor, c: EntityChange, snap: EntityChange['after']): void {
  const rec = floor[COLLECTION[c.kind]] as Record<Id, unknown>;
  if (snap === null) delete rec[c.id];
  else rec[c.id] = structuredClone(snap);
}

/** Mutates floor. Snapshots are deep-cloned in; backward applies in reverse order. */
export function applyChanges(
  floor: Floor,
  changes: EntityChange[],
  dir: 'forward' | 'backward',
): void {
  if (dir === 'forward') {
    for (const c of changes) put(floor, c, c.after);
  } else {
    for (let i = changes.length - 1; i >= 0; i--) put(floor, changes[i]!, changes[i]!.before);
  }
}

/** Swaps before / after (same kind, so the union member is preserved). */
export function swapChange(c: EntityChange): EntityChange {
  return { ...c, before: c.after, after: c.before } as EntityChange;
}

/** Per (kind,id): earliest before, latest after. */
export function mergeChanges(older: EntityChange[], newer: EntityChange[]): EntityChange[] {
  const out = new Map<string, EntityChange>();
  for (const c of [...older, ...newer]) {
    const key = `${c.kind}:${c.id}`;
    const prev = out.get(key);
    // Same (kind, id), so prev and c are the same union member.
    out.set(key, prev ? ({ ...prev, after: c.after } as EntityChange) : { ...c });
  }
  return [...out.values()];
}
