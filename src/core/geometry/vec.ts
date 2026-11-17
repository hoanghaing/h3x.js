import type { Vec2 } from '../types';

export const EPS = 1e-9;

/** Rounds to 1e-9 m so computed offsets / coordinates do not carry float noise. */
export const tidy = (n: number): number => Math.round(n * 1e9) / 1e9;

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

/** Left normal (-dy, dx), normalised. */
export function leftNormal(dir: Vec2): Vec2 {
  return normalize({ x: -dir.y, y: dir.x });
}
