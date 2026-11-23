import {
  openingClearances,
  openingGeometry,
  openingSpan,
  pieceOutline,
  type Floor,
  type Hinge,
  type Opening,
  type OpeningGeometry,
  type Vec2,
} from '../core';
import { EPS, add, distance, dot, leftNormal, normalize, scale, sub } from '../core/geometry/vec';
import { NON_SCALING, pointsAttr, setAttr, svgEl } from './svg';

/**
 * The default symbol of an opening, in plan space: the gap polygon's points, a path of solid
 * strokes and a path of dashed ones (swing arcs, and the box above a rolling door). It only
 * chooses strokes: every coordinate comes from the geometry.
 */
export function paintOpening(g: OpeningGeometry): { gap: string; lines: string; arcs: string } {
  let lines = '';
  let arcs = '';
  for (const piece of g.plan) {
    const rect = piece.depth > 0;
    const points = rect ? pieceOutline(piece) : [piece.a, piece.b];
    const d = `M${points.map((p) => `${p.x},${p.y}`).join('L')}${rect ? 'Z' : ''}`;
    if (piece.role === 'box') arcs += d;
    else lines += d;
  }
  for (const { arc } of g.sweeps) {
    if (!arc) continue;
    const { from, to, r, ccw } = arc;
    arcs += `M${from.x},${from.y}A${r},${r} 0 0 ${ccw ? 1 : 0} ${to.x},${to.y}`;
  }
  return { gap: pointsAttr(g.cut), lines, arcs };
}

/** Appends the (empty) gap, arc and line elements of an opening symbol to `g`. */
export function createOpeningSymbol(g: SVGGElement, prefix: string): void {
  g.append(
    svgEl('polygon', { class: `${prefix}-opening-gap`, ...NON_SCALING }),
    svgEl('path', { class: `${prefix}-opening-arc`, ...NON_SCALING }),
    svgEl('path', { class: `${prefix}-opening-lines`, ...NON_SCALING }),
  );
}

/**
 * Fills the elements `createOpeningSymbol` made with the symbol of `geometry`; null empties them.
 * A `stray` outline (see `strayOutline`) is drawn instead, as a closed box.
 */
export function drawOpeningSymbol(
  g: SVGGElement,
  geometry: OpeningGeometry | null,
  stray: readonly Vec2[] | null = null,
): void {
  const symbol = stray
    ? {
        gap: pointsAttr(stray),
        arcs: '',
        lines: `M${stray.map((p) => `${p.x},${p.y}`).join('L')}Z`,
      }
    : geometry && paintOpening(geometry);
  const [gap, arcs, lines] = Array.from(g.children);
  setAttr(gap!, 'points', symbol?.gap ?? '');
  setAttr(arcs!, 'd', symbol?.arcs ?? '');
  setAttr(lines!, 'd', symbol?.lines ?? '');
}

/** What an opening draws and is picked on: its geometry, and the stand-in box of a stray one. */
export interface OpeningShape {
  geometry: OpeningGeometry | null;
  stray: Vec2[] | null;
}

/** The geometry of `o` and, when its cut is empty, its stray box (see `strayOutline`). */
export function openingShape(floor: Readonly<Floor>, o: Opening): OpeningShape {
  const geometry = openingGeometry(floor, o);
  return { geometry, stray: strayOutline(floor, o, geometry) };
}

/** Node a and the unit direction of an opening's wall; null when the wall cannot be read. */
export function wallFrameOf(floor: Readonly<Floor>, o: Opening): { a: Vec2; dir: Vec2 } | null {
  const wall = floor.walls[o.wall];
  const a = wall && floor.nodes[wall.a];
  const b = wall && floor.nodes[wall.b];
  if (!a || !b || distance(a, b) < EPS) return null;
  return { a, dir: normalize(sub(b, a)) };
}

/**
 * An opening whose cut is empty stands wholly beyond its wall's clear length (it is flagged
 * `opening-out-of-wall`). It then has nothing to draw or pick, so the box of its stored span
 * across the wall stands in for it, for drawing and hit alike. Null for any other opening.
 */
export function strayOutline(
  floor: Readonly<Floor>,
  o: Opening,
  g: OpeningGeometry | null,
): Vec2[] | null {
  if (!g || distance(g.cut[0], g.cut[1]) > EPS) return null;
  return spanOutline(floor, o);
}

/** The box of an opening's stored span across its wall, unclamped; null without the wall. */
export function spanOutline(floor: Readonly<Floor>, o: Opening): Vec2[] | null {
  const frame = wallFrameOf(floor, o);
  if (!frame) return null;
  const left = leftNormal(frame.dir);
  const h = floor.walls[o.wall]!.thickness / 2;
  const { lo, hi } = openingSpan(o);
  const p = (x: number, v: number): Vec2 => add(add(frame.a, scale(frame.dir, x)), scale(left, v));
  return [p(lo, h), p(hi, h), p(hi, -h), p(lo, -h)];
}

/** The jamb handles of an opening: on its wall's centre line at each end of its stored span. */
export function openingHandles(floor: Readonly<Floor>, o: Opening): { end: Hinge; at: Vec2 }[] {
  const frame = wallFrameOf(floor, o);
  if (!frame) return [];
  const { lo, hi } = openingSpan(o);
  return [
    { end: 'a', at: add(frame.a, scale(frame.dir, lo)) },
    { end: 'b', at: add(frame.a, scale(frame.dir, hi)) },
  ];
}

/** Pixel gap between the wall face and an opening's clear-distance line. */
const DISTANCE_GAP_PX = 14;

/** The clear distance beside one jamb of an opening, as a dimension line and its text. */
export interface OpeningDistanceLabel {
  end: Hinge;
  /** `openingClearances(...)[end].face`. */
  distance: number;
  text: string;
  line: [Vec2, Vec2];
  at: Vec2;
  /** Text angle in degrees, kept upright. */
  angle: number;
}

/**
 * Both clear distances of an opening (`face`, see `openingClearances`), drawn `DISTANCE_GAP_PX`
 * beyond the wall face on the side facing the middle of the floor, so they keep clear of the
 * wall's own length label, which stands on the outer side. `pxPerM` is the view scale.
 */
export function openingDistanceLabels(
  floor: Readonly<Floor>,
  o: Opening,
  pxPerM: number,
): OpeningDistanceLabel[] {
  const frame = wallFrameOf(floor, o);
  if (!frame) return [];
  const clear = openingClearances(floor, o);
  const { a, dir } = frame;
  const left = leftNormal(dir);
  const nodes = Object.values(floor.nodes);
  const centroid = {
    x: nodes.reduce((s, n) => s + n.x, 0) / nodes.length,
    y: nodes.reduce((s, n) => s + n.y, 0) / nodes.length,
  };
  const mid = add(a, scale(dir, o.offset));
  const side = dot(left, sub(centroid, mid)) >= 0 ? 1 : -1;
  const v = side * (floor.walls[o.wall]!.thickness / 2 + DISTANCE_GAP_PX / pxPerM);
  const at = (x: number): Vec2 => add(add(a, scale(dir, x)), scale(left, v));
  const along = (p: Vec2): number => dot(sub(p, a), dir);
  let angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  else if (angle <= -90) angle += 180;
  return (['a', 'b'] as const).map((end) => {
    const c = clear[end];
    const line: [Vec2, Vec2] = [at(along(c.jamb)), at(along(c.until))];
    return {
      end,
      distance: c.face,
      text: (Math.abs(c.face) < 0.005 ? 0 : c.face).toFixed(2),
      line,
      at: scale(add(line[0], line[1]), 0.5),
      angle,
    };
  });
}
