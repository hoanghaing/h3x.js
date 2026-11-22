import type {
  Column,
  Floor,
  Id,
  Item,
  Opening,
  PlanNode,
  PresetResolver,
  Room,
  Site,
  Roof,
  RoofGeometry,
  Stair,
  Vec2,
  Wall,
} from '../core';
import { openingGeometry, roofGeometry, roomShape } from '../core';
import type { WallCorners } from '../shared/walls/joins';
import { paintOpening } from './openings';
import { columnShape, itemFootprint, roomLabel, roomPath, wallOutline } from './shapes';
import { roofOwnShapes } from './roofs';
import { stairOwnShapes, type StairLabels } from './stairs';
import { NODE_RADIUS_PX } from './style';
import type { PlanKind, Rect } from './types';
import { planToScreen, screenToPlan, type View } from './view';

export const SVG_NS = 'http://www.w3.org/2000/svg';
/** Strokes keep their pixel width under the plan → screen scale. */
export const NON_SCALING = { 'vector-effect': 'non-scaling-stroke' };

/** Minor grid lines per meter (0.1 m apart) and the on-screen gap (px) below which they hide. */
const MINOR_PER_M = 10;
const MINOR_MIN_PX = 6;
/** Padding (px) around a dimension label's text for its hit rect. */
const LABEL_PAD_PX = 3;
/** Average glyph advance as a fraction of the font size (labels are digits and a dot). */
const GLYPH_ADVANCE = 0.6;

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

/** Sets an attribute only when its value differs, so unchanged entities are not touched. */
export function setAttr(e: Element, name: string, value: string): void {
  if (e.getAttribute(name) !== value) e.setAttribute(name, value);
}

export function setText(e: Element, value: string): void {
  if (e.textContent !== value) e.textContent = value;
}

export function pointsAttr(pts: readonly Vec2[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

/** Plan → screen as an SVG transform (+y up, so the y axis is mirrored). */
export function rootTransform(v: View): string {
  return `matrix(${v.scale},0,0,${-v.scale},${v.width / 2 - v.cx * v.scale},${v.height / 2 + v.cy * v.scale})`;
}

/**
 * Transform for an element inside the plan-space root that should be drawn in screen pixels
 * (upright, unscaled) at plan point `p`, rotated by `angleDeg` (plan degrees, CCW).
 */
export function screenSpaceTransform(v: View, p: Vec2, angleDeg = 0): string {
  const k = 1 / v.scale;
  const base = `matrix(${k},0,0,${-k},${p.x},${p.y})`;
  return angleDeg ? `${base} rotate(${-angleDeg})` : base;
}

/** Grid lines every `1 / perUnit` m across the visible area, skipping every `skipEvery`-th. */
function linesPath(v: View, perUnit: number, skipEvery: number): string {
  if (v.width <= 0 || v.height <= 0) return '';
  const lo = screenToPlan(v, { x: 0, y: v.height });
  const hi = screenToPlan(v, { x: v.width, y: 0 });
  const segs: string[] = [];
  for (let k = Math.ceil(lo.x * perUnit); k <= Math.floor(hi.x * perUnit); k++) {
    if (skipEvery && k % skipEvery === 0) continue;
    segs.push(`M${k / perUnit},${lo.y}V${hi.y}`);
  }
  for (let k = Math.ceil(lo.y * perUnit); k <= Math.floor(hi.y * perUnit); k++) {
    if (skipEvery && k % skipEvery === 0) continue;
    segs.push(`M${lo.x},${k / perUnit}H${hi.x}`);
  }
  return segs.join('');
}

/** Path data (plan space) for the visible grid: 1 m major lines, 0.1 m minor lines. */
export function gridPaths(v: View): { major: string; minor: string } {
  const showMinor = v.scale / MINOR_PER_M >= MINOR_MIN_PX;
  return {
    major: linesPath(v, 1, 0),
    minor: showMinor ? linesPath(v, MINOR_PER_M, MINOR_PER_M) : '',
  };
}

/** Axis-aligned screen rect of a label centred at plan `at`, rotated by `angleDeg`. */
export function labelRect(v: View, at: Vec2, angleDeg: number, text: string, fontPx: number): Rect {
  const c = planToScreen(v, at);
  const w = text.length * fontPx * GLYPH_ADVANCE + 2 * LABEL_PAD_PX;
  const h = fontPx + 2 * LABEL_PAD_PX;
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(a));
  const sin = Math.abs(Math.sin(a));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  return { x: c.x - bw / 2, y: c.y - bh / 2, width: bw, height: bh };
}

/** What the element updaters read besides the entity itself. */
export interface RenderContext {
  floor: Readonly<Floor>;
  view: View;
  corners: Record<Id, WallCorners>;
  presets: PresetResolver | undefined;
  site?: Readonly<Site>;
  /** Stairs of `floor`: rise to the floor above (NaN when none), labels and class prefix. */
  /** Class prefix, for kinds drawn with their own classes (roofs). */
  prefix?: string;
  /** Where roof geometry is cached for hit testing (written when a roof is drawn). */
  roofGeometry?: Map<Id, RoofGeometry>;
  stairs?: { rise: number; labels: StairLabels; prefix: string };
}

export type KindEntity =
  | { kind: 'node'; entity: PlanNode }
  | { kind: 'wall'; entity: Wall }
  | { kind: 'room'; entity: Room }
  | { kind: 'opening'; entity: Opening }
  | { kind: 'item'; entity: Item }
  | { kind: 'column'; entity: Column }
  | { kind: 'stair'; entity: Stair }
  | { kind: 'roof'; entity: Roof }
  | { kind: 'site'; entity: Site };

/** The `<g>` of one entity with the (empty) children its updater fills in. */
export function createEntityElement(kind: PlanKind, id: Id, prefix: string): SVGGElement {
  const g = svgEl('g', { class: `${prefix}-${kind}`, 'data-h3x-kind': kind, 'data-h3x-id': id });
  switch (kind) {
    case 'node':
      g.append(svgEl('circle', { r: String(NODE_RADIUS_PX), ...NON_SCALING }));
      break;
    case 'wall':
    case 'item':
    case 'site':
      g.append(svgEl('polygon', NON_SCALING));
      break;
    case 'column':
      g.append(svgEl('circle', NON_SCALING), svgEl('polygon', NON_SCALING));
      break;
    case 'room':
      g.append(
        svgEl('path', { 'fill-rule': 'evenodd', ...NON_SCALING }),
        svgEl('text', { class: `${prefix}-room-name`, y: '-3' }),
        svgEl('text', { class: `${prefix}-room-area`, y: '11' }),
      );
      break;
    case 'opening':
      g.append(
        svgEl('polygon', { class: `${prefix}-opening-gap`, ...NON_SCALING }),
        svgEl('path', { class: `${prefix}-opening-arc`, ...NON_SCALING }),
        svgEl('path', { class: `${prefix}-opening-lines`, ...NON_SCALING }),
      );
      break;
  }
  return g;
}

function updateRoom(g: SVGGElement, room: Room, ctx: RenderContext): void {
  const [poly, name, area] = Array.from(g.children);
  try {
    setAttr(poly!, 'd', roomPath(roomShape(ctx.floor, room, 'inner')));
    const label = roomLabel(ctx.floor, room);
    const t = screenSpaceTransform(ctx.view, label.at);
    setAttr(name!, 'transform', t);
    setAttr(area!, 'transform', t);
    setText(name!, label.name);
    setText(area!, label.area);
  } catch {
    // A room whose walls no longer close a loop draws nothing until it is fixed.
    setAttr(poly!, 'd', '');
    setText(name!, '');
    setText(area!, '');
  }
}

/** Re-applies an entity's attributes; values that did not change are not touched. */
export function updateEntityElement(g: SVGGElement, e: KindEntity, ctx: RenderContext): void {
  const first = g.firstElementChild!;
  switch (e.kind) {
    case 'node':
      return setAttr(first, 'transform', screenSpaceTransform(ctx.view, e.entity));
    case 'wall': {
      const c = ctx.corners[e.entity.id];
      const low = e.entity.height < ctx.floor.wallHeight - 1e-6;
      if (ctx.stairs) g.classList.toggle(`${ctx.stairs.prefix}-wall-low`, low);
      return setAttr(first, 'points', c ? pointsAttr(wallOutline(c)) : '');
    }
    case 'room':
      return updateRoom(g, e.entity, ctx);
    case 'opening': {
      const geometry = openingGeometry(ctx.floor, e.entity);
      const symbol = geometry && paintOpening(geometry);
      const [gap, arcs, lines] = Array.from(g.children);
      setAttr(gap!, 'points', symbol?.gap ?? '');
      setAttr(arcs!, 'd', symbol?.arcs ?? '');
      return setAttr(lines!, 'd', symbol?.lines ?? '');
    }
    case 'item': {
      const fp = itemFootprint(e.entity, ctx.floor, ctx.presets);
      return setAttr(first, 'points', fp ? pointsAttr(fp) : '');
    }
    case 'column': {
      const shape = columnShape(e.entity);
      const [circle, poly] = Array.from(g.children);
      const round = shape.kind === 'circle';
      setAttr(circle!, 'display', round ? 'inline' : 'none');
      setAttr(poly!, 'display', round ? 'none' : 'inline');
      if (shape.kind === 'circle') {
        setAttr(circle!, 'cx', String(shape.cx));
        setAttr(circle!, 'cy', String(shape.cy));
        return setAttr(circle!, 'r', String(shape.r));
      }
      return setAttr(poly!, 'points', pointsAttr(shape.points));
    }
    case 'stair': {
      const s = ctx.stairs;
      if (!s) return;
      return g.replaceChildren(...stairOwnShapes(e.entity, { ...s, view: ctx.view }));
    }
    case 'roof': {
      if (!ctx.prefix) return;
      const geo = roofGeometry(e.entity, ctx.floor);
      ctx.roofGeometry?.set(e.entity.id, geo);
      return g.replaceChildren(...roofOwnShapes(e.entity, ctx.floor, ctx.view, ctx.prefix, geo));
    }
    case 'site':
      return setAttr(first, 'points', pointsAttr(e.entity.points));
  }
}

/** Fill of the junction area at a node (keyed by node id, not an entity of its own). */
export function createJoinElement(nodeId: Id, prefix: string): SVGGElement {
  const g = svgEl('g', { class: `${prefix}-join`, 'data-h3x-node': nodeId });
  g.append(svgEl('polygon', NON_SCALING));
  return g;
}

/** Length label of a wall: a dimension line (plan space) and its text (screen space). */
export function createDimensionElement(wallId: Id, prefix: string): SVGGElement {
  const g = svgEl('g', { class: `${prefix}-dimension`, 'data-h3x-wall': wallId });
  g.append(svgEl('path', NON_SCALING), svgEl('text'));
  return g;
}

export function updateDimensionElement(
  g: SVGGElement,
  label: { text: string; at: Vec2; angle: number; line: [Vec2, Vec2] },
  view: View,
): void {
  const [line, text] = Array.from(g.children);
  const [p, q] = label.line;
  setAttr(line!, 'd', `M${p.x},${p.y}L${q.x},${q.y}`);
  setAttr(text!, 'transform', screenSpaceTransform(view, label.at, label.angle));
  setText(text!, label.text);
}
