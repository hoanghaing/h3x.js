import type { Vec2 } from '../core';
import type { View } from './view';

export const SVG_NS = 'http://www.w3.org/2000/svg';
/** Strokes keep their pixel width under the plan → screen scale. */
export const NON_SCALING = { 'vector-effect': 'non-scaling-stroke' };

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

/**
 * Transform for an element inside the plan-space root that should be drawn in screen pixels
 * (upright, unscaled) at plan point `p`, rotated by `angleDeg` (plan degrees, CCW).
 */
export function screenSpaceTransform(v: View, p: Vec2, angleDeg = 0): string {
  const k = 1 / v.scale;
  const base = `matrix(${k},0,0,${-k},${p.x},${p.y})`;
  return angleDeg ? `${base} rotate(${-angleDeg})` : base;
}
