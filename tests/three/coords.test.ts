import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { planRotationToWorldY, toWorld } from '../../src/three/coords';

describe('coords', () => {
  it('maps plan (x,y) + elevation to world (x, elevation, -y)', () => {
    expect(toWorld({ x: 1, y: 2 }, 0.5)).toEqual(new Vector3(1, 0.5, -2));
  });
  it('defaults elevation to 0', () => {
    expect(toWorld({ x: 1, y: 2 }).y).toBe(0);
  });
  it('keeps a CCW plan triangle CCW seen from +Y', () => {
    const a = toWorld({ x: 0, y: 0 });
    const b = toWorld({ x: 1, y: 0 });
    const c = toWorld({ x: 0, y: 1 });
    const cross = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    expect(cross.y).toBeGreaterThan(0);
  });
  it('maps plan rotation to world Y rotation unchanged', () => {
    expect(planRotationToWorldY(0.7)).toBe(0.7);
  });
});
