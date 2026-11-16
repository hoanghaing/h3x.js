import type { Floor, Id, Vec2 } from '../core';
import { add, dot, leftNormal, normalize, scale, sub } from '../core/geometry/vec';
import type { Selection } from './types';
import type { View } from './view';

/** Pixel gap between the wall face and its dimension line. */
const DIMENSION_GAP_PX = 18;

const wallsAtNode = (floor: Floor, node: Id): Id[] =>
  Object.values(floor.walls)
    .filter((w) => w.a === node || w.b === node)
    .map((w) => w.id);

/** What decides which dimensions show; editing state is supplied by tools. */
export interface DimensionState {
  selection: Selection | null;
  draggingNode: Id | null;
}

/** Walls whose length label should currently be visible. */
export function wallsShowingDimensions(floor: Floor, state: DimensionState): Id[] {
  if (state.draggingNode) return wallsAtNode(floor, state.draggingNode);
  const sel = state.selection;
  if (sel?.kind === 'wall') return [sel.id];
  if (sel?.kind === 'node') return wallsAtNode(floor, sel.id);
  const count: Record<Id, number> = {};
  for (const room of Object.values(floor.rooms)) {
    for (const id of new Set(room.walls)) count[id] = (count[id] ?? 0) + 1;
  }
  return Object.keys(floor.walls).filter((id) => (count[id] ?? 0) < 2);
}

export function dimensionLabel(
  floor: Floor,
  wallId: Id,
  view: View,
): { text: string; at: Vec2; angle: number; line: [Vec2, Vec2] } {
  const wall = floor.walls[wallId];
  const a = wall && floor.nodes[wall.a];
  const b = wall && floor.nodes[wall.b];
  if (!wall || !a || !b) {
    const z = { x: 0, y: 0 };
    return { text: '0.00', at: z, angle: 0, line: [z, z] };
  }
  const nodes = Object.values(floor.nodes);
  const centroid = {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  };
  const delta = sub(b, a);
  const d = normalize(delta);
  const mid = scale(add(a, b), 0.5);
  const n = leftNormal(d);
  const sign = dot(n, sub(mid, centroid)) >= 0 ? 1 : -1;
  const off = scale(n, sign * (wall.thickness / 2 + DIMENSION_GAP_PX / view.scale));
  const line: [Vec2, Vec2] = [add(a, off), add(b, off)];
  let angle = (Math.atan2(delta.y, delta.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle <= -90) angle += 180;
  return {
    text: Math.hypot(delta.x, delta.y).toFixed(2),
    at: add(mid, off),
    angle,
    line,
  };
}
