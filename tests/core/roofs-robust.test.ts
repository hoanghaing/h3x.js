import { afterEach, describe, expect, it, vi } from 'vitest';
import * as outline from '../../src/core/floors/outline';
import { pointInPolygon, signedArea } from '../../src/core/geometry/polygon';
import { buildRoof } from '../../src/core/roofs/geometry';
import * as skeleton from '../../src/core/roofs/skeleton';
import type { Roof } from '../../src/core/types';
import { courtyardFloor } from '../fixtures/irregular';

vi.mock('../../src/core/roofs/skeleton', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/core/roofs/skeleton')>();
  return { ...mod, weightedSkeleton: vi.fn(mod.weightedSkeleton) };
});
vi.mock('../../src/core/floors/outline', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/core/floors/outline')>();
  return { ...mod, floorOutline: vi.fn(mod.floorOutline) };
});

afterEach(() => {
  vi.mocked(skeleton.weightedSkeleton).mockRestore();
  vi.mocked(outline.floorOutline).mockRestore();
});

const flatRoof = (rooms: string[], p: Partial<Roof> = {}): Roof => ({
  id: 'R1',
  kind: 'flat',
  follow: true,
  rooms,
  pitch: 30,
  base: 0,
  overhang: 0.5,
  gableOverhang: 0.3,
  thickness: 0.1,
  material: 'concrete',
  ...p,
});

describe('flat roof over a light well', () => {
  it('keeps the well open without the straight skeleton', () => {
    vi.mocked(skeleton.weightedSkeleton).mockReturnValue({ ok: false } as never);
    const f = courtyardFloor();
    const built = buildRoof(flatRoof(Object.keys(f.rooms)), f);
    expect(built.issue).toBeUndefined();
    expect(built.geometry.ok).toBe(true);
    const [b] = built.geometry.bodies;
    const centre = { x: 4, y: 4.5 };
    for (const face of b!.faces) {
      expect(pointInPolygon(centre, face.polygon)).toBe(false);
    }
    // the slab covers the grown outer ring minus the grown well, nothing more
    const plan = b!.faces.reduce((s, x) => s + Math.abs(signedArea(x.polygon)), 0);
    const [outer, well] = b!.overhangOutline;
    expect(plan).toBeCloseTo(Math.abs(signedArea(outer!)) - Math.abs(signedArea(well!)), 6);
  });

  it('with no overhang the slab is the outline minus the well', () => {
    const f = courtyardFloor();
    const [b] = buildRoof(flatRoof(Object.keys(f.rooms), { overhang: 0 }), f).geometry.bodies;
    const plan = b!.faces.reduce((s, x) => s + Math.abs(signedArea(x.polygon)), 0);
    expect(plan).toBeCloseTo(8.2 * 9.2 - 1.8 * 2.8, 6);
  });
});

describe('buildRoof never throws', () => {
  it('turns an unexpected error into a failed flat roof', () => {
    vi.mocked(outline.floorOutline).mockImplementation(() => {
      throw new Error('boom');
    });
    const f = courtyardFloor();
    let built!: ReturnType<typeof buildRoof>;
    expect(
      () => (built = buildRoof(flatRoof(Object.keys(f.rooms), { kind: 'pitched' }), f)),
    ).not.toThrow();
    expect(built.geometry.ok).toBe(false);
    expect(built.issue?.code).toBe('roof-build-failed');
    expect(built.gables).toEqual([]);
  });

  it('an independent roof keeps its flat fallback body', () => {
    vi.mocked(skeleton.weightedSkeleton).mockImplementation(() => {
      throw new Error('boom');
    });
    const f = courtyardFloor();
    const points = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const built = buildRoof(
      flatRoof([], {
        kind: 'pitched',
        follow: false,
        rooms: undefined,
        points,
        edges: points.map(() => ({ kind: 'slope' as const, pitch: 30 })),
      }),
      f,
    );
    expect(built.issue?.code).toBe('roof-build-failed');
    expect(built.geometry.bodies).toHaveLength(1);
  });
});
