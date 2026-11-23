import type { Floor, Hinge, OpeningGeometry, PlacementGuide, Vec2 } from '../core';
import { dimensionLabel, wallsShowingDimensions, type DimensionState } from './dimensions';
import type { PlanDom } from './kinds';
import { createOpeningSymbol, drawOpeningSymbol, type OpeningDistanceLabel } from './openings';
import {
  NON_SCALING,
  createDimensionElement,
  labelRect,
  screenSpaceTransform,
  setText,
  svgEl,
  updateDimensionElement,
} from './render';
import type { SnapGuide } from './snap';
import { DIMENSION_FONT_PX } from './style';
import type { Rect } from './types';
import { screenToPlan, type View } from './view';

/** Segments and optional label a drawing tool previews. */
export interface PreviewState {
  segments: Array<[Vec2, Vec2]>;
  label?: { at: Vec2; text: string };
}

/** Replaces the overlay layer's guides with one full-view line per alignment guide. */
export function renderGuides(
  layer: SVGGElement,
  view: View,
  prefix: string,
  guides: readonly SnapGuide[],
): void {
  for (const el of Array.from(layer.querySelectorAll(`.${prefix}-guide`))) el.remove();
  const min = screenToPlan(view, { x: 0, y: view.height });
  const max = screenToPlan(view, { x: view.width, y: 0 });
  for (const g of guides) {
    layer.appendChild(
      svgEl('line', {
        class: `${prefix}-guide`,
        x1: String(g.axis === 'x' ? g.value : min.x),
        x2: String(g.axis === 'x' ? g.value : max.x),
        y1: String(g.axis === 'y' ? g.value : min.y),
        y2: String(g.axis === 'y' ? g.value : max.y),
        ...NON_SCALING,
      }),
    );
  }
}

/** Replaces the overlay layer's preview (segments as lines, the label in screen space). */
export function renderPreview(
  layer: SVGGElement,
  view: View,
  prefix: string,
  preview: PreviewState | null,
): void {
  const old = layer.querySelectorAll(`.${prefix}-preview, .${prefix}-preview-label`);
  for (const el of Array.from(old)) el.remove();
  if (!preview) return;
  for (const [a, b] of preview.segments) {
    layer.appendChild(
      svgEl('line', {
        class: `${prefix}-preview`,
        x1: String(a.x),
        y1: String(a.y),
        x2: String(b.x),
        y2: String(b.y),
        ...NON_SCALING,
      }),
    );
  }
  if (preview.label) {
    const text = svgEl('text', {
      class: `${prefix}-preview-label`,
      transform: screenSpaceTransform(view, preview.label.at),
    });
    text.textContent = preview.label.text;
    layer.appendChild(text);
  }
}

/**
 * The ghost of an opening being placed: its symbol, or a bar at the pointer when it has no wall;
 * `null` draws only the guides.
 */
export interface GhostState {
  shape: OpeningGeometry | { at: Vec2; width: number } | { outline: readonly Vec2[] } | null;
  invalid: boolean;
  guides: readonly PlacementGuide[];
}

/** Replaces the overlay layer's opening ghost and its snap ticks (or the ticks alone); `null` clears. */
export function renderGhost(layer: SVGGElement, prefix: string, ghost: GhostState | null): void {
  const old = layer.querySelectorAll(`.${prefix}-ghost, .${prefix}-ghost-guides`);
  for (const el of Array.from(old)) el.remove();
  if (!ghost) return;
  const { shape } = ghost;
  const free = shape !== null && 'at' in shape;
  // Guides alone (a valid drag step) are not a ghost.
  const g = svgEl('g', { class: shape ? `${prefix}-ghost` : `${prefix}-ghost-guides` });
  g.classList.toggle(`${prefix}-ghost-free`, free);
  g.classList.toggle(`${prefix}-invalid`, ghost.invalid);
  if (shape) {
    createOpeningSymbol(g, prefix);
    if ('outline' in shape) drawOpeningSymbol(g, null, shape.outline);
    else drawOpeningSymbol(g, 'at' in shape ? null : shape);
  }
  if (shape && 'at' in shape) {
    const { at, width } = shape;
    g.lastElementChild!.setAttribute(
      'd',
      `M${at.x - width / 2},${at.y}L${at.x + width / 2},${at.y}`,
    );
  }
  for (const { from, to } of ghost.guides) {
    g.appendChild(
      svgEl('line', {
        class: `${prefix}-ghost-guide`,
        x1: String(from.x),
        y1: String(from.y),
        x2: String(to.x),
        y2: String(to.y),
        ...NON_SCALING,
      }),
    );
  }
  layer.appendChild(g);
}

/** Radius (px) of the drop-target marker. */
const DROP_TARGET_RADIUS_PX = 7;

/** Replaces the overlay layer's drop-target marker (a screen-sized ring at `at`); `null` clears. */
export function renderDropTarget(
  layer: SVGGElement,
  view: View,
  prefix: string,
  at: Vec2 | null,
): void {
  for (const el of Array.from(layer.querySelectorAll(`.${prefix}-drop-target`))) el.remove();
  if (!at) return;
  layer.appendChild(
    svgEl('circle', {
      class: `${prefix}-drop-target`,
      r: String(DROP_TARGET_RADIUS_PX),
      transform: screenSpaceTransform(view, at),
      ...NON_SCALING,
    }),
  );
}

/** Half-side (px) of a roof vertex handle. */
const ROOF_HANDLE_HALF_PX = 4;

/** Replaces the overlay layer's roof vertex handles (screen-sized squares); `[]` clears. */
export function renderRoofHandles(
  layer: SVGGElement,
  view: View,
  prefix: string,
  points: readonly Vec2[],
): void {
  for (const el of Array.from(layer.querySelectorAll(`.${prefix}-roof-handle`))) el.remove();
  for (const p of points) {
    layer.appendChild(
      svgEl('rect', {
        class: `${prefix}-roof-handle`,
        x: String(-ROOF_HANDLE_HALF_PX),
        y: String(-ROOF_HANDLE_HALF_PX),
        width: String(ROOF_HANDLE_HALF_PX * 2),
        height: String(ROOF_HANDLE_HALF_PX * 2),
        transform: screenSpaceTransform(view, p),
        ...NON_SCALING,
      }),
    );
  }
}

/** Half-side (px) of an opening's jamb handle (8 px squares). */
const OPENING_HANDLE_HALF_PX = 4;

/** What the selected opening shows for editing: jamb handles and clear-distance labels. */
export interface OpeningEditState {
  handles: ReadonlyArray<{ end: Hinge; at: Vec2 }>;
  labels: readonly OpeningDistanceLabel[];
}

/**
 * Replaces the overlay layer's opening handles and clear-distance labels; `null` clears.
 * Returns the labels' screen rects, for hit testing.
 */
export function renderOpeningEdit(
  layer: SVGGElement,
  view: View,
  prefix: string,
  state: OpeningEditState | null,
): Array<{ end: Hinge; rect: Rect }> {
  const old = layer.querySelectorAll(`.${prefix}-opening-handle, .${prefix}-opening-distance`);
  for (const el of Array.from(old)) el.remove();
  if (!state) return [];
  const rects: Array<{ end: Hinge; rect: Rect }> = [];
  for (const label of state.labels) {
    const g = svgEl('g', {
      class: `${prefix}-dimension ${prefix}-opening-distance`,
      'data-h3x-end': label.end,
    });
    const [p, q] = label.line;
    g.append(
      svgEl('path', { d: `M${p.x},${p.y}L${q.x},${q.y}`, ...NON_SCALING }),
      svgEl('text', { transform: screenSpaceTransform(view, label.at, label.angle) }),
    );
    setText(g.lastElementChild!, label.text);
    layer.appendChild(g);
    rects.push({
      end: label.end,
      rect: labelRect(view, label.at, label.angle, label.text, DIMENSION_FONT_PX),
    });
  }
  for (const h of state.handles) {
    layer.appendChild(
      svgEl('rect', {
        class: `${prefix}-opening-handle`,
        'data-h3x-end': h.end,
        x: String(-OPENING_HANDLE_HALF_PX),
        y: String(-OPENING_HANDLE_HALF_PX),
        width: String(OPENING_HANDLE_HALF_PX * 2),
        height: String(OPENING_HANDLE_HALF_PX * 2),
        transform: screenSpaceTransform(view, h.at),
        ...NON_SCALING,
      }),
    );
  }
  return rects;
}

/** Re-derives which walls show a length label, their geometry and screen rects. */
export function syncDimensions(
  floor: Readonly<Floor>,
  view: View,
  state: DimensionState,
  dom: PlanDom,
): void {
  const { dimensions: els, dimensionRects: rects, prefix } = dom;
  const ids = new Set(wallsShowingDimensions(floor, state));
  for (const [id, g] of els) {
    if (ids.has(id)) continue;
    g.remove();
    els.delete(id);
    rects.delete(id);
  }
  for (const id of ids) {
    let g = els.get(id);
    if (!g) {
      g = createDimensionElement(id, prefix);
      els.set(id, g);
      dom.layers.dimensions.appendChild(g);
    }
    const label = dimensionLabel(floor, id, view);
    updateDimensionElement(g, label, view);
    rects.set(id, labelRect(view, label.at, label.angle, label.text, DIMENSION_FONT_PX));
  }
}
