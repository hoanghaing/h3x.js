import type { CommandContext } from '../document/changes';
import { H3xValidationError } from '../errors';
import type { Id } from '../types';

/** A one-issue validation error. */
export const fail = (code: string, ids: Id[], message: string): H3xValidationError =>
  new H3xValidationError([{ code, ids, message }]);

export const notFound = (what: string, id: Id): H3xValidationError =>
  fail('not-found', [id], `${what} ${id} does not exist`);

/** Ids are unique per floor across all entity kinds; re-running a create command must not overwrite. */
export function assertFreeId(ctx: CommandContext, id: Id): void {
  const f = ctx.floor;
  if (f.nodes[id] || f.walls[id] || f.openings[id] || f.rooms[id] || f.items[id] || f.columns[id]) {
    throw fail('duplicate-id', [id], 'Id ' + id + ' already exists in the floor');
  }
}
