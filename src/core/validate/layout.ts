import type { EntityChange } from '../document/changes';
import type { H3xDocument, Validator } from '../document/H3xDocument';
import {
  GEOM_TOL,
  MAX_COLUMN_SIZE,
  MIN_ROOM_AREA,
  MIN_WALL_LENGTH,
  OPENING_END_MARGIN,
} from '../constants';
import { H3xValidationError } from '../errors';
import { polygonOverlapArea } from '../geometry/clip';
import { obbCorners } from '../geometry/obb';
import { isSimple, polygonContainsPolygon, signedArea } from '../geometry/polygon';
import { segmentsIntersect } from '../geometry/segment';
import { distance } from '../geometry/vec';
import { roomArea, roomPolygon } from '../rooms/detect';
import type { Column, Floor, Id, Issue, Site, Vec2 } from '../types';

export function wallLength(floor: Floor, id: Id): number {
  const w = floor.walls[id];
  const a = w && floor.nodes[w.a];
  const b = w && floor.nodes[w.b];
  return a && b ? distance(a, b) : 0;
}

/** Half of the thickest other wall meeting `wallId` at `node` (0 when none). */
function meetHalf(floor: Floor, wallId: Id, node: Id): number {
  let half = 0;
  for (const o of Object.values(floor.walls)) {
    if (o.id !== wallId && (o.a === node || o.b === node)) half = Math.max(half, o.thickness / 2);
  }
  return half;
}

/**
 * Valid centre-offset range for something `width` wide on wall `wallId`. Each
 * end is shortened by max(margin, half the thickness of the thickest other
 * wall meeting at that end node), so nothing sits inside a meeting wall.
 * Openings use margin OPENING_END_MARGIN, wall items 0. `length` overrides the
 * current wall length (layout re-fit). hi < lo means it cannot fit.
 */
export function wallUsableRange(
  floor: Floor,
  wallId: Id,
  opts: { width: number; margin?: number; length?: number },
): { lo: number; hi: number } {
  const w = floor.walls[wallId];
  const len = opts.length ?? wallLength(floor, wallId);
  const margin = opts.margin ?? 0;
  const startCut = w ? Math.max(margin, meetHalf(floor, wallId, w.a)) : margin;
  const endCut = w ? Math.max(margin, meetHalf(floor, wallId, w.b)) : margin;
  return { lo: startCut + opts.width / 2, hi: len - endCut - opts.width / 2 };
}

/** Opening centre range on its wall (see wallUsableRange). */
export function openingRange(
  floor: Floor,
  o: { wall: Id; width: number },
  length?: number,
): { lo: number; hi: number } {
  return wallUsableRange(floor, o.wall, { width: o.width, margin: OPENING_END_MARGIN, length });
}

/** True when `offset` lies in [lo, hi] within GEOM_TOL (and the range is not empty). */
export function inRange(offset: number, r: { lo: number; hi: number }): boolean {
  return r.hi >= r.lo - GEOM_TOL && offset >= r.lo - GEOM_TOL && offset <= r.hi + GEOM_TOL;
}

function wallIssues(floor: Floor, ids: Iterable<Id>): Issue[] {
  const out: Issue[] = [];
  for (const id of ids) {
    if (!floor.walls[id]) continue;
    const len = wallLength(floor, id);
    if (len < MIN_WALL_LENGTH - GEOM_TOL) {
      out.push({
        code: 'wall-too-short',
        ids: [id],
        message: `Wall ${id} is ${len.toFixed(3)} m, minimum is ${MIN_WALL_LENGTH} m`,
      });
    }
  }
  return out;
}

function crossIssues(floor: Floor, scope: Iterable<Id>): Issue[] {
  const out: Issue[] = [];
  const seen = new Set<string>();
  const all = Object.values(floor.walls);
  for (const id of scope) {
    const w = floor.walls[id];
    const a = w && floor.nodes[w.a];
    const b = w && floor.nodes[w.b];
    if (!w || !a || !b) continue;
    for (const o of all) {
      if (o.id === id || o.a === w.a || o.a === w.b || o.b === w.a || o.b === w.b) continue;
      const key = [id, o.id].sort().join('|');
      if (seen.has(key)) continue;
      const c = floor.nodes[o.a];
      const d = floor.nodes[o.b];
      if (!c || !d) continue;
      if (segmentsIntersect(a, b, c, d)) {
        seen.add(key);
        out.push({
          code: 'walls-cross',
          ids: [id, o.id],
          message: `Walls ${id} and ${o.id} cross`,
        });
      }
    }
  }
  return out;
}

function roomIssue(floor: Floor, roomId: Id): Issue | null {
  const room = floor.rooms[roomId];
  if (!room) return null;
  const bad = (why: string): Issue => ({
    code: 'room-degenerate',
    ids: [roomId],
    message: `Room ${roomId} is degenerate: ${why}`,
  });
  let center: Vec2[];
  try {
    center = roomPolygon(floor, room, 'center');
  } catch (err) {
    if (err instanceof H3xValidationError) return bad('walls do not form a closed loop');
    throw err;
  }
  if (!isSimple(center)) return bad('outline is not simple');
  if (signedArea(center) <= 0) return bad('outline is flipped');
  const holes: Vec2[][] = [];
  for (const walls of room.holes ?? []) {
    let hole: Vec2[];
    try {
      hole = roomPolygon(floor, { ...room, walls }, 'center');
    } catch (err) {
      if (err instanceof H3xValidationError) return bad('a hole does not form a closed loop');
      throw err;
    }
    if (!isSimple(hole)) return bad('a hole outline is not simple');
    if (!polygonContainsPolygon(center, hole)) return bad('a hole is not inside the outline');
    holes.push(hole);
  }
  for (let i = 0; i < holes.length; i++) {
    for (let j = i + 1; j < holes.length; j++) {
      if (polygonOverlapArea(holes[i] as Vec2[], holes[j] as Vec2[]) > HOLE_OVERLAP_AREA) {
        return bad('two holes overlap');
      }
    }
  }
  const inner = roomArea(floor, room, 'inner');
  if (inner < MIN_ROOM_AREA - GEOM_TOL)
    return bad(`inner area ${inner.toFixed(3)} m2 is below ${MIN_ROOM_AREA}`);
  return null;
}

/** Overlap areas (m2) at or below this count as touching. */
const HOLE_OVERLAP_AREA = 1e-6;
const COLUMN_OVERLAP_AREA = 1e-5;
const ROUND_SEGMENTS = 32;

function columnPolygon(c: Column): Vec2[] {
  if (c.shape === 'round') {
    const r = c.width / 2;
    return Array.from({ length: ROUND_SEGMENTS }, (_, i) => {
      const t = (i / ROUND_SEGMENTS) * Math.PI * 2;
      return { x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r };
    });
  }
  return obbCorners({
    center: { x: c.x, y: c.y },
    halfW: c.width / 2,
    halfD: (c.depth ?? c.width) / 2,
    rotation: c.rotation,
  });
}

function columnSizeIssues(floor: Floor, ids: Iterable<Id>): Issue[] {
  const out: Issue[] = [];
  for (const id of ids) {
    const c = floor.columns[id];
    if (!c) continue;
    const sizes = c.shape === 'square' && c.depth !== undefined ? [c.width, c.depth] : [c.width];
    if (sizes.some((s) => !(s > 0) || s > MAX_COLUMN_SIZE + GEOM_TOL)) {
      out.push({
        code: 'column-size',
        ids: [id],
        message: `Column ${id} size must be above 0 and at most ${MAX_COLUMN_SIZE} m`,
      });
    }
  }
  return out;
}

function columnOverlapIssues(floor: Floor): Issue[] {
  const out: Issue[] = [];
  const cols = Object.values(floor.columns).filter(
    (c) => columnSizeIssues(floor, [c.id]).length === 0,
  );
  const polys = cols.map(columnPolygon);
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      if (polygonOverlapArea(polys[i] as Vec2[], polys[j] as Vec2[]) > COLUMN_OVERLAP_AREA) {
        const a = cols[i] as Column;
        const b = cols[j] as Column;
        out.push({
          code: 'columns-overlap',
          ids: [a.id, b.id],
          message: `Columns ${a.id} and ${b.id} overlap`,
        });
      }
    }
  }
  return out;
}

function siteIssues(site: Site | undefined): Issue[] {
  if (!site || isSimple(site.points)) return [];
  return [{ code: 'site-not-simple', ids: [site.id], message: 'Site outline is not simple' }];
}

function openingIssues(floor: Floor): Issue[] {
  const out: Issue[] = [];
  for (const o of Object.values(floor.openings)) {
    if (!floor.walls[o.wall]) continue;
    if (!inRange(o.offset, openingRange(floor, o))) {
      out.push({
        code: 'opening-out-of-wall',
        ids: [o.id],
        message: `Opening ${o.id} does not fit inside wall ${o.wall}`,
      });
    }
  }
  return out;
}

/** All layout issues, blocking and non-blocking. */
export function validateLayout(floor: Floor, site?: Site): Issue[] {
  const wallIds = Object.keys(floor.walls);
  return [
    ...wallIssues(floor, wallIds),
    ...crossIssues(floor, wallIds),
    ...Object.keys(floor.rooms).flatMap((id) => roomIssue(floor, id) ?? []),
    ...openingIssues(floor),
    ...columnSizeIssues(floor, Object.keys(floor.columns)),
    ...columnOverlapIssues(floor),
    ...siteIssues(site),
  ];
}

/** Blocking issues only, limited to the entities touched by the change set. */
export const layoutValidator: Validator = (doc: H3xDocument, changes: EntityChange[]): Issue[] => {
  const floor = doc.floor as Floor;
  const nodes = new Set<Id>();
  const walls = new Set<Id>();
  const rooms = new Set<Id>();
  const columns = new Set<Id>();
  for (const c of changes) {
    if (c.kind === 'node') nodes.add(c.id);
    else if (c.kind === 'wall') walls.add(c.id);
    else if (c.kind === 'room') rooms.add(c.id);
    else if (c.kind === 'column') columns.add(c.id);
  }
  if (nodes.size === 0 && walls.size === 0 && rooms.size === 0 && columns.size === 0) return [];
  for (const w of Object.values(floor.walls)) {
    if (nodes.has(w.a) || nodes.has(w.b)) walls.add(w.id);
  }
  for (const r of Object.values(floor.rooms)) {
    if (r.walls.some((id) => walls.has(id))) rooms.add(r.id);
  }
  return [
    ...wallIssues(floor, walls),
    ...crossIssues(floor, walls),
    ...[...rooms].flatMap((id) => roomIssue(floor, id) ?? []),
    ...columnSizeIssues(floor, columns),
  ];
};
