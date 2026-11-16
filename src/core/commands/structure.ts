import type { Command } from '../document/changes';
import { createId } from '../ids';
import { structural } from '../topology/draft';
import {
  addWallIn,
  dropNodeIn,
  mergeNodesIn,
  removeNodeIn,
  removeWallIn,
  splitAt,
} from '../topology/ops';
import type { NewWall } from '../topology/ops';
import type { Id, Vec2 } from '../types';
import { assertFreeId } from './shared';

/**
 * Draws a wall (see the topology rules): ends snap to nodes or split walls, crossings
 * split both walls, rooms re-sync. After a run `createdId` is the wall touching `from`
 * (the existing wall when the ends are already joined, a no-op) and `endNodeId` the
 * node at `to`; before any run they are the pre-generated ids.
 */
export function addWall(input: NewWall): Command & { createdId: Id; endNodeId: Id } {
  let createdId = createId();
  let endNodeId = createId();
  const ids = { wall: createdId, endNode: endNodeId };
  const cmd = structural('addWall', (draft, ctx) => {
    const r = addWallIn(draft, input, ids, ctx.presets);
    createdId = r.wallId;
    endNodeId = r.endNodeId;
  });
  return {
    ...cmd,
    get createdId() {
      return createdId;
    },
    get endNodeId() {
      return endNodeId;
    },
  };
}

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

/**
 * Re-attaches the walls of `drop` to `keep` and deletes `drop`. Self-loop walls go; of
 * duplicate walls the one with more openings + wall items survives (then smaller id).
 * Rooms re-sync.
 */
export function mergeNodes(keep: Id, drop: Id): Command {
  return structural('mergeNodes', (draft, ctx) => mergeNodesIn(draft, keep, drop, ctx.presets));
}

/**
 * Moves a node onto a node (merge) or onto a point of a wall (T-junction) as one change
 * list; a plain `moveNode` there would pass through a too-short wall. Rooms re-sync.
 */
export function dropNode(nodeId: Id, target: { node: Id } | { wall: Id; at: Vec2 }): Command {
  const ids = { wall: createId(), node: createId() };
  return structural('dropNode', (draft, ctx) =>
    dropNodeIn(draft, nodeId, target, ids, ctx.presets),
  );
}
