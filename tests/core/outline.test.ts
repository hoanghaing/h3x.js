import { describe, expect, it } from 'vitest';
import { floorOutline } from '../../src/core/floors/outline';
import { signedArea } from '../../src/core/geometry/polygon';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';
import { acuteFloor, courtyardFloor } from '../fixtures/irregular';

describe('floorOutline', () => {
  it('one room: a single outer ring grown to the outer wall faces', () => {
    const rings = floorOutline(oneRoomFloor());
    expect(rings).toHaveLength(1);
    const r = rings[0]!;
    expect(r.hole).toBe(false);
    expect(r.walls).toHaveLength(4);
    expect(r.points).toHaveLength(4);
    expect(r.centre).toHaveLength(4);
    const xs = r.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4.2, 6);
    expect(signedArea(r.points)).toBeGreaterThan(0);
  });

  it('two rooms: the shared wall drops out of the union outline', () => {
    const rings = floorOutline(twoRoomFloor());
    expect(rings).toHaveLength(1);
    expect(rings[0]!.points).toHaveLength(6);
    expect(rings[0]!.walls).not.toContain('w7');
  });

  it('roomIds restricts the outline to the chosen rooms', () => {
    const rings = floorOutline(twoRoomFloor(), ['r1']);
    expect(rings).toHaveLength(1);
    expect(rings[0]!.points).toHaveLength(4);
    expect(rings[0]!.walls).toContain('w7');
  });

  it('courtyard: one outer ring and one clockwise hole', () => {
    const rings = floorOutline(courtyardFloor());
    expect(rings.filter((r) => !r.hole)).toHaveLength(1);
    const holes = rings.filter((r) => r.hole);
    expect(holes).toHaveLength(1);
    expect(signedArea(holes[0]!.points)).toBeLessThan(0);
  });

  it('unknown room ids give no rings', () => {
    expect(floorOutline(twoRoomFloor(), ['nope'])).toEqual([]);
  });
});

describe('floorOutline bevels', () => {
  it('acuteFloor: every ring maps one wall to each edge', () => {
    for (const ring of floorOutline(acuteFloor())) {
      expect(ring.walls).toHaveLength(ring.points.length);
    }
  });
});
