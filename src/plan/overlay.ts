import type { Floor } from '../core';
import { dimensionLabel, wallsShowingDimensions, type DimensionState } from './dimensions';
import type { PlanDom } from './kinds';
import {
  NON_SCALING,
  createDimensionElement,
  labelRect,
  svgEl,
  updateDimensionElement,
} from './render';
import type { SnapGuide } from './snap';
import { DIMENSION_FONT_PX } from './style';
import { screenToPlan, type View } from './view';

/** Replaces the overlay layer's content with one full-view line per alignment guide. */
export function renderGuides(
  layer: SVGGElement,
  view: View,
  prefix: string,
  guides: readonly SnapGuide[],
): void {
  layer.replaceChildren();
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
