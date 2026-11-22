import { GEOM_TOL } from '../constants';
import { pointInPolygon } from '../geometry/polygon';
import { closestPointOnSegment } from '../geometry/segment';
import { add, distance, dot, leftNormal, normalize, scale, sub, tidy } from '../geometry/vec';
import { openingSpan } from '../shapes';
import type { Floor, Hinge, Opening, Vec2 } from '../types';
import { cornersOfWall, type WallCorners } from '../walls/joins';
import { openingLeaves, openingParams } from './params';
import { closedPose, planPose, sweptAreas, type LocalOpening } from './poses';

/*
 * One geometry per opening: the plan draws, highlights and hit-tests it, and the wall is cut by
 * it. What it looks like (strokes, materials) is up to each view.
 */

/** A part of an opening: the plan segment a–b, `depth` thick, between two heights. */
export interface OpeningPiece {
  role: 'frame' | 'leaf' | 'glass' | 'track' | 'face' | 'shutter' | 'box';
  a: Vec2;
  b: Vec2;
  /** Thickness across a–b; 0 for what is only a line in the plan. */
  depth: number;
  /** Heights above the floor. */
  z0: number;
  z1: number;
}

/** Clearance moving leaves need, as a counter-clockwise polygon. */
export interface SweepArea {
  points: Vec2[];
  /** The exact curve of a swing leaf; `ccw` is its direction from `from` to `to`. */
  arc?: { center: Vec2; r: number; from: Vec2; to: Vec2; ccw: boolean };
}

export interface OpeningGeometry {
  /** The cut in plan: the left face from the a end to the b end, then the right face back. */
  cut: [Vec2, Vec2, Vec2, Vec2];
  /** Heights of the cut above the floor. */
  z0: number;
  z1: number;
  /** The drafting pose: leaves open, folded or on their tracks. */
  plan: OpeningPiece[];
  /** The shut pose: inside the cut, except the box of a rolling door. */
  closed: OpeningPiece[];
  sweeps: SweepArea[];
}

/**
 * The cut of `o` as distances along its wall from node a (x) and heights above the floor (z),
 * clamped to what both faces and the wall height leave. It is empty when x1 = x0 or z1 = z0.
 */
export function openingCut(
  o: Pick<Opening, 'offset' | 'width' | 'height' | 'sill'>,
  a: Vec2,
  dir: Vec2,
  wallHeight: number,
  corners: WallCorners,
): { x0: number; x1: number; z0: number; z1: number } {
  const x = (p: Vec2): number => dot(sub(p, a), dir);
  const min = Math.max(x(corners.startLeft), x(corners.startRight)) + GEOM_TOL;
  const max = Math.min(x(corners.endLeft), x(corners.endRight)) - GEOM_TOL;
  const { lo, hi } = openingSpan(o);
  const x0 = Math.min(Math.max(lo, min), max);
  const x1 = Math.max(x0, Math.min(hi, max));
  const top = wallHeight - GEOM_TOL;
  const z0 = o.sill <= GEOM_TOL ? 0 : Math.min(o.sill, top);
  const z1 = Math.max(z0, Math.min(o.sill + o.height, top));
  return { x0, x1, z0, z1 };
}

/**
 * The shape of an opening: cut, pieces in both poses and swept areas. Parameters that do not
 * apply to its type (`openingParams`) change nothing. Null when its wall is missing.
 */
export function openingGeometry(floor: Readonly<Floor>, o: Opening): OpeningGeometry | null {
  const wall = floor.walls[o.wall];
  const a = wall && floor.nodes[wall.a];
  const b = wall && floor.nodes[wall.b];
  if (!wall || !a || !b) return null;

  const dir = normalize(sub(b, a));
  const left = leftNormal(dir);
  const { x0, x1, z0, z1 } = openingCut(o, a, dir, wall.height, cornersOfWall(floor, wall));
  const point = (x: number, v: number): Vec2 => add(add(a, scale(dir, x)), scale(left, v));

  const params = openingParams(o);
  const side = params.includes('swing') && o.swing === 'right' ? -1 : 1;
  // With no hinge to read, the swing side picks the jamb to lay out from, so that a reversed
  // wall (both parameters mirrored) gives the same shape.
  const start: Hinge = params.includes('hinge') ? o.hinge : side === 1 ? 'a' : 'b';
  const [near, far] = start === 'a' ? [x0, x1] : [x1, x0];
  const toFar = start === 'a' ? 1 : -1;
  const w = tidy(x1 - x0);
  const local: LocalOpening = {
    type: o.type,
    leaves: params.includes('leaves') ? openingLeaves(o) : 1,
    split: params.includes('split') ? (o.split ?? 0.5) : 0.5,
    w,
    t: wall.thickness,
    z0,
    z1,
    // The far jamb is taken as it is, not added up, so pieces end exactly on the cut.
    at: (e, v) => point(e === w ? far : near + toFar * e, side * v),
  };

  const h = wall.thickness / 2;
  return {
    cut: [point(x0, h), point(x1, h), point(x1, -h), point(x0, -h)],
    z0,
    z1,
    plan: planPose(local),
    closed: closedPose(local),
    sweeps: sweptAreas(local),
  };
}

/** The plan rectangle of a piece: its segment, `depth` thick. */
export function pieceOutline(piece: OpeningPiece): Vec2[] {
  const { a, b } = piece;
  const half = scale(leftNormal(sub(b, a)), piece.depth / 2);
  return [add(a, half), add(b, half), sub(b, half), sub(a, half)];
}

/**
 * Whether `p` picks the opening: in its cut, on a leaf as drawn in the plan, or within `reach`
 * of such a leaf's lines. Swept areas and the box of a rolling door are never picked.
 */
export function openingHit(g: OpeningGeometry, p: Vec2, reach: number): boolean {
  if (pointInPolygon(p, g.cut)) return true;
  const nearLine = (a: Vec2, b: Vec2): boolean =>
    distance(p, closestPointOnSegment(p, a, b).point) <= reach;
  return g.plan.some((piece) => {
    if (piece.role !== 'leaf') return false;
    if (piece.depth === 0) return nearLine(piece.a, piece.b);
    const ring = pieceOutline(piece);
    return (
      pointInPolygon(p, ring) || ring.some((q, i) => nearLine(q, ring[(i + 1) % ring.length]!))
    );
  });
}
