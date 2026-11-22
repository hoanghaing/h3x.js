import { GEOM_TOL, MIN_ROOM_AREA } from '../constants';
import { H3xValidationError } from '../errors';
import { EPS, add, dot, leftNormal, normalize, scale, sub } from '../geometry/vec';
import { uncoveredArea } from '../geometry/clip';
import { insetPolygon, isSimple, polygonContainsPolygon, signedArea } from '../geometry/polygon';
import type { Floor, Id, Room, Vec2, Wall } from '../types';

interface HalfEdge {
  from: Id;
  to: Id;
  wall: Id;
  angle: number;
}

/** A detected room: walls / nodes CCW (walls[i] joins nodes[i] to nodes[i+1]), holes CW. */
export interface DetectedRoom {
  walls: Id[];
  nodes: Id[];
  holes: Id[][];
}

const heKey = (from: Id, to: Id, wall: Id): string => `${from}>${to}>${wall}`;

/** True when a room's net inner area is below MIN_ROOM_AREA beyond GEOM_TOL. */
export function isBelowMinRoomArea(innerArea: number): boolean {
  return innerArea < MIN_ROOM_AREA - GEOM_TOL;
}

/** Walls that are bridges of the wall graph (iterative Tarjan, multi-edge safe). */
function findBridges(walls: Wall[]): Set<Id> {
  const adj = new Map<Id, Array<{ to: Id; wall: Id }>>();
  for (const w of walls) {
    for (const [from, to] of [
      [w.a, w.b],
      [w.b, w.a],
    ] as const) {
      const list = adj.get(from) ?? [];
      list.push({ to, wall: w.id });
      adj.set(from, list);
    }
  }
  const disc = new Map<Id, number>();
  const low = new Map<Id, number>();
  const bridges = new Set<Id>();
  let time = 0;
  for (const root of adj.keys()) {
    if (disc.has(root)) continue;
    disc.set(root, time);
    low.set(root, time++);
    const stack: Array<{ node: Id; via: Id | null; i: number }> = [{ node: root, via: null, i: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const edges = adj.get(top.node)!;
      if (top.i < edges.length) {
        const e = edges[top.i++]!;
        if (e.wall === top.via) continue;
        if (disc.has(e.to)) {
          low.set(top.node, Math.min(low.get(top.node)!, disc.get(e.to)!));
        } else {
          disc.set(e.to, time);
          low.set(e.to, time++);
          stack.push({ node: e.to, via: e.wall, i: 0 });
        }
        continue;
      }
      stack.pop();
      const parent = stack[stack.length - 1];
      if (!parent || top.via === null) continue;
      low.set(parent.node, Math.min(low.get(parent.node)!, low.get(top.node)!));
      if (low.get(top.node)! > disc.get(parent.node)!) bridges.add(top.via);
    }
  }
  return bridges;
}

/** Splits a closed half-edge walk at every repeated node into simple sub-loops. */
function splitLoop(loop: HalfEdge[]): HalfEdge[][] {
  const out: HalfEdge[][] = [];
  const path: HalfEdge[] = [];
  const pos = new Map<Id, number>([[loop[0]!.from, 0]]);
  for (const e of loop) {
    path.push(e);
    const at = pos.get(e.to);
    if (at === undefined) {
      pos.set(e.to, path.length);
      continue;
    }
    const sub = path.splice(at);
    for (const s of sub) if (s.to !== e.to) pos.delete(s.to);
    out.push(sub);
  }
  return out;
}

/**
 * Rooms of the wall graph. Bridges (dangling chains, walls joining otherwise
 * separate parts) are ignored. Each face is split at pinch nodes: its CCW loop
 * is the room outline, its CW loops are holes. A component's outer boundary
 * becomes a hole of the smallest face of another component containing it.
 * Faces with a non-simple outline or a net inner area below MIN_ROOM_AREA
 * (with GEOM_TOL) are dropped. Of coincident walls (same node pair) only the
 * one with the smallest id is used.
 */
export function detectRooms(floor: Floor): DetectedRoom[] {
  // One wall per unordered node pair (smallest id); coincident duplicates are ignored.
  const byPair = new Map<string, Wall>();
  for (const w of Object.values(floor.walls)) {
    if (w.a === w.b || !floor.nodes[w.a] || !floor.nodes[w.b]) continue;
    const key = w.a < w.b ? `${w.a}|${w.b}` : `${w.b}|${w.a}`;
    const kept = byPair.get(key);
    if (!kept || w.id < kept.id) byPair.set(key, w);
  }
  const valid = [...byPair.values()];
  const bridges = findBridges(valid);
  const live = valid.filter((w) => !bridges.has(w.id));

  // Connected components of the remaining graph (union-find over nodes).
  const parent = new Map<Id, Id>();
  const find = (n: Id): Id => {
    let r = n;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(n, r);
    return r;
  };
  for (const w of live) parent.set(find(w.a), find(w.b));

  const outgoing = new Map<Id, HalfEdge[]>();
  const add = (from: Id, to: Id, wall: Id): void => {
    const p = floor.nodes[from] as Vec2;
    const q = floor.nodes[to] as Vec2;
    const list = outgoing.get(from) ?? [];
    list.push({ from, to, wall, angle: Math.atan2(q.y - p.y, q.x - p.x) });
    outgoing.set(from, list);
  };
  for (const w of live) {
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

  const points = (loop: HalfEdge[]): Vec2[] => loop.map((e) => floor.nodes[e.from] as Vec2);
  interface Face {
    outer: HalfEdge[];
    pts: Vec2[];
    area: number;
    component: Id;
    holes: HalfEdge[][];
  }
  const faces: Face[] = [];
  const loose: Array<{ loop: HalfEdge[]; component: Id }> = [];
  const visited = new Set<string>();
  for (const list of outgoing.values()) {
    for (const start of list) {
      if (visited.has(heKey(start.from, start.to, start.wall))) continue;
      const walk: HalfEdge[] = [];
      let cur: HalfEdge | undefined = start;
      while (cur && !visited.has(heKey(cur.from, cur.to, cur.wall))) {
        visited.add(heKey(cur.from, cur.to, cur.wall));
        walk.push(cur);
        cur = next(cur);
      }
      const loops = splitLoop(walk)
        .filter((l) => l.length >= 3)
        .map((loop) => ({ loop, area: signedArea(points(loop)) }))
        .filter((l) => Math.abs(l.area) > EPS);
      const component = find(start.from);
      const outer = loops.filter((l) => l.area > 0).sort((x, y) => y.area - x.area)[0];
      const holes = loops.filter((l) => l.area < 0).map((l) => l.loop);
      if (!outer) {
        // Outer boundary of a component: may be a hole in another component's face.
        for (const loop of holes) loose.push({ loop, component });
        continue;
      }
      const pts = points(outer.loop);
      if (!isSimple(pts)) continue;
      faces.push({ outer: outer.loop, pts, area: outer.area, component, holes });
    }
  }

  for (const { loop, component } of loose) {
    const pts = points(loop);
    let best: Face | undefined;
    for (const f of faces) {
      if (f.component === component || (best && f.area >= best.area)) continue;
      if (polygonContainsPolygon(f.pts, pts)) best = f;
    }
    best?.holes.push(loop);
  }

  const walls = (loop: HalfEdge[]): Id[] => loop.map((e) => e.wall);
  return faces
    .map((f) => ({
      walls: walls(f.outer),
      nodes: f.outer.map((e) => e.from),
      holes: f.holes.map(walls),
    }))
    .filter((r) => !isBelowMinRoomArea(roomArea(floor, { id: '', name: '', ...r }, 'inner')));
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
  return insetPolygon(pts, halfThicknesses(floor, room));
}

function halfThicknesses(floor: Floor, room: Room): number[] {
  return room.walls.map((id) => (floor.walls[id]?.thickness ?? 0) / 2);
}

/**
 * Outer outline and hole outlines of a room. Holes are stored clockwise, so
 * insetting a hole loop by half each wall's thickness outsets it ('inner').
 */
export function roomShape(
  floor: Floor,
  room: Room,
  kind: 'center' | 'inner',
): { outer: Vec2[]; holes: Vec2[][] } {
  const outer = roomPolygon(floor, room, kind);
  const holes = (room.holes ?? []).map((walls) => roomPolygon(floor, { ...room, walls }, kind));
  return { outer, holes };
}

/**
 * Area inside an inset outline. Where a room is narrower than its walls, inset edges reverse
 * and the outline turns inside out, so its signed area can be positive and far larger than the
 * room (without reversed edges it is at most the centre area, except next to parallel edges).
 * Such an area is capped at the floor the walls' inner halves leave uncovered.
 */
function insideArea(center: Vec2[], dists: number[], inner: Vec2[]): number {
  const area = signedArea(inner);
  if (area <= 0) return area;
  const next = (i: number): number => (i + 1) % center.length;
  const reversed = center.some(
    (a, i) => dot(sub(inner[next(i)]!, inner[i]!), sub(center[next(i)]!, a)) < 0,
  );
  if (!reversed && area <= signedArea(center) + EPS) return area;
  const halves = center.map((a, i) => {
    const b = center[next(i)]!;
    const inward = scale(leftNormal(normalize(sub(b, a))), dists[i]!);
    return [a, b, add(b, inward), add(a, inward)];
  });
  return Math.min(area, uncoveredArea(center, halves));
}

/** Outer area minus hole areas (negative for a flipped outline). */
export function roomArea(floor: Floor, room: Room, kind: 'center' | 'inner' = 'inner'): number {
  const { outer, holes } = roomShape(floor, room, kind);
  const area =
    kind === 'center'
      ? signedArea(outer)
      : insideArea(roomPolygon(floor, room, 'center'), halfThicknesses(floor, room), outer);
  return area - holes.reduce((sum, h) => sum + Math.abs(signedArea(h)), 0);
}
