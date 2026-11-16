import type { Vec2 } from '../core';
import type { ScreenPoint } from './types';

/** Plan view: centre in meters, scale in px per meter, viewport size in px. */
export interface View {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

export const MIN_SCALE = 5;
export const MAX_SCALE = 2000;
export const DEFAULT_SCALE = 50;

const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function planToScreen(v: View, p: Vec2): ScreenPoint {
  return { x: (p.x - v.cx) * v.scale + v.width / 2, y: v.height / 2 - (p.y - v.cy) * v.scale };
}

export function screenToPlan(v: View, s: ScreenPoint): Vec2 {
  return { x: (s.x - v.width / 2) / v.scale + v.cx, y: (v.height / 2 - s.y) / v.scale + v.cy };
}

/** Zooms by `factor`, keeping the plan point under `s` fixed. */
export function zoomAt(v: View, s: ScreenPoint, factor: number): View {
  const anchor = screenToPlan(v, s);
  const scale = clampScale(v.scale * factor);
  return {
    ...v,
    scale,
    cx: anchor.x - (s.x - v.width / 2) / scale,
    cy: anchor.y - (v.height / 2 - s.y) / scale,
  };
}

/** Pans by screen pixels (content follows the pointer). */
export function panBy(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - dx / v.scale, cy: v.cy + dy / v.scale };
}

/** Fits the plan box into the viewport; a zero-size viewport keeps DEFAULT_SCALE. */
export function fitBounds(v: View, min: Vec2, max: Vec2, paddingPx = 40): View {
  const cx = (min.x + max.x) / 2;
  const cy = (min.y + max.y) / 2;
  const availW = v.width - 2 * paddingPx;
  const availH = v.height - 2 * paddingPx;
  if (availW <= 0 || availH <= 0) return { ...v, cx, cy, scale: DEFAULT_SCALE };
  const scale = clampScale(Math.min(availW / (max.x - min.x), availH / (max.y - min.y)));
  return { ...v, cx, cy, scale };
}
