// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  floorQuantities,
  projectQuantities,
  type Floor,
  type Project,
  type Stair,
} from '../../src/core';
import { signedArea } from '../../src/core/geometry/polygon';
import { stairOutline } from '../../src/core/stairs/layout';
import { oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';

const stair = (x: number, y: number): Stair => ({
  id: 's1',
  x,
  y,
  width: 1,
  depth: 3,
  rotation: 0,
  type: 'straight',
  turn: 'landing',
  hand: 'left',
  flightWidth: 1,
});
const above = (): Floor => ({ ...oneRoomFloor(), id: 'f2', level: 1, elevation: 3.35 });

const project = (...floors: Floor[]): Project =>
  ({
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors,
  }) as Project;

describe('floorQuantities', () => {
  it('measures walls, net of their openings', () => {
    const q = floorQuantities(oneRoomFloor());
    const w1 = q.walls.find((w) => w.id === 'w1')!;
    expect(w1.length).toBeCloseTo(4, 9);
    expect(w1.grossArea).toBeCloseTo(12.8, 9);
    expect(w1.openingArea).toBeCloseTo(0.9 * 2.1, 9);
    expect(w1.netArea).toBeCloseTo(12.8 - 1.89, 9);
    const w2 = q.walls.find((w) => w.id === 'w2')!;
    expect(w2.openingArea).toBe(0);
    expect(q.totals.wallLength).toBeCloseTo(16, 9);
    expect(q.totals.wallNetArea).toBeCloseTo(4 * 12.8 - 1.89, 9);
  });

  it('counts wall volume once at the corners', () => {
    // Joined outlines: a 4.2 m square minus a 3.8 m square, 3.2 m high, less the door.
    const q = floorQuantities(oneRoomFloor());
    expect(q.totals.wallVolume).toBeCloseTo((4.2 ** 2 - 3.8 ** 2) * 3.2 - 1.89 * 0.2, 6);
  });

  it('measures room floors between the walls', () => {
    const q = floorQuantities(twoRoomFloor());
    expect(q.rooms.map((r) => r.id).sort()).toEqual(['r1', 'r2']);
    for (const r of q.rooms) expect(r.area).toBeCloseTo(3.8 * 3.8, 6);
    expect(q.rooms.find((r) => r.id === 'r1')!.name).toBe('Room 1');
    expect(q.totals.floorArea).toBeCloseTo(2 * 3.8 * 3.8, 6);
  });

  it('measures the slab to the outer wall faces', () => {
    const q = floorQuantities(oneRoomFloor());
    expect(q.slab.area).toBeCloseTo(4.2 ** 2, 9);
    expect(q.slab.holeArea).toBe(0);
    expect(q.slab.volume).toBeCloseTo(4.2 ** 2 * 0.15, 9);
    expect(q.totals.slabArea).toBeCloseTo(4.2 ** 2, 9);
    expect(q.totals.slabVolume).toBeCloseTo(4.2 ** 2 * 0.15, 9);
  });

  it('cuts the stair holes of the floor below out of the slab', () => {
    const below = oneRoomFloor();
    below.stairs.s1 = stair(2, 2);
    const q = floorQuantities(above(), below);
    const hole = Math.abs(signedArea(stairOutline(below.stairs.s1, 3.35)));
    expect(q.slab.holeArea).toBeCloseTo(hole, 9);
    expect(q.slab.area).toBeCloseTo(4.2 ** 2 - hole, 9);
  });

  it('deducts only the part of a stair inside the slab', () => {
    const below = oneRoomFloor();
    below.stairs.s1 = stair(4.1, 2);
    const q = floorQuantities(above(), below);
    const hole = Math.abs(signedArea(stairOutline(below.stairs.s1, 3.35)));
    expect(q.slab.holeArea).toBeGreaterThan(0);
    expect(q.slab.holeArea).toBeLessThan(hole - 1e-6);
    expect(q.slab.area + q.slab.holeArea).toBeCloseTo(4.2 ** 2, 9);
  });

  it('measures each wall face', () => {
    const q = floorQuantities(oneRoomFloor());
    const w2 = q.walls.find((w) => w.id === 'w2')!;
    expect(w2.faces.left.side).toBe('interior');
    expect(w2.faces.left.length).toBeCloseTo(3.8, 9);
    expect(w2.faces.left.grossArea).toBeCloseTo(3.8 * 3.2, 9);
    expect(w2.faces.right.side).toBe('exterior');
    expect(w2.faces.right.length).toBeCloseTo(4.2, 9);
    const w1 = q.walls.find((w) => w.id === 'w1')!;
    expect(w1.faces.left.openingArea).toBeCloseTo(1.89, 9);
    expect(w1.faces.right.netArea).toBeCloseTo(4.2 * 3.2 - 1.89, 9);
    expect(q.totals.paintInterior).toBeCloseTo(4 * 3.8 * 3.2 - 1.89, 9);
    expect(q.totals.paintExterior).toBeCloseTo(4 * 4.2 * 3.2 - 1.89, 9);
  });

  it('a wall between two rooms is interior on both faces', () => {
    const w7 = floorQuantities(twoRoomFloor()).walls.find((w) => w.id === 'w7')!;
    expect(w7.faces.left.side).toBe('interior');
    expect(w7.faces.right.side).toBe('interior');
  });

  it('a wall with no room is exterior on both faces', () => {
    const f = oneRoomFloor();
    f.rooms = {};
    f.openings = {};
    const q = floorQuantities(f);
    for (const w of q.walls) {
      expect(w.faces.left.side).toBe('exterior');
      expect(w.faces.right.side).toBe('exterior');
    }
    expect(q.totals.paintInterior).toBe(0);
    expect(q.slab).toEqual({ area: 0, holeArea: 0, volume: 0 });
  });

  it('measures room perimeters between the walls', () => {
    expect(floorQuantities(oneRoomFloor()).rooms[0]!.perimeter).toBeCloseTo(4 * 3.8, 9);
  });

  it('groups openings by type, preset and size', () => {
    const f = oneRoomFloor();
    f.openings.o2 = { ...f.openings.o1!, id: 'o2', wall: 'w3', offset: 2 };
    f.openings.o3 = {
      id: 'o3',
      wall: 'w2',
      preset: 'window-sliding-01',
      type: 'window-sliding',
      offset: 2,
      width: 1.2,
      height: 1.4,
      sill: 0.9,
      leaves: 2,
      hinge: 'a',
      swing: 'left',
    };
    const q = floorQuantities(f);
    expect(q.openings.map((o) => ({ ...o, area: undefined }))).toEqual([
      {
        type: 'door-swing',
        preset: 'door-single-01',
        width: 0.9,
        height: 2.1,
        count: 2,
        area: undefined,
      },
      {
        type: 'window-sliding',
        preset: 'window-sliding-01',
        width: 1.2,
        height: 1.4,
        count: 1,
        area: undefined,
      },
    ]);
    expect(q.openings[0]!.area).toBeCloseTo(2 * 1.89, 9);
    expect(q.openings[1]!.area).toBeCloseTo(1.68, 9);
    expect(q.totals.openingCount).toBe(3);
    expect(q.totals.openingArea).toBeCloseTo(2 * 1.89 + 1.68, 9);
  });

  it('takes off only the part of an opening inside its wall', () => {
    const f = oneRoomFloor();
    // Half past the end of the wall, and taller than it.
    f.openings.o1 = { ...f.openings.o1!, offset: 4, height: 4 };
    const w1 = floorQuantities(f).walls.find((w) => w.id === 'w1')!;
    expect(w1.openingArea).toBeCloseTo(0.45 * 3.2, 9);
  });

  it('has no roofs and no NaN on an empty floor', () => {
    const f = oneRoomFloor();
    f.nodes = {};
    f.walls = {};
    f.openings = {};
    f.rooms = {};
    const q = floorQuantities(f);
    expect(q.walls).toEqual([]);
    expect(q.roofs).toEqual([]);
    expect(Object.values(q.totals).every((v) => Number.isFinite(v))).toBe(true);
  });
});

describe('roof areas', () => {
  it('a flat roof covers at least its plan; a pitched one more', () => {
    const base = {
      follow: true,
      rooms: ['r1'],
      base: 0,
      overhang: 0,
      gableOverhang: 0,
      thickness: 0.1,
      material: 'tile' as const,
    };
    const flat = oneRoomFloor();
    flat.roofs.r = { ...base, id: 'r', kind: 'flat', pitch: 45 };
    const pitched = oneRoomFloor();
    pitched.roofs.r = { ...base, id: 'r', kind: 'pitched', pitch: 30 };
    const a = floorQuantities(flat).roofs[0]!.area;
    const b = floorQuantities(pitched).roofs[0]!.area;
    expect(a).toBeCloseTo(4.2 * 4.2, 3);
    expect(b).toBeCloseTo((4.2 * 4.2) / Math.cos((30 * Math.PI) / 180), 3);
  });
});

describe('projectQuantities', () => {
  it('lists every floor and sums them', () => {
    const f2 = { ...oneRoomFloor(), id: 'f2', level: 1, elevation: 3.35 };
    const q = projectQuantities(project(oneRoomFloor(), f2));
    expect(q.floors.map((f) => f.floorId)).toEqual(['f1', 'f2']);
    expect(q.totals.wallLength).toBeCloseTo(32, 9);
    expect(q.totals.openingCount).toBe(2);
    expect(q.totals.floorArea).toBeCloseTo(2 * 3.8 * 3.8, 6);
  });

  it('cuts each slab by the stairs of the floor below', () => {
    const f1 = oneRoomFloor();
    f1.stairs.s1 = stair(2, 2);
    const q = projectQuantities(project(f1, above()));
    expect(q.floors[0]!.slab.holeArea).toBe(0);
    expect(q.floors[1]!.slab.holeArea).toBeGreaterThan(0);
    expect(q.totals.slabArea).toBeCloseTo(2 * 4.2 ** 2 - q.floors[1]!.slab.holeArea, 9);
  });
});

describe('sample layouts', () => {
  it.each(['townhouse-3f.xml', 'townhouse-trapezoid.xml'])(
    '%s measures finite, positive amounts',
    (name) => {
      const doc = H3xDocument.fromXML(readFileSync(`examples/layouts/${name}`, 'utf8'), {
        presets: testPresets,
      });
      const q = projectQuantities(doc.project);
      for (const v of Object.values(q.totals)) expect(Number.isFinite(v)).toBe(true);
      expect(q.totals.wallLength).toBeGreaterThan(0);
      expect(q.totals.floorArea).toBeGreaterThan(0);
      expect(q.totals.openingCount).toBeGreaterThan(0);
      for (const f of q.floors) {
        for (const w of f.walls) {
          expect(w.netArea).toBeGreaterThanOrEqual(0);
          expect(w.volume).toBeGreaterThan(0);
          expect(w.faces.left.netArea).toBeGreaterThanOrEqual(0);
          expect(w.faces.right.netArea).toBeGreaterThanOrEqual(0);
        }
        if (f.rooms.length > 0) expect(f.slab.area).toBeGreaterThan(0);
      }
    },
  );
});
