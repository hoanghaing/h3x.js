import type { Command, CommandContext } from '../document/changes';
import { H3xValidationError } from '../errors';
import type { Id, PresetInfo } from '../types';

/** A command that creates the entity `createdId`. */
export type Created = Command & { createdId: Id };

/** A one-issue validation error. */
export const fail = (code: string, ids: Id[], message: string): H3xValidationError =>
  new H3xValidationError([{ code, ids, message }]);

export const notFound = (what: string, id: Id): H3xValidationError =>
  fail('not-found', [id], `${what} ${id} does not exist`);

export function presetFor(ctx: CommandContext, preset: string, ids: Id[]): PresetInfo {
  const info = ctx.presets?.(preset);
  if (!info) throw fail('unknown-preset', ids, `Unknown preset ${preset}`);
  return info;
}

/** Ids are unique per floor across all entity kinds; re-running a create command must not overwrite. */
export function assertFreeId(ctx: Pick<CommandContext, 'floor'>, id: Id): void {
  const f = ctx.floor;
  if (
    f.nodes[id] ||
    f.walls[id] ||
    f.openings[id] ||
    f.rooms[id] ||
    f.items[id] ||
    f.columns[id] ||
    f.stairs[id] ||
    f.roofs[id]
  ) {
    throw fail('duplicate-id', [id], 'Id ' + id + ' already exists in the floor');
  }
}
