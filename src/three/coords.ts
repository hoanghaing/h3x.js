import { Vector3 } from 'three';
import type { Vec2 } from '../core/types';

/** Plan (x, y) + elevation -> world (x, elevation, -y). */
export function toWorld(p: Vec2, elevation = 0): Vector3 {
  return new Vector3(p.x, elevation, -p.y);
}

/** Plan rotation (CCW from above) maps to object.rotation.y unchanged. */
export function planRotationToWorldY(theta: number): number {
  return theta;
}
