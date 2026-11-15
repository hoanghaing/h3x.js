import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { Floor, Opening } from '../../src/core';
import { wallUsableRange } from '../../src/core/validate/layout';
import { computeWallCorners, type WallCorners } from '../../src/three/walls/joins';
import { WALL_GROUP, buildWallGeometry } from '../../src/three/walls/wallGeometry';
import { oneRoomFloor } from '../fixtures/floors';
import { groupArea, groupFaceNormals, groupNormals } from './helpers';

function isolatedFloor(): Floor {
  return {
    id: 'f',
    level: 0,
    elevation: 0,
    wallHeight: 3.2,
    nodes: { a: { id: 'a', x: 0, y: 0 }, b: { id: 'b', x: 4, y: 0 } },
    walls: { w: { id: 'w', a: 'a', b: 'b', thickness: 0.2, height: 3.2 } },
    openings: {},
    rooms: {},
    items: {},
  };
}

function build(floor: Floor, wallId: string) {
  const c: WallCorners | undefined = computeWallCorners(floor)[wallId];
  if (!c) throw new Error(`no corners for ${wallId}`);
  return buildWallGeometry(floor, wallId, c);
}

const area = (g: ReturnType<typeof build>, k: keyof typeof WALL_GROUP) =>
  groupArea(g, WALL_GROUP[k]);

/** Positions are stored as Float32, so ±1e-6 is the tightest meaningful bound. */
function expectNear(actual: number, expected: number, tol = 1e-6) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function expectAllNear(list: Vector3[], x: number, y: number, z: number) {
  expect(list.length).toBeGreaterThan(0);
  for (const n of list) {
    expect(n.distanceTo(new Vector3(x, y, z))).toBeLessThan(1e-6);
  }
}

describe('buildWallGeometry', () => {
  it('plain wall', () => {
    const g = build(isolatedFloor(), 'w');
    expectNear(area(g, 'left'), 12.8);
    expectNear(area(g, 'right'), 12.8);
    expectNear(area(g, 'trim'), 2.08);
    expectAllNear(groupNormals(g, WALL_GROUP.left), 0, 0, -1);
    expectAllNear(groupFaceNormals(g, WALL_GROUP.left), 0, 0, -1);
    expectAllNear(groupNormals(g, WALL_GROUP.right), 0, 0, 1);
    expectAllNear(groupFaceNormals(g, WALL_GROUP.right), 0, 0, 1);
  });

  it('door on mitered wall', () => {
    const g = build(oneRoomFloor(), 'w1');
    expectNear(area(g, 'left'), 10.27);
    expectNear(area(g, 'right'), 11.55);
    expectNear(area(g, 'trim'), 1.82);
  });

  it('window adds sill', () => {
    const f = oneRoomFloor();
    const win: Opening = {
      id: 'o2',
      wall: 'w3',
      preset: 'window-01',
      offset: 2,
      width: 1.2,
      height: 1.4,
      sill: 0.9,
      flip: false,
    };
    const before = build(f, 'w3');
    f.openings.o2 = win;
    const g = build(f, 'w3');
    expectNear(area(before, 'left') - area(g, 'left'), 1.68);
    // top 0.8 + jambs 2·0.2·1.4 + lintel 0.24 + sill 0.24
    // w3 sits at y = 4: Float32 rounding of the ±0.1 offsets around |z| = 4 sums to ~2e-6 over the trim.
    expectNear(area(g, 'trim'), 0.8 + 0.56 + 0.24 + 0.24, 5e-6);
    expectNear(area(g, 'trim') - area(before, 'trim'), 0.56 + 0.24 + 0.24, 5e-6);
  });

  it('reveal normals point into the opening', () => {
    const f = oneRoomFloor();
    f.openings.o1 = { ...f.openings.o1!, sill: 0.5, height: 1.5 };
    const g = build(f, 'w1');
    const trim = groupFaceNormals(g, WALL_GROUP.trim);
    // jambs along ±x, lintel −y, sill and top +y; nothing along z (no end caps on a room)
    expect(trim.some((n) => n.x > 0.999)).toBe(true);
    expect(trim.some((n) => n.x < -0.999)).toBe(true);
    expect(trim.some((n) => n.y < -0.999)).toBe(true);
    expect(trim.every((n) => Math.abs(n.z) < 1e-6)).toBe(true);
    expectNear(area(g, 'trim'), 0.8 + 2 * 0.2 * 1.5 + 2 * 0.9 * 0.2);
  });

  it('opening at range end triangulates', () => {
    const f = oneRoomFloor();
    const { hi } = wallUsableRange(f, 'w1', { width: 0.9 });
    f.openings.o1 = { ...f.openings.o1!, offset: hi };
    let g: ReturnType<typeof build> | undefined;
    expect(() => {
      g = build(f, 'w1');
    }).not.toThrow();
    expect(Math.abs(area(g!, 'left') - (3.8 * 3.2 - 1.89))).toBeLessThan(5e-3);
  });

  it('overlapping openings do not crash', () => {
    const f = oneRoomFloor();
    f.openings.o9 = { ...f.openings.o1!, id: 'o9', offset: 1.5 };
    const g = build(f, 'w1');
    expectNear(area(g, 'left'), 10.27);
  });

  it('bbox', () => {
    const f = oneRoomFloor();
    f.elevation = 3.5;
    const g = build(f, 'w1');
    g.computeBoundingBox();
    expectNear(g.boundingBox!.min.y, 3.5);
    expectNear(g.boundingBox!.max.y, 3.5 + 3.2);
  });
});
