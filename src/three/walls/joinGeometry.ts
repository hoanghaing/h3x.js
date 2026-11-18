import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { sub } from '../../core/geometry/vec';
import { toWorld } from '../coords';
import { TriangleSink } from '../triangulate';
import type { Junction } from './joins';

/**
 * Trim geometry closing a junction: a +Y top-cap fan from the node through the
 * join points, each triangle at the height of the wall it belongs to (at most junction.height), plus a vertical bevel face (from
 * the floor to the cap) across every square-fallback gap.
 */
export function buildJoinGeometry(junction: Junction, elevation: number): BufferGeometry {
  const sink = new TriangleSink();
  const up = new Vector3(0, 1, 0);
  const pts = junction.points;
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length];
    const t = elevation + (junction.heights[k] ?? junction.height);
    if (q) sink.tri(toWorld(junction.node, t), toWorld(p, t), toWorld(q, t), up);
  });
  junction.bevels.forEach(([pi, pj], k) => {
    const top = elevation + (junction.bevelHeights[k] ?? junction.height);
    // Points run CCW around the node, so the outward side is right of pi → pj.
    const e = sub(pj, pi);
    const out = new Vector3(e.y, 0, e.x).normalize(); // plan (e.y, -e.x) → world (x, 0, -y)
    sink.quad(
      toWorld(pi, elevation),
      toWorld(pj, elevation),
      toWorld(pj, top),
      toWorld(pi, top),
      out,
    );
  });
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}
