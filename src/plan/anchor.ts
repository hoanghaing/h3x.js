import type { Floor, Id, Vec2 } from '../core';
import { distance } from '../core/geometry/vec';

function incident(floor: Floor, nodeId: Id): number {
  let n = 0;
  for (const w of Object.values(floor.walls)) if (w.a === nodeId || w.b === nodeId) n++;
  return n;
}

/**
 * Which end of a wall stays put when its length is edited: the end with more incident walls;
 * on a tie the end farther from `near`; on a tie or without `near`, `'a'`.
 */
export function pickAnchor(floor: Floor, wallId: Id, near?: Vec2): 'a' | 'b' {
  const wall = floor.walls[wallId];
  if (!wall) return 'a';
  const ca = incident(floor, wall.a);
  const cb = incident(floor, wall.b);
  if (ca !== cb) return ca > cb ? 'a' : 'b';
  const a = floor.nodes[wall.a];
  const b = floor.nodes[wall.b];
  if (!near || !a || !b) return 'a';
  return distance(near, b) > distance(near, a) ? 'b' : 'a';
}
