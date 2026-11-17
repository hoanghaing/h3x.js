import type { Floor, Id, PresetResolver, Room, Site } from '../core';
import { H3xValidationError, roomShape, stairOutline } from '../core';
import { closestPointOnSegment } from '../core/geometry/segment';
import { pointInPolygon } from '../core/geometry/polygon';
import type { WallCorners } from '../shared/walls/joins';
import { columnShape, inRoomShape, itemFootprint, openingShape, wallOutline } from './shapes';
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
  site?: Readonly<Site>;
  /** Rise of `floor`'s stairs to the floor above (`stairRise`); NaN / absent: stairs hit on their bay. */
  stairRise?: number;
}

const NODE_TOLERANCE_PX = 8;
const WALL_TOLERANCE_PX = 4;

export function hitTest(scene: HitScene, s: ScreenPoint): HitTarget {
  const { floor, view } = scene;
  const p = screenToPlan(view, s);

  let nearestNode: Id | undefined;
  let nearestNodeDist = NODE_TOLERANCE_PX;
  for (const node of Object.values(floor.nodes)) {
    const q = planToScreen(view, node);
    const d = Math.hypot(q.x - s.x, q.y - s.y);
    if (d <= nearestNodeDist) {
      nearestNode = node.id;
      nearestNodeDist = d;
    }
  }
  if (nearestNode !== undefined) return { kind: 'node', id: nearestNode };

  for (const c of Object.values(floor.columns)) {
    const shape = columnShape(c);
    const inside =
      shape.kind === 'circle'
        ? Math.hypot(p.x - shape.cx, p.y - shape.cy) <= shape.r
        : pointInPolygon(p, shape.points);
    if (inside) return { kind: 'column', id: c.id };
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

  for (const w of Object.values(floor.walls)) {
    const c = scene.corners[w.id];
    if (c && pointInPolygon(p, wallOutline(c))) return { kind: 'wall', id: w.id };
  }
  // Pick aid for walls drawn thinner than 2 × WALL_TOLERANCE_PX: within that distance of the
  // centre line. For a wall drawn wider this band lies inside its outline, so it adds nothing.
  let nearestWall: Id | undefined;
  let nearestWallDist = WALL_TOLERANCE_PX / view.scale;
  for (const w of Object.values(floor.walls)) {
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (!a || !b) continue;
    const cp = closestPointOnSegment(p, a, b).point;
    const d = Math.hypot(cp.x - p.x, cp.y - p.y);
    if (d <= nearestWallDist) {
      nearestWall = w.id;
      nearestWallDist = d;
    }
  }
  if (nearestWall !== undefined) return { kind: 'wall', id: nearestWall };

  for (const item of Object.values(floor.items)) {
    const fp = itemFootprint(item, floor, scene.presets);
    if (fp && pointInPolygon(p, fp)) return { kind: 'item', id: item.id };
  }

  const rise = scene.stairRise ?? NaN;
  for (const stair of Object.values(floor.stairs)) {
    if (pointInPolygon(p, stairOutline(stair, rise))) return { kind: 'stair', id: stair.id };
  }

  for (const room of Object.values(floor.rooms)) {
    const shape = closedRoomShape(floor, room);
    if (shape && inRoomShape(p, shape)) return { kind: 'room', id: room.id };
  }

  const pts = scene.site?.points ?? [];
  const reach = WALL_TOLERANCE_PX / view.scale;
  for (let i = 0; i < pts.length; i++) {
    const cp = closestPointOnSegment(p, pts[i]!, pts[(i + 1) % pts.length]!).point;
    if (Math.hypot(cp.x - p.x, cp.y - p.y) <= reach) return { kind: 'site', id: 'site' };
  }

  return null;
}

/** The room's drawn (inner) outline and holes, or undefined for a room that does not close (tolerated on load). */
function closedRoomShape(floor: Floor, room: Room): ReturnType<typeof roomShape> | undefined {
  try {
    return roomShape(floor, room, 'inner');
  } catch (e) {
    if (e instanceof H3xValidationError) return undefined;
    throw e;
  }
}
