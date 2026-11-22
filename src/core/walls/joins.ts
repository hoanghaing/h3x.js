import type { Floor, Id, Vec2, Wall } from '../types';
import { GEOM_TOL, MITER_LIMIT } from '../constants';
import { EPS, cross, distance, dot, leftNormal, normalize, sub } from '../geometry/vec';

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
  /** Cap height of the fan triangle (node, points[k], points[k + 1]); lower walls cap their corner lower. */
  heights: number[];
  /** Face height of each entry of `bevels`. */
  bevelHeights: number[];
}

/**
 * A vertical face closing a height step at a wall end: from `from` up to `to` along the plan
 * segment a–b, facing `normal` (a unit plan vector).
 */
export interface Riser {
  a: Vec2;
  b: Vec2;
  from: number;
  to: number;
  normal: Vec2;
}

export interface Joins {
  corners: Record<Id, WallCorners>;
  /** Height steps between a wall end and the cap beside it, keyed by node id. */
  risers: Record<Id, Riser[]>;
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

function sameEdge(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  return (
    (distance(p, a) <= GEOM_TOL && distance(q, b) <= GEOM_TOL) ||
    (distance(p, b) <= GEOM_TOL && distance(q, a) <= GEOM_TOL)
  );
}

/**
 * Cap height per fan edge. An edge that is a wall's end edge takes that wall's height, except a
 * square (butt) end, which meets the through walls and takes their tallest height; a gap edge
 * between two ends takes the taller of the two.
 */
const endOf = (i: Incident): [Vec2, Vec2] => [
  i.corners[i.atStart ? 'startLeft' : 'endRight'],
  i.corners[i.atStart ? 'startRight' : 'endLeft'],
];

/** A square end that stops short of the node (it butts into another wall). */
const isButt = (i: Incident): boolean => {
  const [l, r] = endOf(i);
  return distance(l, r) > GEOM_TOL && Math.abs(dot(sub(r, l), i.d)) <= GEOM_TOL;
};

function edgeHeights(list: Incident[], edges: [Vec2, Vec2][]): number[] {
  const through = list.filter((i) => !isButt(i));
  const throughMax = through.length ? Math.max(...through.map((i) => i.height)) : undefined;
  return edges.map(([p, q]) => {
    const owner = list.find((i) => sameEdge(p, q, ...endOf(i)));
    if (owner) return isButt(owner) && throughMax !== undefined ? throughMax : owner.height;
    const touching = list.filter((i) =>
      endOf(i).some((c) => distance(c, p) <= GEOM_TOL || distance(c, q) <= GEOM_TOL),
    );
    return Math.max(...(touching.length ? touching : list).map((i) => i.height));
  });
}

/** Faces closing the step between each wall end and the cap beside it (a mitre partner or the fill). */
function endRisers(list: Incident[], fan: { edge: [Vec2, Vec2]; height: number }[]): Riser[] {
  const out: Riser[] = [];
  for (const i of list) {
    const [l, r] = endOf(i);
    if (distance(l, r) <= GEOM_TOL) continue;
    const e = normalize(sub(r, l));
    let normal = { x: -e.y, y: e.x };
    if (dot(normal, i.d) > 0) normal = { x: -normal.x, y: -normal.y };
    const partners = list.filter((j) => j !== i && sameEdge(l, r, ...endOf(j)));
    if (partners.length) {
      const c = Math.max(...partners.map((j) => j.height));
      if (i.height > c + GEOM_TOL) out.push({ a: l, b: r, from: c, to: i.height, normal });
      continue;
    }
    const f = fan.find((x) => sameEdge(l, r, ...x.edge));
    if (!f) continue;
    if (i.height > f.height + GEOM_TOL) {
      out.push({ a: l, b: r, from: f.height, to: i.height, normal });
    } else if (f.height > i.height + GEOM_TOL) {
      out.push({
        a: l,
        b: r,
        from: i.height,
        to: f.height,
        normal: { x: -normal.x, y: -normal.y },
      });
    }
  }
  return out;
}

/** Wall corners plus the junction areas left uncovered between wall ends. */
export function computeJoins(floor: Floor): Joins {
  const corners: Record<Id, WallCorners> = {};
  const junctions: Record<Id, Junction> = {};
  const risers: Record<Id, Riser[]> = {};
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
    const hole = points.length >= 3 && fanArea2(n, points) / 2 >= EPS;
    const heights = hole
      ? edgeHeights(
          list,
          points.map((p, k): [Vec2, Vec2] => [p, points[(k + 1) % points.length]!]),
        )
      : [];
    const fan = heights.map((height, k) => ({
      edge: [points[k]!, points[(k + 1) % points.length]!] as [Vec2, Vec2],
      height,
    }));
    const steps = endRisers(list, fan);
    if (steps.length) risers[nodeId] = steps;
    if (!hole) continue;
    junctions[nodeId] = {
      node: { x: n.x, y: n.y },
      points,
      bevels,
      height: Math.max(...list.map((i) => i.height)),
      heights,
      bevelHeights: edgeHeights(list, bevels),
    };
  }
  return { corners, junctions, risers };
}

/** One wall's corners: they depend only on the walls meeting at its two nodes. */
export function cornersOfWall(floor: Readonly<Floor>, wall: Wall): WallCorners {
  const ends = [wall.a, wall.b];
  const walls: Floor['walls'] = {};
  for (const [id, w] of Object.entries(floor.walls)) {
    if (ends.includes(w.a) || ends.includes(w.b)) walls[id] = w;
  }
  return computeJoins({ ...floor, walls }).corners[wall.id]!;
}

/** Wall outline corners in plan space, keyed by wall id. */
export function computeWallCorners(floor: Floor): Record<Id, WallCorners> {
  return computeJoins(floor).corners;
}
