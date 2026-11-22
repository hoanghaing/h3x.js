import { notFound } from '../commands/shared';
import { EPS, add, distance, dot, leftNormal, normalize, scale, sub, tidy } from '../geometry/vec';
import { openingSpan, wallOutline } from '../shapes';
import type { Floor, Hinge, Opening, Vec2, Wall } from '../types';
import { cornersOfWalls } from '../walls/joins';

/** Where the clear length of a wall stops at one end. */
export interface WallFaceLimit {
  /** Distance from node a along the wall. */
  x: number;
  /** Where that is across the wall: from the centre line, positive to the left. */
  v: number;
}

/** Where a closed outline in wall coordinates crosses or touches the line `y = v`. */
function crossingsAt(ring: Vec2[], v: number): Vec2[] {
  return ring.flatMap((p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    const dp = p.y - v;
    const dq = q.y - v;
    if (Math.abs(dp) < EPS) return [{ x: p.x, y: v }];
    if (Math.abs(dq) < EPS || dp * dq > 0) return [];
    return [{ x: p.x + ((q.x - p.x) * dp) / (dp - dq), y: v }];
  });
}

/**
 * The clear length of a wall, per end: it stops at the farthest that the wall's own end (the node
 * at a free end) or the drawn outline of a wall meeting it there reaches into the band between
 * the two faces, so nothing of a meeting wall is inside the clear length. That can be further in
 * than the wall's own corners, as it is past the miter limit, or between the faces.
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

  const h = wall.thickness / 2;
  const limitAt = (end: Hinge): WallFaceLimit => {
    const node = wall[end];
    const rings = outlines.filter(({ w }) => w.a === node || w.b === node).map(({ ring }) => ring);
    const onFace = (v: number, corner: Vec2): Vec2[] => [
      { x: local(corner).x, y: v },
      ...rings.flatMap((ring) => crossingsAt(ring, v)),
    ];
    // The part of an outline in the band reaches farthest where it crosses a face or at a vertex.
    const reached = [
      ...onFace(h, end === 'a' ? own.startLeft : own.endLeft),
      ...onFace(-h, end === 'a' ? own.startRight : own.endRight),
      ...rings.flat().filter((p) => Math.abs(p.y) < h),
    ];
    const inward = end === 'a' ? 1 : -1;
    // A tie stays on a face, the left one first, whatever the rounding.
    const stop = reached.reduce((best, p) => (inward * (p.x - best.x) > EPS ? p : best));
    return { x: stop.x, v: stop.y };
  };

  return { a: limitAt('a'), b: limitAt('b') };
}

/**
 * The room beside each jamb of `o`. `face`: the clear distance to the nearer jamb of the next
 * opening, or to where the wall's clear length stops; negative when `o` reaches past it. `axis`:
 * to the wall's end node, whatever stands between. `jamb` and `until` are the ends of the `face`
 * distance, level with what stops the clear length: on a face, or between them where a corner of
 * a meeting wall does. Throws `not-found` without the wall.
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
  const va = limits.a.v;
  const vb = limits.b.v;
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
