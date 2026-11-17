import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { H3xValidationError, type Floor, type Id, type Vec2 } from '../core';
import { roomNodeLoop } from '../core/rooms/detect';
import { insetPolygon, pointInPolygon, signedArea } from '../core/geometry/polygon';
import { toWorld } from './coords';
import { ccw, cutConvex, emitConvex, insideRing, keptPieces, triangulate2D } from './openings';
import { TriangleSink } from './triangulate';

interface Edge {
  from: Id;
  to: Id;
  wall: Id;
}

/**
 * Directed boundary edges of the union of the floor's rooms (outer loops only), wound so
 * the union lies on the left. A wall shared by two rooms is traversed in both directions
 * and drops out.
 */
function boundaryEdges(floor: Floor): Edge[] {
  const byWall = new Map<Id, Edge[]>();
  for (const room of Object.values(floor.rooms)) {
    let loop: Id[];
    try {
      loop = roomNodeLoop(floor, room);
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

const turn = (floor: Floor, a: Edge, b: Edge): number => {
  const p = floor.nodes[a.from]!;
  const q = floor.nodes[a.to]!;
  const r = floor.nodes[b.to]!;
  const d1 = { x: q.x - p.x, y: q.y - p.y };
  const d2 = { x: r.x - q.x, y: r.y - q.y };
  return Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y);
};

/** Chains boundary edges into closed loops, taking the most-left turn at shared nodes. */
function chainLoops(floor: Floor, edges: Edge[]): Edge[][] {
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
 * Floor slab: the outline of the floor's rooms grown to the outer wall faces (each
 * boundary edge offset outward by half its wall's thickness), extruded as a closed prism
 * from `elevation - slabThickness` up to `elevation`. Courtyards enclosed by rooms stay
 * open. Room holes (islands inside a room) are ignored. `openings` (convex plan polygons, e.g.
 * stair bays of the floor below) are cut out, clipped where they cross the outline. Returns
 * null when the floor has no valid room.
 */
export function buildSlabGeometry(floor: Floor, openings: Vec2[][] = []): BufferGeometry | null {
  const rings = chainLoops(floor, boundaryEdges(floor)).map((loop) => {
    const centre = loop.map((e) => floor.nodes[e.from] as Vec2);
    const grown = insetPolygon(
      centre,
      loop.map((e) => -(floor.walls[e.wall]?.thickness ?? 0) / 2),
    );
    return { pts: grown, area: signedArea(centre) };
  });
  const outers = rings.filter((r) => r.area > 0);
  if (outers.length === 0) return null;
  const holes = rings.filter((r) => r.area < 0);
  const cuts = openings.filter((o) => o.length >= 3).map(ccw);

  const top = floor.elevation;
  const bottom = floor.elevation - floor.slabThickness;
  const up = new Vector3(0, 1, 0);
  const down = new Vector3(0, -1, 0);
  const sink = new TriangleSink();

  for (const outer of outers) {
    const own = holes.filter((h) => h.pts[0] && pointInPolygon(h.pts[0], outer.pts));
    const tris = cutConvex(
      triangulate2D(
        outer.pts,
        own.map((h) => h.pts),
      ),
      cuts,
    );
    emitConvex(sink, tris, (p) => toWorld(p, top), up);
    emitConvex(sink, tris, (p) => toWorld(p, bottom), down);
  }
  const ringPts = rings.map((r) => r.pts);
  const inSlab = (p: Vec2): boolean => ringPts.filter((r) => insideRing(p, r)).length % 2 === 1;
  const inCut = (p: Vec2, skip?: Vec2[]): boolean =>
    cuts.some((c) => c !== skip && insideRing(p, c));
  const side = (p: Vec2, q: Vec2, want: Vector3): void =>
    sink.quad(toWorld(p, top), toWorld(q, top), toWorld(q, bottom), toWorld(p, bottom), want);

  for (const pts of ringPts) {
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return;
      // material on the left: outward is the right normal (dy, -dx) in plan -> world (dy, 0, dx)
      const want = new Vector3(dy / len, 0, dx / len);
      for (const [a, b] of keptPieces(p, q, cuts, true, (probe) => !inCut(probe))) {
        side(a, b, want);
      }
    });
  }
  // Opening sides: material lies outside the (counter-clockwise) opening, on the right.
  for (const cut of cuts) {
    const others = [...ringPts, ...cuts.filter((c) => c !== cut)];
    cut.forEach((p, i) => {
      const q = cut[(i + 1) % cut.length]!;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return;
      // facing into the void: the left normal (-dy, dx) in plan -> world (-dy, 0, -dx)
      const want = new Vector3(-dy / len, 0, -dx / len);
      const keep = (probe: Vec2): boolean => inSlab(probe) && !inCut(probe, cut);
      for (const [a, b] of keptPieces(p, q, others, false, keep)) side(a, b, want);
    });
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}
