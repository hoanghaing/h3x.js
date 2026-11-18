import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { sub } from '../../core/geometry/vec';
import { toWorld } from '../coords';
import { TriangleSink } from '../triangulate';
import type { Junction, Riser } from './joins';

/**
 * Trim geometry closing a junction: a +Y top-cap fan from the node through the
 * join points, each triangle at the height of the wall it belongs to (at most
 * junction.height), vertical faces across square-fallback gaps and between fan
 * pieces of different heights, plus the risers closing a wall end that stands
 * taller (or shorter) than the cap beside it.
 */
export function buildJoinGeometry(
  junction: Junction | undefined,
  elevation: number,
  risers: Riser[] = [],
): BufferGeometry {
  const sink = new TriangleSink();
  const up = new Vector3(0, 1, 0);
  if (junction) {
    const pts = junction.points;
    const heightAt = (k: number): number => junction.heights[k] ?? junction.height;
    pts.forEach((p, k) => {
      const q = pts[(k + 1) % pts.length];
      const t = elevation + heightAt(k);
      if (q) sink.tri(toWorld(junction.node, t), toWorld(p, t), toWorld(q, t), up);
    });
    // The seam node → pₖ between fan pieces k - 1 and k, when their caps differ.
    pts.forEach((p, k) => {
      const prev = heightAt((k + pts.length - 1) % pts.length);
      const next = heightAt(k);
      if (Math.abs(prev - next) < 1e-9) return;
      const e = sub(p, junction.node);
      // Piece k lies CCW of the seam (left of node → p); face the lower piece.
      const left = new Vector3(-e.y, 0, -e.x).normalize(); // plan (-e.y, e.x) → world (x, 0, -y)
      const toward = next < prev ? left : left.clone().negate();
      sink.quad(
        toWorld(junction.node, elevation + Math.min(prev, next)),
        toWorld(p, elevation + Math.min(prev, next)),
        toWorld(p, elevation + Math.max(prev, next)),
        toWorld(junction.node, elevation + Math.max(prev, next)),
        toward,
      );
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
  }
  for (const r of risers) {
    sink.quad(
      toWorld(r.a, elevation + r.from),
      toWorld(r.b, elevation + r.from),
      toWorld(r.b, elevation + r.to),
      toWorld(r.a, elevation + r.to),
      new Vector3(r.normal.x, 0, -r.normal.y),
    );
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}
