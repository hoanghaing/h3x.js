// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  estimate,
  floorQuantities,
  projectQuantities,
  type Floor,
  type Project,
} from '../../src/core';
import { oneRoomFloor } from '../fixtures/floors';

const project = (...floors: Floor[]): Project =>
  ({
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors,
  }) as Project;

describe('estimate', () => {
  it('prices each quantity by its unit price', () => {
    const q = floorQuantities(oneRoomFloor());
    const e = estimate(q, {
      masonry: 1000,
      plaster: 10,
      paintInterior: 2,
      paintExterior: 3,
      slab: 2000,
      flooring: 50,
      ceiling: 20,
      skirting: 5,
    });
    const line = (key: string) => e.lines.find((l) => l.key === key)!;
    expect(line('masonry')).toMatchObject({ unit: 'm3', unitPrice: 1000 });
    expect(line('masonry').quantity).toBeCloseTo(q.totals.wallVolume, 9);
    expect(line('masonry').cost).toBeCloseTo(q.totals.wallVolume * 1000, 6);
    expect(line('plaster').quantity).toBeCloseTo(
      q.totals.paintInterior + q.totals.paintExterior,
      9,
    );
    expect(line('paintExterior').unit).toBe('m2');
    expect(line('slab').quantity).toBeCloseTo(q.totals.slabVolume, 9);
    expect(line('flooring').quantity).toBeCloseTo(3.8 * 3.8, 9);
    expect(line('ceiling').quantity).toBeCloseTo(3.8 * 3.8, 9);
    expect(line('skirting')).toMatchObject({ unit: 'm' });
    expect(line('skirting').quantity).toBeCloseTo(4 * 3.8, 9);
    expect(e.total).toBeCloseTo(
      e.lines.reduce((s, l) => s + l.cost, 0),
      6,
    );
  });

  it('leaves out keys without a price', () => {
    const e = estimate(floorQuantities(oneRoomFloor()), { flooring: 50 });
    expect(e.lines.map((l) => l.key)).toEqual(['flooring']);
    expect(e.total).toBeCloseTo(3.8 * 3.8 * 50, 6);
  });

  it('is empty for an empty table', () => {
    const e = estimate(floorQuantities(oneRoomFloor()), {});
    expect(e.lines).toEqual([]);
    expect(e.total).toBe(0);
  });

  it('prices openings per set, preset before type', () => {
    const f = oneRoomFloor();
    f.openings.o2 = { ...f.openings.o1!, id: 'o2', wall: 'w3', offset: 2 };
    f.openings.o3 = { ...f.openings.o1!, id: 'o3', wall: 'w2', preset: 'door-other', offset: 2 };
    const e = estimate(floorQuantities(f), {
      openings: { byPreset: { 'door-single-01': 300 }, byType: { 'door-swing': 100 } },
    });
    const doors = e.lines.filter((l) => l.key === 'opening');
    expect(doors).toHaveLength(2);
    const single = doors.find((l) => l.preset === 'door-single-01')!;
    expect(single).toMatchObject({ unit: 'set', quantity: 2, unitPrice: 300, cost: 600 });
    expect(single).toMatchObject({ type: 'door-swing', width: 0.9, height: 2.1 });
    expect(doors.find((l) => l.preset === 'door-other')).toMatchObject({ quantity: 1, cost: 100 });
    expect(e.unpriced).toEqual([]);
    expect(e.total).toBe(700);
  });

  it('lists opening groups without a price', () => {
    const e = estimate(floorQuantities(oneRoomFloor()), { flooring: 1 });
    expect(e.unpriced).toEqual([expect.objectContaining({ preset: 'door-single-01', count: 1 })]);
    expect(e.lines.some((l) => l.key === 'opening')).toBe(false);
  });

  it('adds up every floor of a project, merging opening groups', () => {
    const f2 = { ...oneRoomFloor(), id: 'f2', level: 1, elevation: 3.35 };
    const q = projectQuantities(project(oneRoomFloor(), f2));
    const e = estimate(q, { flooring: 10, openings: { byType: { 'door-swing': 100 } } });
    expect(e.lines.find((l) => l.key === 'flooring')!.quantity).toBeCloseTo(2 * 3.8 * 3.8, 9);
    const doors = e.lines.filter((l) => l.key === 'opening');
    expect(doors).toHaveLength(1);
    expect(doors[0]!.quantity).toBe(2);
    expect(q.totals.skirting).toBeCloseTo(2 * 4 * 3.8, 9);
  });
});
