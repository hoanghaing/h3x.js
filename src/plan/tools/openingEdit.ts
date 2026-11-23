import {
  openingClearances,
  openingSpan,
  resolvePlacement,
  type Floor,
  type Hinge,
  type Id,
  type Opening,
  type Placement,
  type Vec2,
} from '../../core';
import { EPS, dot, sub, tidy } from '../../core/geometry/vec';
import { wallFrameOf } from '../openings';

/** How far (screen px) from a wall face the pointer may be to place an opening on it. */
export const OPENING_REACH_PX = 24;
/** How far (screen px) from a snap an opening's centre or jamb may be to take it. */
export const OPENING_SNAP_PX = 8;
/** Grid (m) of an opening's width while a jamb handle is dragged. */
export const OPENING_WIDTH_GRID = 0.05;
/** The narrowest (m) a jamb handle makes an opening. */
export const OPENING_MIN_WIDTH = 0.2;

/** Distance along the opening's wall from node a to `p`; NaN when the wall cannot be read. */
export function alongWall(floor: Readonly<Floor>, o: Opening, p: Vec2): number {
  const frame = wallFrameOf(floor, o);
  return frame ? dot(sub(p, frame.a), frame.dir) : NaN;
}

/**
 * Where a dragged opening goes for the pointer at `p`: `start` is the opening as the drag found
 * it, `grab` the pointer minus its centre along its wall at the press. The placement module
 * chooses the host, snaps and re-hosts (keeping the space it opened into); null when no wall is
 * in reach. `issues` in the placement say why the spot is not valid.
 */
export function openingMoveTarget(
  floor: Readonly<Floor>,
  start: Opening,
  grab: number,
  p: Vec2,
  opts: { pxPerM: number; grid: number; free: boolean; current?: Id },
): { opening: Opening; placement: Placement } | null {
  // Its own wall and offset in the subject are ignored: the placement chooses them.
  const placement = resolvePlacement(floor, {
    subject: { mount: 'opening', opening: start },
    point: p,
    reach: OPENING_REACH_PX / opts.pxPerM,
    snapReach: OPENING_SNAP_PX / opts.pxPerM,
    grid: opts.grid,
    free: opts.free,
    from: { wall: start.wall, grab },
    ...(opts.current !== undefined ? { current: opts.current } : {}),
  });
  if (!placement) return null;
  const { hinge, swing } = placement;
  return {
    opening: { ...start, wall: placement.wall, offset: placement.offset, hinge, swing },
    placement,
  };
}

/**
 * The width a jamb handle gives when the jamb at `end` of `start` is dragged to `x` (along the
 * wall from node a); the other jamb stays. Unless `free`, the jamb takes the end of the clear
 * distance (wall face or the next opening's jamb) within the snap reach, else the width goes to
 * the 5 cm grid. Never below `OPENING_MIN_WIDTH`.
 */
export function openingResizeWidth(
  floor: Readonly<Floor>,
  start: Opening,
  end: Hinge,
  x: number,
  opts: { pxPerM: number; free: boolean },
): number {
  const { lo, hi } = openingSpan(start);
  const fixed = end === 'a' ? hi : lo;
  let width = end === 'a' ? fixed - x : x - fixed;
  if (!opts.free) {
    const face = floor.walls[start.wall] ? openingClearances(floor, start)[end].face : NaN;
    const limit = end === 'a' ? lo - face : hi + face;
    width =
      Math.abs(x - limit) <= OPENING_SNAP_PX / opts.pxPerM
        ? Math.abs(limit - fixed)
        : Math.round(width / OPENING_WIDTH_GRID) * OPENING_WIDTH_GRID;
  }
  return tidy(Math.max(OPENING_MIN_WIDTH, width));
}

/** +1 / -1: the way along the opening's wall an arrow (plan direction) points; 0 across it. */
export function nudgeSign(floor: Readonly<Floor>, o: Opening, arrow: Vec2): number {
  const frame = wallFrameOf(floor, o);
  if (!frame) return 0;
  const d = dot(arrow, frame.dir);
  return Math.abs(d) < EPS ? 0 : Math.sign(d);
}
