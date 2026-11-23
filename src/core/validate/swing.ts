import { GEOM_TOL } from '../constants';
import { polygonOverlapArea } from '../geometry/clip';
import { add, leftNormal, scale, sub } from '../geometry/vec';
import { openingGeometry, pieceOutline, type OpeningGeometry } from '../openings/geometry';
import { validateOpeningParams } from '../openings/params';
import { columnPolygon, spanOverlap, wallOutlines } from '../shapes';
import { stairOutline } from '../stairs/layout';
import type { Floor, Id, Issue, Opening, Vec2 } from '../types';
import { stairRise } from './stairs';

/** Issue codes that warn without blocking anything: an editor shows them apart from errors. */
export const WARNING_CODES: ReadonlySet<string> = new Set(['opening-swing-blocked']);

/** Whether `issue` is a warning (`WARNING_CODES`) rather than a problem that blocks or must be fixed. */
export function isWarningIssue(issue: Pick<Issue, 'code'>): boolean {
  return WARNING_CODES.has(issue.code);
}

/** Area (m²) shared by a swept area and what stands there at or below which they only touch. */
const SWING_OVERLAP_AREA = 1e-4;
/** How far to each side a leaf drawn as a line is probed. */
const LINE_PROBE = 0.02;

/** A polygon with its bounds, to skip what is nowhere near. */
interface Shape {
  points: Vec2[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function shapeOf(points: Vec2[]): Shape {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { points, minX, minY, maxX, maxY };
}

function meets(sweep: Shape, other: Shape): boolean {
  if (other.minX >= sweep.maxX || sweep.minX >= other.maxX) return false;
  if (other.minY >= sweep.maxY || sweep.minY >= other.maxY) return false;
  return polygonOverlapArea(other.points, sweep.points) > SWING_OVERLAP_AREA;
}

/**
 * The leaves of an opening, each as shapes that all have to be met: the area it moves over, else
 * the leaf as drawn. One drawn as a line gives both its sides, so running along the edge of a
 * swept area is only touching it.
 */
function leafShapes(g: OpeningGeometry): Shape[][] {
  if (g.sweeps.length > 0) return g.sweeps.map((s) => [shapeOf(s.points)]);
  return g.plan.flatMap((piece) => {
    if (piece.role !== 'leaf') return [];
    if (piece.depth > 0) return [[shapeOf(pieceOutline(piece))]];
    const { a, b } = piece;
    const beside = (by: number): Shape => {
      const n = scale(leftNormal(sub(b, a)), by);
      return shapeOf([a, b, add(b, n), add(a, n)]);
    };
    return [[beside(LINE_PROBE), beside(-LINE_PROBE)]];
  });
}

/**
 * `opening-swing-blocked` for each wall, column, stair and leaf of another opening at the same
 * height in an area that moving leaves need; `ids` is the opening, then the blocker. The host
 * wall and the opening itself never block, and touching is fine. `above` gives stairs their rise
 * (without it: their bay). These only warn.
 */
export function validateSwings(floor: Floor, above: Floor | undefined): Issue[] {
  const openings: Array<{ o: Opening; g: OpeningGeometry }> = [];
  for (const o of Object.values(floor.openings)) {
    // A leaf count out of range cannot be laid out; invalid-opening reports it.
    if (validateOpeningParams(o).length > 0) continue;
    const g = openingGeometry(floor, o);
    if (g) openings.push({ o, g });
  }
  if (!openings.some(({ g }) => g.sweeps.length > 0)) return [];

  const rise = stairRise(floor, above);
  const standing: Array<{ id: Id; shape: Shape }> = [
    ...Object.entries(wallOutlines(floor)).map(([id, ring]) => ({ id, shape: shapeOf(ring) })),
    ...Object.values(floor.columns).map((c) => ({ id: c.id, shape: shapeOf(columnPolygon(c)) })),
    ...Object.values(floor.stairs).map((s) => ({
      id: s.id,
      shape: shapeOf(stairOutline(s, rise)),
    })),
  ];
  const leaves = openings.map(({ o, g }) => ({
    id: o.id,
    height: { lo: g.z0, hi: g.z1 },
    shapes: leafShapes(g),
  }));

  const out: Issue[] = [];
  for (const { o, g } of openings) {
    if (g.sweeps.length === 0) continue;
    const sweeps = g.sweeps.map((s) => shapeOf(s.points));
    const report = (blocker: Id): void => {
      out.push({
        code: 'opening-swing-blocked',
        ids: [o.id, blocker],
        message: `The leaves of opening ${o.id} cannot move clear of ${blocker}`,
      });
    };
    for (const { id, shape } of standing) {
      if (id !== o.wall && sweeps.some((sweep) => meets(sweep, shape))) report(id);
    }
    for (const { id, height, shapes } of leaves) {
      if (id === o.id || spanOverlap({ lo: g.z0, hi: g.z1 }, height) <= GEOM_TOL) continue;
      if (sweeps.some((sweep) => shapes.some((leaf) => leaf.every((s) => meets(sweep, s))))) {
        report(id);
      }
    }
  }
  return out;
}
