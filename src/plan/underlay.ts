import type { Floor, Id } from '../core';
import type { WallCorners } from '../shared/walls/joins';
import { NON_SCALING, pointsAttr, svgEl } from './render';
import { columnShape, wallOutline } from './shapes';
import type { View } from './view';

/** The faded floor-below layer: drawn only, never hit-tested or snapped to. */
export function createUnderlayLayer(prefix: string): SVGGElement {
  return svgEl('g', { class: `${prefix}-underlay`, 'pointer-events': 'none' });
}

/**
 * Replaces the layer's children with the outline of every wall and the shape of every column of
 * `below` (`corners` are the joins of `below`); empty when there is no floor below.
 */
export function renderUnderlay(
  below: Readonly<Floor> | undefined,
  layer: SVGGElement,
  ctx: { view: View; corners: Record<Id, WallCorners> },
): void {
  const shapes: SVGElement[] = [];
  if (below) {
    for (const id of Object.keys(below.walls)) {
      const c = ctx.corners[id];
      if (c) shapes.push(svgEl('polygon', { points: pointsAttr(wallOutline(c)), ...NON_SCALING }));
    }
    for (const column of Object.values(below.columns)) {
      const s = columnShape(column);
      shapes.push(
        s.kind === 'circle'
          ? svgEl('circle', { cx: String(s.cx), cy: String(s.cy), r: String(s.r), ...NON_SCALING })
          : svgEl('polygon', { points: pointsAttr(s.points), ...NON_SCALING }),
      );
    }
  }
  layer.replaceChildren(...shapes);
}
