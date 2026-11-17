import { layoutStair, stairOutline, type Stair, type StairPiece, type Vec2 } from '../core';
import { closestPointOnSegment } from '../core/geometry/segment';
import { NON_SCALING, pointsAttr, screenSpaceTransform, svgEl } from './render';
import type { View } from './view';

export interface StairLabels {
  up: string;
  down: string;
}
export const DEFAULT_STAIR_LABELS: StairLabels = { up: 'UP', down: 'DN' };

/** Steps whose walking surface is above this height (m) are beyond the cut: drawn dashed. */
export const STAIR_CUT_HEIGHT = 1.2;
/** Arrowhead length and half-width (m) at the end of the walking line. */
const ARROW_LENGTH = 0.25;
const ARROW_HALF = 0.1;
/** Size (m) of the zig in the middle of the break line. */
const ZIG = 0.12;

/** What a stair drawing reads besides the stair. */
export interface StairDrawContext {
  /** Rise to the floor above (NaN when there is none). */
  rise: number;
  view: View;
  prefix: string;
  labels: StairLabels;
}

const add = (p: Vec2, v: Vec2, k = 1): Vec2 => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const unit = (a: Vec2, b: Vec2): Vec2 => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
};
const pathOf = (pts: readonly Vec2[]): string =>
  pts.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');

function piecePolygon(piece: StairPiece, cls: string): SVGPolygonElement {
  return svgEl('polygon', { class: cls, points: pointsAttr(piece.outline), ...NON_SCALING });
}

function label(text: string, at: Vec2, ctx: StairDrawContext): SVGTextElement {
  const t = svgEl('text', {
    class: `${ctx.prefix}-stair-label`,
    transform: screenSpaceTransform(ctx.view, at),
  });
  t.textContent = text;
  return t;
}

/** Point on the polyline nearest `p`, with the direction of the segment it lies on. */
function onWalkLine(walk: readonly Vec2[], p: Vec2): { point: Vec2; dir: Vec2 } {
  let best = { point: walk[0]!, dir: unit(walk[0]!, walk[1] ?? walk[0]!), d: Infinity };
  for (let i = 0; i + 1 < walk.length; i++) {
    const cp = closestPointOnSegment(p, walk[i]!, walk[i + 1]!).point;
    const d = Math.hypot(cp.x - p.x, cp.y - p.y);
    if (d < best.d) best = { point: cp, dir: unit(walk[i]!, walk[i + 1]!), d };
  }
  return best;
}

/** Zig-zag break line across `step`, perpendicular to the walking line at its lower edge. */
function breakLine(step: StairPiece, walk: readonly Vec2[], tread: number): Vec2[] {
  const n = step.outline.length;
  const centroid = step.outline.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), {
    x: 0,
    y: 0,
  });
  const { point, dir } = onWalkLine(walk, centroid);
  const c = add(point, dir, -tread / 2);
  const across = { x: -dir.y, y: dir.x };
  const half =
    Math.max(
      ...step.outline.map((p) => Math.abs((p.x - c.x) * across.x + (p.y - c.y) * across.y)),
    ) + 0.05;
  return [
    add(c, across, -half),
    add(c, across, -ZIG / 2),
    add(add(c, across, -ZIG / 4), dir, ZIG),
    add(add(c, across, ZIG / 4), dir, -ZIG),
    add(c, across, ZIG / 2),
    add(c, across, half),
  ];
}

/** Walking line with an arrowhead at its end. */
function walkingLine(walk: readonly Vec2[], prefix: string): SVGElement[] {
  const end = walk[walk.length - 1]!;
  const dir = unit(walk[walk.length - 2]!, end);
  const side = { x: -dir.y, y: dir.x };
  const base = add(end, dir, -ARROW_LENGTH);
  return [
    svgEl('path', { class: `${prefix}-stair-walk`, d: pathOf(walk), ...NON_SCALING }),
    svgEl('polygon', {
      class: `${prefix}-stair-arrow`,
      points: pointsAttr([end, add(base, side, ARROW_HALF), add(base, side, -ARROW_HALF)]),
      ...NON_SCALING,
    }),
  ];
}

/** The lowest step or landing whose top is above STAIR_CUT_HEIGHT: where the break line goes. */
export function firstAboveCut(
  steps: readonly StairPiece[],
  landings: readonly StairPiece[],
): StairPiece | undefined {
  let best: StairPiece | undefined;
  for (const p of [...steps, ...landings]) {
    if (p.top > STAIR_CUT_HEIGHT && (!best || p.top < best.top)) best = p;
  }
  return best;
}

/**
 * Children of a stair on its own floor: its outline (`stairOutline`, also what selection, hit
 * testing and validation use), steps and landings (dashed above STAIR_CUT_HEIGHT), a break line at
 * the cut, the walking line with an arrow and the up label. A stair without a valid layout draws
 * only its outline, which is then the bay.
 */
export function stairOwnShapes(stair: Stair, ctx: StairDrawContext): SVGElement[] {
  const { prefix } = ctx;
  const outline = svgEl('polygon', {
    class: `${prefix}-stair-outline`,
    points: pointsAttr(stairOutline(stair, ctx.rise)),
    ...NON_SCALING,
  });
  const l = Number.isFinite(ctx.rise) ? layoutStair(stair, ctx.rise) : undefined;
  if (!l?.ok || l.walkLine.length < 2) return [outline];
  const out: SVGElement[] = [outline];
  for (const piece of [...l.steps, ...l.landings]) {
    const hidden = piece.top > STAIR_CUT_HEIGHT;
    out.push(piecePolygon(piece, `${prefix}-stair-step${hidden ? ` ${prefix}-stair-hidden` : ''}`));
  }
  const cut = firstAboveCut(l.steps, l.landings);
  if (cut) {
    out.push(
      svgEl('path', {
        class: `${prefix}-stair-break`,
        d: pathOf(breakLine(cut, l.walkLine, l.treadDepth)),
        ...NON_SCALING,
      }),
    );
  }
  out.push(...walkingLine(l.walkLine, prefix));
  const start = l.walkLine[0]!;
  out.push(label(ctx.labels.up, add(start, unit(start, l.walkLine[1]!), 1.5 * l.treadDepth), ctx));
  return out;
}

/**
 * A stair of the floor below seen from the floor above: the slab opening (the stair outline, cut
 * for every stair as in 3D) and, when the layout is valid, every step and landing as thin lines and
 * the down label near the top.
 */
export function stairFromAbove(stair: Stair, ctx: StairDrawContext): SVGGElement {
  const { prefix } = ctx;
  const g = svgEl('g', { class: `${prefix}-stair-below`, 'data-h3x-stair': stair.id });
  g.append(
    svgEl('polygon', {
      class: `${prefix}-stair-opening`,
      points: pointsAttr(stairOutline(stair, ctx.rise)),
      ...NON_SCALING,
    }),
  );
  const l = Number.isFinite(ctx.rise) ? layoutStair(stair, ctx.rise) : undefined;
  if (!l?.ok || l.walkLine.length < 2) return g;
  g.append(...[...l.steps, ...l.landings].map((p) => piecePolygon(p, `${prefix}-stair-step`)));
  const end = l.walkLine[l.walkLine.length - 1]!;
  const back = unit(end, l.walkLine[l.walkLine.length - 2]!);
  g.append(label(ctx.labels.down, add(end, back, 1.5 * l.treadDepth), ctx));
  return g;
}
