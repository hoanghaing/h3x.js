import { notFound } from '../commands/shared';
import { EPS, add, distance, dot, leftNormal, normalize, scale, sub, tidy } from '../geometry/vec';
import { openingSpan, wallOutline } from '../shapes';
import type { Floor, Hinge, Opening, Vec2, Wall } from '../types';
import { cornersOfWalls } from '../walls/joins';

/** Where the clear length of a wall stops at one end. */
export interface WallFaceLimit {
  /** Distance from node a along the wall. */
  x: number;
  /** The face that stops there: 1 = left, -1 = right. */
  side: 1 | -1;
}

/** Where a closed outline in wall coordinates crosses or touches the line `y = v`, along it. */
function crossingsAt(ring: Vec2[], v: number): number[] {
  return ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    const dp = p.y - v;
    const dq = q.y - v;
    if (Math.abs(dp) < EPS) return [p.x];
    if (Math.abs(dq) < EPS || dp * dq > 0) return [];
    return [p.x + ((q.x - p.x) * dp) / (dp - dq)];
  });
}

/**
 * The clear length of a wall, per end: along each face, up to the first drawn outline there, of
 * a wall meeting it or its own end (the node at a free end); the face that stops sooner counts.
 * A meeting wall can reach further in than the wall's own corners, as it does past the miter
 * limit, so those alone do not give this.
 */
export function wallFaceLimits(floor: Readonly<Floor>, wall: Wall): Record<Hinge, WallFaceLimit> {
  const a = floor.nodes[wall.a]!;
  const dir = normalize(sub(floor.nodes[wall.b]!, a));
  const left = leftNormal(dir);
  const local = (p: Vec2): Vec2 => ({ x: dot(sub(p, a), dir), y: dot(sub(p, a), left) });
  const ends = [wall.a, wall.b];
  const meeting = Object.values(floor.walls).filter(
    (w) => w.id !== wall.id && (ends.includes(w.a) || ends.includes(w.b)),
  );
  const corners = cornersOfWalls(floor, [wall, ...meeting]);
  const own = corners[0]!;
  const outlines = meeting.map((w, i) => ({ w, ring: wallOutline(corners[i + 1]!).map(local) }));

  const limitAt = (end: Hinge): WallFaceLimit => {
    const node = wall[end];
    const rings = outlines.filter(({ w }) => w.a === node || w.b === node).map(({ ring }) => ring);
    const stop = (side: 1 | -1, corner: Vec2): WallFaceLimit => {
      const v = (side * wall.thickness) / 2;
      const xs = [local(corner).x, ...rings.flatMap((ring) => crossingsAt(ring, v))];
      return { x: end === 'a' ? Math.max(...xs) : Math.min(...xs), side };
    };
    const onLeft = stop(1, end === 'a' ? own.startLeft : own.endLeft);
    const onRight = stop(-1, end === 'a' ? own.startRight : own.endRight);
    const inward = end === 'a' ? 1 : -1;
    // A tie goes to the left face, whatever the rounding.
    return inward * (onRight.x - onLeft.x) > EPS ? onRight : onLeft;
  };

  return { a: limitAt('a'), b: limitAt('b') };
}

/**
 * The room beside each jamb of `o`. `face`: the clear distance to the nearer jamb of the next
 * opening, or to where the wall's clear length stops; negative when `o` reaches past it. `axis`:
 * to the wall's end node, whatever stands between. `jamb` and `until` are the ends of the `face`
 * distance, on the face of the wall that stops sooner. Throws `not-found` without the wall.
 */
export function openingClearances(
  floor: Readonly<Floor>,
  o: Opening,
): Record<Hinge, { face: number; axis: number; jamb: Vec2; until: Vec2 }> {
  const wall = floor.walls[o.wall];
  if (!wall) throw notFound('Wall', o.wall);
  const a = floor.nodes[wall.a]!;
  const b = floor.nodes[wall.b]!;
  const dir = normalize(sub(b, a));
  const left = leftNormal(dir);
  const point = (x: number, v: number): Vec2 => add(add(a, scale(dir, x)), scale(left, v));
  const { lo, hi } = openingSpan(o);
  const others = Object.values(floor.openings).filter((p) => p.id !== o.id && p.wall === o.wall);
  const before = others.filter((p) => p.offset < o.offset).map((p) => openingSpan(p).hi);
  const after = others.filter((p) => p.offset > o.offset).map((p) => openingSpan(p).lo);
  const limits = wallFaceLimits(floor, wall);
  const from = Math.max(limits.a.x, ...before);
  const to = Math.min(limits.b.x, ...after);
  const va = (limits.a.side * wall.thickness) / 2;
  const vb = (limits.b.side * wall.thickness) / 2;
  return {
    a: { face: tidy(lo - from), axis: tidy(lo), jamb: point(lo, va), until: point(from, va) },
    b: {
      face: tidy(to - hi),
      axis: tidy(distance(a, b) - hi),
      jamb: point(hi, vb),
      until: point(to, vb),
    },
  };
}
