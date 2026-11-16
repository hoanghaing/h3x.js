import type { Command } from '../document/changes';
import { createId } from '../ids';
import { structural } from '../topology/draft';
import { removeNodeIn, removeWallIn, splitAt } from '../topology/ops';
import type { Id, Vec2 } from '../types';
import { assertFreeId } from './shared';

/** Splits a wall at the projection of `at`; `createdId` is the new node. */
export function splitWall(wallId: Id, at: Vec2): Command & { createdId: Id } {
  const nodeId = createId();
  const newWallId = createId();
  const cmd = structural('splitWall', (draft, ctx) => {
    assertFreeId(ctx, nodeId);
    assertFreeId(ctx, newWallId);
    splitAt(draft, wallId, at, newWallId, nodeId, ctx.presets);
  });
  return { ...cmd, createdId: nodeId };
}

/** Deletes a wall with its openings / wall items and orphaned nodes; rooms re-sync. */
export function removeWall(wallId: Id): Command {
  return structural('removeWall', (draft) => removeWallIn(draft, wallId));
}

/** Degree 2 merges the two walls; otherwise deletes the node and its walls. Rooms re-sync. */
export function removeNode(nodeId: Id): Command {
  return structural('removeNode', (draft, ctx) => removeNodeIn(draft, nodeId, ctx.presets));
}
