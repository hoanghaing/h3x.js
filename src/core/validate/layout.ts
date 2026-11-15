import type { EntityChange } from '../document/changes';
import type { H3xDocument, Validator } from '../document/H3xDocument';
import { MIN_ROOM_AREA, MIN_WALL_LENGTH, OPENING_END_MARGIN } from '../constants';
import { H3xValidationError } from '../errors';
import { isSimple, signedArea } from '../geometry/polygon';
import { segmentsIntersect } from '../geometry/segment';
import { distance } from '../geometry/vec';
import { roomPolygon } from '../rooms/detect';
import type { Floor, Id, Issue, Vec2 } from '../types';

const EPS = 1e-9;

/** Valid centre range for an opening of `width` on a wall of `len` (hi < lo means it cannot fit). */
export function openingRange(len: number, width: number): { lo: number; hi: number } {
  return { lo: OPENING_END_MARGIN + width / 2, hi: len - OPENING_END_MARGIN - width / 2 };
}

function wallLength(floor: Floor, id: Id): number {
  const w = floor.walls[id];
  const a = w && floor.nodes[w.a];
  const b = w && floor.nodes[w.b];
  return a && b ? distance(a, b) : 0;
}

function wallIssues(floor: Floor, ids: Iterable<Id>): Issue[] {
  const out: Issue[] = [];
  for (const id of ids) {
    if (!floor.walls[id]) continue;
    const len = wallLength(floor, id);
    if (len < MIN_WALL_LENGTH - EPS) {
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
        out.push({ code: 'walls-cross', ids: [id, o.id], message: `Walls ${id} and ${o.id} cross` });
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
  const inner = signedArea(roomPolygon(floor, room, 'inner'));
  if (inner < MIN_ROOM_AREA) return bad(`inner area ${inner.toFixed(3)} m2 is below ${MIN_ROOM_AREA}`);
  return null;
}

function openingIssues(floor: Floor): Issue[] {
  const out: Issue[] = [];
  for (const o of Object.values(floor.openings)) {
    if (!floor.walls[o.wall]) continue;
    const { lo, hi } = openingRange(wallLength(floor, o.wall), o.width);
    if (hi < lo - EPS || o.offset < lo - EPS || o.offset > hi + EPS) {
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
export function validateLayout(floor: Floor): Issue[] {
  const wallIds = Object.keys(floor.walls);
  return [
    ...wallIssues(floor, wallIds),
    ...crossIssues(floor, wallIds),
    ...Object.keys(floor.rooms).flatMap((id) => roomIssue(floor, id) ?? []),
    ...openingIssues(floor),
  ];
}

/** Blocking issues only, limited to the entities touched by the change set. */
export const layoutValidator: Validator = (doc: H3xDocument, changes: EntityChange[]): Issue[] => {
  const floor = doc.floor as Floor;
  const nodes = new Set<Id>();
  const walls = new Set<Id>();
  const rooms = new Set<Id>();
  for (const c of changes) {
    if (c.kind === 'node') nodes.add(c.id);
    else if (c.kind === 'wall') walls.add(c.id);
    else if (c.kind === 'room') rooms.add(c.id);
  }
  if (nodes.size === 0 && walls.size === 0 && rooms.size === 0) return [];
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
  ];
};
