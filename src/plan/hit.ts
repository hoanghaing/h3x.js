import type { Floor, Id, PresetResolver, Room, RoofGeometry, Site, Vec2 } from '../core';
import { H3xValidationError, openingGeometry, openingHit, roomShape, stairOutline } from '../core';
import { closestPointOnSegment } from '../core/geometry/segment';
import { pointInPolygon } from '../core/geometry/polygon';
import type { Junction, WallCorners } from '../shared/walls/joins';
import { roofHit } from './roofs';
import { columnShape, inRoomShape, itemFootprint, wallOutline } from './shapes';
import type { PlanKind, Rect, ScreenPoint } from './types';
import { planToScreen, screenToPlan, type View } from './view';

export type HitTarget = { kind: PlanKind; id: Id } | { kind: 'dimension'; id: Id } | null;

export interface HitScene {
  floor: Floor;
  view: View;
  corners: Record<Id, WallCorners>;
  /** The junction fills drawn between wall ends, by node id: they hit a wall of that node. */
  junctions?: Readonly<Record<Id, Junction>>;
  /** Dimension label rectangles in screen px, keyed by wall id. */
  dimensions: Array<{ wallId: Id; rect: Rect }>;
  presets?: PresetResolver;
  site?: Readonly<Site>;
  /** Rise of `floor`'s stairs to the floor above (`stairRise`); NaN / absent: stairs hit on their bay. */
  stairRise?: number;
  /** false: roofs are hidden and never hit (default true). */
  roofsVisible?: boolean;
  /** Roof geometry cached at render time by roof id; missing entries are computed. */
  roofGeometry?: ReadonlyMap<Id, RoofGeometry>;
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

  const openings = Object.values(floor.openings).map((o) => ({
    id: o.id,
    geometry: openingGeometry(floor, o),
  }));
  // On an opening first: the reach around one door's leaf must not cover the door beside it.
  for (const reach of [0, WALL_TOLERANCE_PX / view.scale]) {
    for (const { id, geometry } of openings) {
      if (geometry && openingHit(geometry, p, reach)) return { kind: 'opening', id };
    }
  }

  for (const w of Object.values(floor.walls)) {
    const c = scene.corners[w.id];
    if (c && pointInPolygon(p, wallOutline(c))) return { kind: 'wall', id: w.id };
  }
  for (const [node, j] of Object.entries(scene.junctions ?? {})) {
    if (!pointInPolygon(p, j.points)) continue;
    const id = nearestWallAt(floor, node, p);
    if (id !== undefined) return { kind: 'wall', id };
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

  if (scene.roofsVisible !== false) {
    const roofReach = WALL_TOLERANCE_PX / view.scale;
    for (const roof of Object.values(floor.roofs)) {
      if (roofHit(roof, floor, p, roofReach, scene.roofGeometry?.get(roof.id)))
        return { kind: 'roof', id: roof.id };
    }
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

/** Of the walls meeting at `node`, the one whose centre line is nearest `p`. */
function nearestWallAt(floor: Floor, node: Id, p: Vec2): Id | undefined {
  let best: Id | undefined;
  let bestDist = Infinity;
  for (const w of Object.values(floor.walls)) {
    if (w.a !== node && w.b !== node) continue;
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (!a || !b) continue;
    const c = closestPointOnSegment(p, a, b).point;
    const d = Math.hypot(c.x - p.x, c.y - p.y);
    if (d < bestDist) {
      best = w.id;
      bestDist = d;
    }
  }
  return best;
}

/** The room whose drawn (inner) outline contains `p`, if any. */
export function roomAt(floor: Floor, p: Vec2): Room | undefined {
  for (const room of Object.values(floor.rooms)) {
    const shape = closedRoomShape(floor, room);
    if (shape && inRoomShape(p, shape)) return room;
  }
  return undefined;
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
