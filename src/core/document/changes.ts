import type { EntityKind, Floor, Id, PresetResolver } from '../types';

/** null = absent. Snapshots are plain data. */
export interface EntityChange {
  kind: EntityKind;
  id: Id;
  before: unknown | null;
  after: unknown | null;
}

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

function put(floor: Floor, c: EntityChange, snap: unknown | null): void {
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

/** Per (kind,id): earliest before, latest after. */
export function mergeChanges(older: EntityChange[], newer: EntityChange[]): EntityChange[] {
  const out = new Map<string, EntityChange>();
  for (const c of [...older, ...newer]) {
    const key = `${c.kind}:${c.id}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, after: c.after } : { ...c });
  }
  return [...out.values()];
}
