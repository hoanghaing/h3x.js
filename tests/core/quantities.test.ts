// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  floorQuantities,
  projectQuantities,
  type Floor,
  type Project,
} from '../../src/core';
import { oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';

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
        }
      }
    },
  );
});
