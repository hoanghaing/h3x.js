import { floorOutline, type OutlineRing } from '../floors/outline';
import { pointInPolygon } from '../geometry/polygon';
import type { Floor, Id, Roof, RoofEdge } from '../types';

/** The edge spec of an edge without one of its own. */
export const defaultEdge = (r: Roof): RoofEdge => ({ kind: 'slope', pitch: r.pitch });

/**
 * A follow roof as independent roofs with the shape it has on `floor`: one per outer ring (the
 * first keeps the id, `newId(k)` names the k-th other), each with the holes inside it and the
 * per-wall edge specs as per-edge ones. [] when the roof has no outline.
 */
export function detachedRoofs(
  roof: Roof,
  floor: Readonly<Floor>,
  newId: (k: number) => Id,
): Roof[] {
  const rings = floorOutline(floor, roof.rooms ?? []);
  const holes = rings.filter((x) => x.hole);
  const edgesOf = (ring: OutlineRing): RoofEdge[] =>
    ring.walls.map((w) => structuredClone(roof.wallEdges?.[w] ?? defaultEdge(roof)));
  return rings
    .filter((x) => !x.hole)
    .map((outer, i) => {
      const out: Roof = {
        ...structuredClone(roof),
        id: i === 0 ? roof.id : newId(i - 1),
        follow: false,
      };
      delete out.rooms;
      delete out.wallEdges;
      const mine = holes.filter((h) => pointInPolygon(h.points[0]!, outer.points));
      out.points = structuredClone(outer.points);
      out.edges = edgesOf(outer);
      if (mine.length > 0) {
        out.holes = mine.map((h) => structuredClone(h.points));
        out.holeEdges = mine.map(edgesOf);
      }
      return out;
    });
}
