import type { Vec2 } from '../types';
import { GEOM_TOL } from '../constants';
import { dot, sub } from './vec';

export interface OBB {
  center: Vec2;
  halfW: number;
  halfD: number;
  rotation: number;
}

export function obbCorners(o: OBB): Vec2[] {
  const c = Math.cos(o.rotation);
  const s = Math.sin(o.rotation);
  const local: Array<[number, number]> = [
    [-o.halfW, -o.halfD],
    [o.halfW, -o.halfD],
    [o.halfW, o.halfD],
    [-o.halfW, o.halfD],
  ];
  return local.map(([x, y]) => ({ x: o.center.x + x * c - y * s, y: o.center.y + x * s + y * c }));
}

/** SAT; touching edges (penetration <= GEOM_TOL) are not overlapping. */
export function obbOverlap(a: OBB, b: OBB): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [a, b].flatMap((o) => {
    const c = Math.cos(o.rotation);
    const s = Math.sin(o.rotation);
    return [
      { x: c, y: s },
      { x: -s, y: c },
    ];
  });
  for (const axis of axes) {
    const pa = ca.map((p) => dot(sub(p, a.center), axis));
    const pb = cb.map((p) => dot(sub(p, a.center), axis));
    const overlap =
      Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb));
    if (overlap <= GEOM_TOL) return false;
  }
  return true;
}

export function wallOBB(a: Vec2, b: Vec2, thickness: number): OBB {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    halfW: Math.hypot(dx, dy) / 2,
    halfD: thickness / 2,
    rotation: Math.atan2(dy, dx),
  };
}
