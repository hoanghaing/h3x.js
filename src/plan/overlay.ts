import type { Floor, Vec2 } from '../core';
import { dimensionLabel, wallsShowingDimensions, type DimensionState } from './dimensions';
import type { PlanDom } from './kinds';
import {
  NON_SCALING,
  createDimensionElement,
  labelRect,
  screenSpaceTransform,
  svgEl,
  updateDimensionElement,
} from './render';
import type { SnapGuide } from './snap';
import { DIMENSION_FONT_PX } from './style';
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
