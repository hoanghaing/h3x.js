import type { Vec2 } from '../core';

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
