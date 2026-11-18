import { MITER_LIMIT } from '../constants';
import { H3xValidationError } from '../errors';
import { growPolygon, signedArea } from '../geometry/polygon';
import { roomNodeLoop } from '../rooms/detect';
import type { Floor, Id, Vec2 } from '../types';

export interface OutlineRing {
  /** Grown to the outer wall faces (growPolygon, MITER_LIMIT). CCW for outers, CW for holes. */
  points: Vec2[];
  /** Wall id of each edge of `points` (bevel edges repeat the previous wall). */
  walls: Id[];
  /** Centre-line ring (node positions) before growing. */
  centre: Vec2[];
  hole: boolean;
}

interface Edge {
  from: Id;
  to: Id;
  wall: Id;
}

/**
 * Directed boundary edges of the union of the given rooms (outer loops only), wound so
 * the union lies on the left. A wall shared by two rooms is traversed in both directions
 * and drops out.
 */
function boundaryEdges(floor: Readonly<Floor>, roomIds?: readonly Id[]): Edge[] {
  const byWall = new Map<Id, Edge[]>();
  const rooms = roomIds
    ? [...new Set(roomIds)].flatMap((id) => {
        const r = floor.rooms[id];
        return r ? [r] : [];
      })
    : Object.values(floor.rooms);
  for (const room of rooms) {
    let loop: Id[];
    try {
      loop = roomNodeLoop(floor as Floor, room);
    } catch (e) {
      if (e instanceof H3xValidationError) continue;
      throw e;
    }
    const pts = loop.map((id) => floor.nodes[id] as Vec2);
    if (signedArea(pts) <= 0) continue; // flipped / degenerate: same rule as room floors
    room.walls.forEach((wall, i) => {
      const edge = { from: loop[i]!, to: loop[(i + 1) % loop.length]!, wall };
      byWall.set(wall, [...(byWall.get(wall) ?? []), edge]);
    });
  }
  return [...byWall.values()].filter((list) => list.length === 1).map((list) => list[0]!);
}

const turn = (floor: Readonly<Floor>, a: Edge, b: Edge): number => {
  const p = floor.nodes[a.from]!;
  const q = floor.nodes[a.to]!;
  const r = floor.nodes[b.to]!;
  const d1 = { x: q.x - p.x, y: q.y - p.y };
  const d2 = { x: r.x - q.x, y: r.y - q.y };
  return Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y);
};

/** Chains boundary edges into closed loops, taking the most-left turn at shared nodes. */
function chainLoops(floor: Readonly<Floor>, edges: Edge[]): Edge[][] {
  const out = new Map<Id, Edge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const used = new Set<Edge>();
  const loops: Edge[][] = [];
  for (const start of edges) {
    if (used.has(start)) continue;
    const loop: Edge[] = [];
    let cur: Edge | undefined = start;
    while (cur && !used.has(cur)) {
      used.add(cur);
      loop.push(cur);
      const prev: Edge = cur;
      const next: Edge[] = (out.get(cur.to) ?? []).filter((e) => !used.has(e) || e === start);
      cur = next.sort((x, y) => turn(floor, prev, y) - turn(floor, prev, x))[0];
    }
    if (cur === start && loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Outline of the union of a floor's rooms (all rooms, or only `roomIds`; unknown ids are
 * ignored), each boundary edge offset outward by half its wall's thickness. Courtyards
 * enclosed by the chosen rooms come back as hole rings. Room holes (islands inside a room)
 * are ignored.
 */
export function floorOutline(floor: Readonly<Floor>, roomIds?: readonly Id[]): OutlineRing[] {
  return chainLoops(floor, boundaryEdges(floor, roomIds)).map((loop) => {
    const centre = loop.map((e) => floor.nodes[e.from] as Vec2);
    const { points, source } = growPolygon(
      centre,
      loop.map((e) => (floor.walls[e.wall]?.thickness ?? 0) / 2),
      MITER_LIMIT,
    );
    return {
      points,
      walls: source.map((k) => loop[k]!.wall),
      centre,
      hole: signedArea(centre) < 0,
    };
  });
}
