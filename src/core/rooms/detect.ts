import { H3xValidationError } from '../errors';
import { EPS } from '../geometry/vec';
import { insetPolygon, signedArea } from '../geometry/polygon';
import type { Floor, Id, Room, Vec2 } from '../types';

interface HalfEdge {
  from: Id;
  to: Id;
  wall: Id;
  angle: number;
}

const heKey = (from: Id, to: Id, wall: Id): string => `${from}>${to}>${wall}`;

/**
 * Interior faces of the wall graph. Each face lists nodes and walls in CCW
 * order (walls[i] connects nodes[i] to nodes[i+1]). The outer face is dropped.
 */
export function detectRooms(floor: Floor): Array<{ walls: Id[]; nodes: Id[] }> {
  const outgoing = new Map<Id, HalfEdge[]>();
  const add = (from: Id, to: Id, wall: Id): void => {
    const p = floor.nodes[from];
    const q = floor.nodes[to];
    if (!p || !q) return;
    const list = outgoing.get(from) ?? [];
    list.push({ from, to, wall, angle: Math.atan2(q.y - p.y, q.x - p.x) });
    outgoing.set(from, list);
  };
  for (const w of Object.values(floor.walls)) {
    add(w.a, w.b, w.id);
    add(w.b, w.a, w.id);
  }
  for (const list of outgoing.values()) list.sort((x, y) => x.angle - y.angle);

  // Next half-edge after u->v: at v, the one immediately clockwise from v->u.
  const next = (e: HalfEdge): HalfEdge | undefined => {
    const list = outgoing.get(e.to);
    if (!list) return undefined;
    const idx = list.findIndex((o) => o.to === e.from && o.wall === e.wall);
    if (idx < 0) return undefined;
    return list[(idx - 1 + list.length) % list.length];
  };

  const visited = new Set<string>();
  const faces: Array<{ walls: Id[]; nodes: Id[] }> = [];
  for (const list of outgoing.values()) {
    for (const start of list) {
      if (visited.has(heKey(start.from, start.to, start.wall))) continue;
      const loop: HalfEdge[] = [];
      let cur: HalfEdge | undefined = start;
      while (cur && !visited.has(heKey(cur.from, cur.to, cur.wall))) {
        visited.add(heKey(cur.from, cur.to, cur.wall));
        loop.push(cur);
        cur = next(cur);
      }
      if (loop.length < 3) continue;
      const pts = loop.map((e) => floor.nodes[e.from] as Vec2);
      if (signedArea(pts) > EPS) {
        faces.push({ nodes: loop.map((e) => e.from), walls: loop.map((e) => e.wall) });
      }
    }
  }
  return faces;
}

function openError(room: Room, message: string): H3xValidationError {
  return new H3xValidationError([{ code: 'room-open', ids: [room.id], message }]);
}

/**
 * Node loop following room.walls order WITHOUT re-orienting: nodes[i] to
 * nodes[i+1] is walls[i]. For a CCW-stored room the loop is CCW; a room whose
 * nodes were moved into a flipped shape yields a CW loop (callers rely on that).
 * Throws `room-open` unless the walls form one simple closed loop.
 */
export function roomNodeLoop(floor: Floor, room: Room): Id[] {
  const ws = room.walls.map((id) => floor.walls[id]);
  if (ws.length < 3) throw openError(room, `Room ${room.id} has fewer than 3 walls`);
  if (ws.some((w) => !w)) throw openError(room, `Room ${room.id} references a missing wall`);
  const walls = ws as NonNullable<(typeof ws)[number]>[];
  const w0 = walls[0]!;
  const w1 = walls[1]!;
  const start = w1.a === w0.a || w1.b === w0.a ? w0.b : w0.a;
  const shared = start === w0.a ? w0.b : w0.a;
  if (w1.a !== shared && w1.b !== shared) {
    throw openError(room, `Room ${room.id} walls are not connected`);
  }
  const nodes: Id[] = [];
  const seen = new Set<Id>();
  let cur = start;
  for (const w of walls) {
    if (seen.has(cur)) throw openError(room, `Room ${room.id} walls branch or revisit a node`);
    seen.add(cur);
    nodes.push(cur);
    if (w.a === cur) cur = w.b;
    else if (w.b === cur) cur = w.a;
    else throw openError(room, `Room ${room.id} walls are not a continuous chain`);
  }
  if (cur !== start) throw openError(room, `Room ${room.id} walls do not close a loop`);
  return nodes;
}

/**
 * Room outline. 'inner' insets each edge by wall.thickness / 2 and assumes the
 * loop is CCW; it is only meaningful for valid CCW rooms.
 */
export function roomPolygon(floor: Floor, room: Room, kind: 'center' | 'inner'): Vec2[] {
  const pts = roomNodeLoop(floor, room).map((id) => {
    const n = floor.nodes[id] as Vec2;
    return { x: n.x, y: n.y };
  });
  if (kind === 'center') return pts;
  const dists = room.walls.map((id) => (floor.walls[id]?.thickness ?? 0) / 2);
  return insetPolygon(pts, dists);
}

export function roomArea(
  floor: Floor,
  room: Room,
  kind: 'center' | 'inner' = 'inner',
): number {
  return signedArea(roomPolygon(floor, room, kind));
}
