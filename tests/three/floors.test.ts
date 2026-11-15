import { describe, expect, it } from 'vitest';
import { buildFloorGeometry } from '../../src/three/floors';
import { oneRoomFloor } from '../fixtures/floors';
import { groupArea, groupFaceNormals, groupNormals } from './helpers';

describe('buildFloorGeometry', () => {
  it('builds the inner polygon with +Y normals', () => {
    const f = oneRoomFloor();
    const g = buildFloorGeometry(f, f.rooms.r1!)!;
    expect(g).not.toBeNull();
    g.addGroup(0, g.getAttribute('position').count, 0);
    expect(groupArea(g, 0)).toBeCloseTo(14.44, 4);
    for (const n of groupNormals(g, 0)) expect([n.x, n.y, n.z]).toEqual([0, 1, 0]);
    for (const n of groupFaceNormals(g, 0)) expect(n.y).toBeCloseTo(1, 6);
  });

  it('places the floor at the floor elevation', () => {
    const f = { ...oneRoomFloor(), elevation: 3.5 };
    const g = buildFloorGeometry(f, f.rooms.r1!)!;
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(3.5, 6);
  });

  it('degenerate room yields null', () => {
    const f = oneRoomFloor();
    f.nodes.n3 = { id: 'n3', x: -1, y: -1 };
    expect(buildFloorGeometry(f, f.rooms.r1!)).toBeNull();
  });
});
