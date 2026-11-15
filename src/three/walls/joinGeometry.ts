import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { sub } from '../../core/geometry/vec';
import { toWorld } from '../coords';
import { TriangleSink } from '../triangulate';
import type { Junction } from './joins';

/**
 * Trim geometry closing a junction: a +Y top-cap fan from the node through the
 * join points at elevation + junction.height, plus a vertical bevel face (from
 * the floor to the cap) across every square-fallback gap.
 */
export function buildJoinGeometry(junction: Junction, elevation: number): BufferGeometry {
  const sink = new TriangleSink();
  const top = elevation + junction.height;
  const up = new Vector3(0, 1, 0);
  const c = toWorld(junction.node, top);
  const pts = junction.points;
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length];
    if (q) sink.tri(c, toWorld(p, top), toWorld(q, top), up);
  });
  for (const [pi, pj] of junction.bevels) {
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
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}
