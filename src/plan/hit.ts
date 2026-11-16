import type { Floor, Id, PresetResolver } from '../core';
import { roomPolygon } from '../core';
import { closestPointOnSegment } from '../core/geometry/segment';
import { pointInPolygon } from '../core/geometry/polygon';
import type { WallCorners } from '../shared/walls/joins';
import { itemFootprint, openingShape, wallOutline } from './shapes';
import type { PlanKind, Rect, ScreenPoint } from './types';
import { planToScreen, screenToPlan, type View } from './view';

export type HitTarget = { kind: PlanKind; id: Id } | { kind: 'dimension'; id: Id } | null;

export interface HitScene {
  floor: Floor;
  view: View;
  corners: Record<Id, WallCorners>;
  /** Dimension label rectangles in screen px, keyed by wall id. */
  dimensions: Array<{ wallId: Id; rect: Rect }>;
  presets?: PresetResolver;
}

const NODE_TOLERANCE_PX = 8;
const WALL_TOLERANCE_PX = 4;

export function hitTest(scene: HitScene, s: ScreenPoint): HitTarget {
  const { floor, view } = scene;
  const p = screenToPlan(view, s);

  for (const node of Object.values(floor.nodes)) {
    const q = planToScreen(view, node);
    if (Math.hypot(q.x - s.x, q.y - s.y) <= NODE_TOLERANCE_PX) return { kind: 'node', id: node.id };
  }

  for (const d of scene.dimensions) {
    const r = d.rect;
    if (s.x >= r.x && s.x <= r.x + r.width && s.y >= r.y && s.y <= r.y + r.height) {
      return { kind: 'dimension', id: d.wallId };
    }
  }

  for (const o of Object.values(floor.openings)) {
    if (pointInPolygon(p, openingShape(floor, o).gap)) return { kind: 'opening', id: o.id };
  }

  const tol = WALL_TOLERANCE_PX / view.scale;
  for (const w of Object.values(floor.walls)) {
    const c = scene.corners[w.id];
    if (c && pointInPolygon(p, wallOutline(c))) return { kind: 'wall', id: w.id };
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (!a || !b) continue;
    const cp = closestPointOnSegment(p, a, b).point;
    if (Math.hypot(cp.x - p.x, cp.y - p.y) <= tol) return { kind: 'wall', id: w.id };
  }

  for (const item of Object.values(floor.items)) {
    const fp = itemFootprint(item, floor, scene.presets);
    if (fp && pointInPolygon(p, fp)) return { kind: 'item', id: item.id };
  }

  for (const room of Object.values(floor.rooms)) {
    if (pointInPolygon(p, roomPolygon(floor, room, 'center'))) return { kind: 'room', id: room.id };
  }

  return null;
}
