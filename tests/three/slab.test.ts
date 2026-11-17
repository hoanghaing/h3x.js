import { Box3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildSlabGeometry } from '../../src/three';
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
