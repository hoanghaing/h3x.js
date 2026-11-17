import { describe, expect, it } from 'vitest';
import { deriveStack, normalizeFloors } from '../../src/core/floors/stack';
import type { Floor, FloorProps, Project } from '../../src/core/types';

const fp = (
  id: string,
  level: number,
  elevation: number,
  wallHeight: number,
  slabThickness: number,
): FloorProps => ({ id, level, elevation, wallHeight, slabThickness });

function project(levels: number[], elevations: number[] = []): Project {
  return {
    version: 1,
    unit: 'm',
    meta: { name: '', created: '' },
    floors: levels.map(
      (level, i) =>
        ({
          id: `f${i}`,
          level,
          elevation: elevations[i] ?? 0,
          wallHeight: 3,
          slabThickness: 0.1,
        }) as Floor,
    ),
  };
}

describe('deriveStack', () => {
  it('derives levels and elevations around the ground floor', () => {
    const out = deriveStack(
      [fp('B', -1, 0, 2.8, 0.2), fp('G', 0, 0.45, 3.6, 0.15), fp('F1', 1, 0, 3.3, 0.12)],
      1,
      0.45,
    );
    expect(out.map((f) => f.level)).toEqual([-1, 0, 1]);
    expect(out[0]!.elevation).toBeCloseTo(0.45 - 0.15 - 2.8);
    expect(out[1]!.elevation).toBeCloseTo(0.45);
    expect(out[2]!.elevation).toBeCloseTo(0.45 + 3.6 + 0.12);
  });
});

describe('normalizeFloors', () => {
  const levels = (p: Project) => p.floors.map((f) => f.level);
  it('renumbers 1,2,3 to 0,1,2', () => {
    const p = project([1, 2, 3]);
    normalizeFloors(p);
    expect(levels(p)).toEqual([0, 1, 2]);
  });
  it('renumbers -1,1 to -1,0', () => {
    const p = project([-1, 1]);
    normalizeFloors(p);
    expect(levels(p)).toEqual([-1, 0]);
  });
  it('breaks level ties by file order', () => {
    const p = project([0, 0]);
    normalizeFloors(p);
    expect(levels(p)).toEqual([0, 1]);
    expect(p.floors.map((f) => f.id)).toEqual(['f0', 'f1']);
  });
  it('picks the highest floor as ground when all are negative', () => {
    const p = project([-3, -2]);
    normalizeFloors(p);
    expect(levels(p)).toEqual([-1, 0]);
  });
  it('sorts by level', () => {
    const p = project([2, 0]);
    normalizeFloors(p);
    expect(p.floors.map((f) => f.id)).toEqual(['f1', 'f0']);
  });
  it('keeps the ground elevation and recomputes the others', () => {
    const p = project([0, 1], [0.45, 99]);
    normalizeFloors(p);
    expect(p.floors[0]!.elevation).toBeCloseTo(0.45);
    expect(p.floors[1]!.elevation).toBeCloseTo(0.45 + 3 + 0.1);
  });
});
