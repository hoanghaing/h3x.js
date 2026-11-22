import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildSlabGeometry } from '../../src/three';
import { MITER_LIMIT } from '../../src/core/constants';
import { irregularFixtures, courtyardFloor } from '../fixtures/irregular';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';

function rect4x5() {
  const f = oneRoomFloor();
  f.nodes.n3 = { id: 'n3', x: 4, y: 5 };
  f.nodes.n4 = { id: 'n4', x: 0, y: 5 };
  return { ...f, elevation: 3.35, slabThickness: 0.2 };
}

describe('buildSlabGeometry', () => {
  it('covers the outer wall faces of a 4x5 room, slabThickness deep below the elevation', () => {
    const g = buildSlabGeometry(rect4x5())!;
    expect(g).not.toBeNull();
    g.computeBoundingBox();
    const box = g.boundingBox as Box3;
    expect(box.max.x - box.min.x).toBeCloseTo(4.2, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(5.2, 6);
    expect(box.min.x).toBeCloseTo(-0.1, 6);
    expect(box.min.y).toBeCloseTo(3.15, 6);
    expect(box.max.y).toBeCloseTo(3.35, 6);
  });

  it('is a closed prism (top + bottom area, outward side normals)', () => {
    const g = buildSlabGeometry(rect4x5())!;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    let up = 0;
    let down = 0;
    let side = 0;
    for (let i = 0; i < pos.count; i++) {
      if (nrm.getY(i) > 0.99) up++;
      else if (nrm.getY(i) < -0.99) down++;
      else side++;
    }
    expect(up).toBeGreaterThan(0);
    expect(down).toBe(up);
    expect(side).toBe(4 * 6);
  });

  it('merges adjacent rooms into one outline', () => {
    const g = buildSlabGeometry(twoRoomFloor())!;
    g.computeBoundingBox();
    const box = g.boundingBox as Box3;
    expect(box.max.x - box.min.x).toBeCloseTo(8.2, 6);
    expect(box.max.z - box.min.z).toBeCloseTo(4.2, 6);
    // the shared wall does not add side faces: 4 outer edges per room side = 6 edges
    const nrm = g.getAttribute('normal');
    let side = 0;
    for (let i = 0; i < nrm.count; i++) if (Math.abs(nrm.getY(i)) < 0.01) side++;
    expect(side).toBe(6 * 6);
  });

  it('returns null for a floor with no rooms', () => {
    const f = { ...oneRoomFloor(), rooms: {} };
    expect(buildSlabGeometry(f)).toBeNull();
  });
});

describe('buildSlabGeometry on irregular lots', () => {
  for (const [name, make] of Object.entries(irregularFixtures)) {
    it(`${name}: stays within the grown centre-line bounds`, () => {
      const floor = make();
      const g = buildSlabGeometry(floor)!;
      expect(g).not.toBeNull();
      g.computeBoundingBox();
      const box = g.boundingBox as Box3;
      const pts = Object.values(floor.nodes);
      const m = 0.1 * MITER_LIMIT + 1e-6;
      expect(box.min.x).toBeGreaterThanOrEqual(Math.min(...pts.map((p) => p.x)) - m);
      expect(box.max.x).toBeLessThanOrEqual(Math.max(...pts.map((p) => p.x)) + m);
      expect(box.min.z).toBeGreaterThanOrEqual(-Math.max(...pts.map((p) => p.y)) - m);
      expect(box.max.z).toBeLessThanOrEqual(-Math.min(...pts.map((p) => p.y)) + m);
    });
  }

  it('courtyardFloor keeps the light well open', () => {
    const g = buildSlabGeometry(courtyardFloor())!;
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const c = { x: 4, z: -4.5 };
    for (let i = 0; i + 2 < pos.count; i += 3) {
      if (nrm.getY(i) < 0.5) continue;
      const at = (k: number) => ({ x: pos.getX(i + k), z: pos.getZ(i + k) });
      const s = (j: number, k: number) => {
        const p = at(j);
        const q = at(k);
        return (q.x - p.x) * (c.z - p.z) - (q.z - p.z) * (c.x - p.x);
      };
      const [s1, s2, s3] = [s(0, 1), s(1, 2), s(2, 0)];
      const inside = (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
      expect(inside).toBe(false);
    }
  });
});
