import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { Floor, Vec2 } from '../core';
import { floorOutline } from '../core/floors/outline';
import { pointInPolygon } from '../core/geometry/polygon';
import { toWorld } from './coords';
import { ccw, cutConvex, emitConvex, insideRing, keptPieces, triangulate2D } from './openings';
import { TriangleSink } from './triangulate';

/**
 * Floor slab: the outline of the floor's rooms grown to the outer wall faces (each
 * boundary edge offset outward by half its wall's thickness), extruded as a closed prism
 * from `elevation - slabThickness` up to `elevation`. Courtyards enclosed by rooms stay
 * open. Room holes (islands inside a room) are ignored. `openings` (convex plan polygons, e.g.
 * stair bays of the floor below) are cut out, clipped where they cross the outline. Returns
 * null when the floor has no valid room.
 */
export function buildSlabGeometry(floor: Floor, openings: Vec2[][] = []): BufferGeometry | null {
  const rings = floorOutline(floor).map((r) => ({ pts: r.points, hole: r.hole }));
  const outers = rings.filter((r) => !r.hole);
  if (outers.length === 0) return null;
  const holes = rings.filter((r) => r.hole);
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
