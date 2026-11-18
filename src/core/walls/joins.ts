import type { Floor, Id, Vec2 } from '../types';
import { GEOM_TOL, MITER_LIMIT } from '../constants';
import { EPS, cross, distance, leftNormal, normalize, sub } from '../geometry/vec';

/** Wall outline corners in plan space. start = node a, left = left of a→b. */
export interface WallCorners {
  startLeft: Vec2;
  startRight: Vec2;
  endLeft: Vec2;
  endRight: Vec2;
}

/**
 * The area around a node that no wall outline covers (the hole between wall
 * ends at a T or X junction, or the slot of a square fallback at an acute join).
 */
export interface Junction {
  /** The node position (fan centre of the top cap). */
  node: Vec2;
  /** Join points in CCW order around the node, deduplicated within GEOM_TOL. */
  points: Vec2[];
  /** Square-fallback gaps [Pᵢ, Pⱼ] (CCW order) that need a vertical bevel face. */
  bevels: [Vec2, Vec2][];
  /** Tallest incident wall height (the cap sits at elevation + height). */
  height: number;
}

export interface Joins {
  corners: Record<Id, WallCorners>;
  /** Keyed by node id; only nodes with an uncovered area are present. */
  junctions: Record<Id, Junction>;
}

/** A join point farther than MITER_LIMIT × half-thickness from its node falls back to a square end. */
export { MITER_LIMIT };

interface Incident {
  corners: WallCorners;
  atStart: boolean;
  d: Vec2;
  h: number;
  height: number;
}

/** Twice the summed absolute area of the fan (node, pₖ, pₖ₊₁). */
function fanArea2(node: Vec2, pts: Vec2[]): number {
  let s = 0;
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length];
    if (q) s += Math.abs(cross(sub(p, node), sub(q, node)));
  });
  return s;
}

/** Wall corners plus the junction areas left uncovered between wall ends. */
export function computeJoins(floor: Floor): Joins {
  const corners: Record<Id, WallCorners> = {};
  const junctions: Record<Id, Junction> = {};
  const incident: Record<Id, Incident[]> = {};

  for (const w of Object.values(floor.walls)) {
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (!a || !b) continue;
    const d = normalize({ x: b.x - a.x, y: b.y - a.y });
    const h = w.thickness / 2;
    const zero = { x: 0, y: 0 };
    const c: WallCorners = {
      startLeft: zero,
      startRight: zero,
      endLeft: zero,
      endRight: zero,
    };
    corners[w.id] = c;
    (incident[w.a] ??= []).push({ corners: c, atStart: true, d, h, height: w.height });
    (incident[w.b] ??= []).push({
      corners: c,
      atStart: false,
      d: { x: -d.x, y: -d.y },
      h,
      height: w.height,
    });
  }

  const setLeft = (i: Incident, p: Vec2) => {
    i.corners[i.atStart ? 'startLeft' : 'endRight'] = p;
  };
  const setRight = (i: Incident, p: Vec2) => {
    i.corners[i.atStart ? 'startRight' : 'endLeft'] = p;
  };

  for (const [nodeId, list] of Object.entries(incident)) {
    const n = floor.nodes[nodeId];
    const first = list[0];
    if (!n || !first) continue;
    const left = (i: Incident): Vec2 => {
      const ln = leftNormal(i.d);
      return { x: n.x + ln.x * i.h, y: n.y + ln.y * i.h };
    };
    const right = (i: Incident): Vec2 => {
      const ln = leftNormal(i.d);
      return { x: n.x - ln.x * i.h, y: n.y - ln.y * i.h };
    };

    if (list.length === 1) {
      setLeft(first, left(first));
      setRight(first, right(first));
      continue;
    }

    const points: Vec2[] = [];
    const bevels: [Vec2, Vec2][] = [];
    const push = (p: Vec2) => {
      const last = points[points.length - 1];
      if (!last || distance(last, p) > GEOM_TOL) points.push(p);
    };

    const sorted = [...list].sort((p, q) => Math.atan2(p.d.y, p.d.x) - Math.atan2(q.d.y, q.d.x));
    sorted.forEach((wi, idx) => {
      const wj = sorted[(idx + 1) % sorted.length];
      if (!wj) return;
      const p = left(wi);
      const q = right(wj);
      let pi = p;
      let pj = q;
      let mitered = false;
      const den = cross(wi.d, wj.d);
      if (Math.abs(den) >= EPS) {
        const t = cross({ x: q.x - p.x, y: q.y - p.y }, wj.d) / den;
        const m = { x: p.x + wi.d.x * t, y: p.y + wi.d.y * t };
        if (Math.hypot(m.x - n.x, m.y - n.y) <= MITER_LIMIT * Math.max(wi.h, wj.h)) {
          pi = m;
          pj = m;
          mitered = true;
        }
      }
      setLeft(wi, pi);
      setRight(wj, pj);
      push(pi);
      push(pj);
      // A square fallback leaves a slot between the two ends; a collinear
      // continuation (pi == pj) does not.
      if (!mitered && distance(pi, pj) > GEOM_TOL) bevels.push([pi, pj]);
    });

    const head = points[0];
    const tail = points[points.length - 1];
    if (head && tail && points.length > 1 && distance(head, tail) <= GEOM_TOL) points.pop();
    if (points.length < 3 || fanArea2(n, points) / 2 < EPS) continue;
    junctions[nodeId] = {
      node: { x: n.x, y: n.y },
      points,
      bevels,
      height: Math.max(...list.map((i) => i.height)),
    };
  }
  return { corners, junctions };
}

/** Wall outline corners in plan space, keyed by wall id. */
export function computeWallCorners(floor: Floor): Record<Id, WallCorners> {
  return computeJoins(floor).corners;
}
