import type { Floor, Id } from '../core';
import type { WallCorners } from '../shared/walls/joins';
import { NON_SCALING, pointsAttr, svgEl } from './svg';
import { columnShape, wallOutline } from './shapes';
import { stairFromAbove, type StairLabels } from './stairs';
import type { View } from './view';

/** The faded floor-below layer: drawn only, never hit-tested or snapped to. */
export function createUnderlayLayer(prefix: string): SVGGElement {
  return svgEl('g', { class: `${prefix}-underlay`, 'pointer-events': 'none' });
}

/**
 * Replaces the layer's children with the outline of every wall and the shape of every column of
 * `below` (`corners` are the joins of `below`), and its stairs seen from above (opening, steps,
 * down label; `stairs.rise` is the rise of `below`); empty when there is no floor below.
 */
export function renderUnderlay(
  below: Readonly<Floor> | undefined,
  layer: SVGGElement,
  ctx: {
    view: View;
    corners: Record<Id, WallCorners>;
    stairs?: { rise: number; labels: StairLabels; prefix: string };
  },
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
    const s = ctx.stairs;
    if (s) {
      for (const stair of Object.values(below.stairs)) {
        shapes.push(stairFromAbove(stair, { ...s, view: ctx.view }));
      }
    }
  }
  layer.replaceChildren(...shapes);
}
