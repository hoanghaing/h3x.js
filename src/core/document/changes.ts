import type {
  Column,
  EntityKind,
  Floor,
  FloorProps,
  Id,
  Item,
  Opening,
  PlanNode,
  PresetResolver,
  Project,
  Room,
  Site,
  Wall,
} from '../types';

interface EntityByKind {
  node: PlanNode;
  wall: Wall;
  opening: Opening;
  room: Room;
  item: Item;
  column: Column;
  site: Site;
  floor: FloorProps;
}

/**
 * One entity's state change, discriminated by `kind` so `before` / `after`
 * narrow to the entity type. null = absent. Snapshots are plain data.
 * `floorId` names the floor the entity lives on. Commands may leave it out
 * for the active floor (`H3xDocument` stamps it); after `execute` it is set on
 * every change except `kind: 'site'`, and for `kind: 'floor'` it equals `id`.
 */
export type EntityChange = {
  [K in EntityKind]: {
    kind: K;
    id: Id;
    floorId?: Id;
    before: EntityByKind[K] | null;
    after: EntityByKind[K] | null;
  };
}[EntityKind];

export interface CommandContext {
  /** The active floor. */
  floor: Readonly<Floor>;
  /** Id of the active floor. */
  floorId: Id;
  project: Readonly<Project>;
  site?: Readonly<Site>;
  presets?: PresetResolver;
}

/** `run` must not mutate ctx.floor or ctx.project; it may throw H3xValidationError for bad input. */
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
  column: 'columns',
} as const;

const byLevel = (a: Floor, b: Floor): number => a.level - b.level;

function putFloor(project: Project, id: Id, snap: FloorProps | null): void {
  const i = project.floors.findIndex((f) => f.id === id);
  if (snap === null) {
    if (i >= 0) project.floors.splice(i, 1);
    return;
  }
  const props = structuredClone(snap);
  if (i >= 0) {
    Object.assign(project.floors[i]!, props);
  } else {
    project.floors.push({
      ...props,
      nodes: {},
      walls: {},
      openings: {},
      rooms: {},
      items: {},
      columns: {},
    });
  }
  project.floors.sort(byLevel); // stable: equal levels keep their order
}

function put(project: Project, c: EntityChange, snap: EntityChange['after']): void {
  if (c.kind === 'site') {
    if (snap === null) delete project.site;
    else project.site = structuredClone(snap) as Site;
    return;
  }
  if (c.kind === 'floor') {
    putFloor(project, c.id, snap as FloorProps | null);
    return;
  }
  const floor = project.floors.find((f) => f.id === c.floorId);
  if (!floor) throw new Error(`${c.kind} ${c.id}: no floor with id ${String(c.floorId)}`);
  const rec = floor[COLLECTION[c.kind]] as Record<Id, unknown>;
  if (snap === null) delete rec[c.id];
  else rec[c.id] = structuredClone(snap);
}

/**
 * Mutates the project: floor-scoped kinds go to the floor named by `floorId`
 * (throws if it does not exist), `site` to project.site, and `floor` changes
 * insert (with empty collections), update or delete a floor, keeping
 * `project.floors` sorted by level. Snapshots are deep-cloned in; backward
 * applies in reverse order.
 */
export function applyChanges(
  project: Project,
  changes: EntityChange[],
  dir: 'forward' | 'backward',
): void {
  if (dir === 'forward') {
    for (const c of changes) put(project, c, c.after);
  } else {
    for (let i = changes.length - 1; i >= 0; i--) put(project, changes[i]!, changes[i]!.before);
  }
}

/** Swaps before / after (same kind, so the union member is preserved). */
export function swapChange(c: EntityChange): EntityChange {
  return { ...c, before: c.after, after: c.before } as EntityChange;
}

/** Per (floorId, kind, id): earliest before, latest after. */
export function mergeChanges(older: EntityChange[], newer: EntityChange[]): EntityChange[] {
  const out = new Map<string, EntityChange>();
  for (const c of [...older, ...newer]) {
    const key = `${c.floorId ?? ''}:${c.kind}:${c.id}`;
    const prev = out.get(key);
    // Same (floorId, kind, id), so prev and c are the same union member.
    out.set(key, prev ? ({ ...prev, after: c.after } as EntityChange) : { ...c });
  }
  return [...out.values()];
}
