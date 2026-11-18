import { describe, expect, it } from 'vitest';
import { weightedSkeleton } from '../../src/core/roofs/skeleton';
import type { SkeletonPatch, SkeletonResult } from '../../src/core/roofs/skeleton';
import { signedArea, isSimple } from '../../src/core/geometry/polygon';
import { floorOutline } from '../../src/core/floors/outline';
import { acuteFloor, trapezoidFloor } from '../fixtures/irregular';
import type { Vec2 } from '../../src/core/types';

type P3 = { x: number; y: number; z: number };

const pts = (...xy: [number, number][]): Vec2[] => xy.map(([x, y]) => ({ x, y }));
const rect = (w: number, h: number): Vec2[] => pts([0, 0], [w, 0], [w, h], [0, h]);
const ones = (rings: Vec2[][], s = 1): number[][] => rings.map((r) => r.map(() => s));

function okPatches(res: SkeletonResult): { patches: SkeletonPatch[]; maxHeight: number } {
  if (!res.ok) throw new Error(`skeleton failed: ${res.reason}`);
  return res;
}

const planArea = (poly: P3[]): number => signedArea(poly.map((p) => ({ x: p.x, y: p.y })));

/** Sum of projected (plan) areas of the sloped patches. */
function slopedArea(patches: SkeletonPatch[]): number {
  return patches
    .map((p) => planArea(p.polygon))
    .filter((a) => Math.abs(a) > 1e-9)
    .reduce((s, a) => s + a, 0);
}

function newell(poly: P3[]): P3 {
  const n = { x: 0, y: 0, z: 0 };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  });
  return n;
}

function expectPlanar(poly: P3[]): void {
  expect(poly.length).toBeGreaterThanOrEqual(3);
  const n = newell(poly);
  const len = Math.hypot(n.x, n.y, n.z);
  expect(len).toBeGreaterThan(1e-12);
  const u = { x: n.x / len, y: n.y / len, z: n.z / len };
  const o = poly[0]!;
  for (const p of poly) {
    const d = (p.x - o.x) * u.x + (p.y - o.y) * u.y + (p.z - o.z) * u.z;
    expect(Math.abs(d)).toBeLessThan(1e-6);
  }
}

/** Pitch of a patch in degrees (90 = vertical). */
function pitchOf(poly: P3[]): number {
  const n = newell(poly);
  return (Math.acos(Math.abs(n.z) / Math.hypot(n.x, n.y, n.z)) * 180) / Math.PI;
}

function hasPoint(poly: P3[], x: number, y: number, z: number): boolean {
  return poly.some(
    (p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6 && Math.abs(p.z - z) < 1e-6,
  );
}

function checkAll(
  res: SkeletonResult,
  area: number,
): { patches: SkeletonPatch[]; maxHeight: number } {
  const r = okPatches(res);
  r.patches.forEach((p) => expectPlanar(p.polygon));
  expect(slopedArea(r.patches)).toBeCloseTo(area, 6);
  return r;
}

const patchesOf = (patches: SkeletonPatch[], edge: number, ring = 0): SkeletonPatch[] =>
  patches.filter((p) => p.ring === ring && p.edge === edge);

describe('weightedSkeleton', () => {
  it('hips a 6x4 rectangle with a ridge from (2,2) to (4,2)', () => {
    const ring = rect(6, 4);
    const { patches, maxHeight } = checkAll(
      weightedSkeleton({ rings: [ring], speed: ones([ring]) }),
      24,
    );
    expect(maxHeight).toBeCloseTo(2, 6);
    expect(patches).toHaveLength(4);
    for (const e of [0, 2]) {
      const [p] = patchesOf(patches, e);
      expect(hasPoint(p!.polygon, 2, 2, 2)).toBe(true);
      expect(hasPoint(p!.polygon, 4, 2, 2)).toBe(true);
    }
    for (const e of [1, 3]) expect(patchesOf(patches, e)[0]!.polygon).toHaveLength(3);
  });

  it('makes a pyramid on a 4x4 square', () => {
    const ring = rect(4, 4);
    const { patches, maxHeight } = checkAll(
      weightedSkeleton({ rings: [ring], speed: ones([ring]) }),
      16,
    );
    expect(maxHeight).toBeCloseTo(2, 6);
    expect(patches).toHaveLength(4);
    patches.forEach((p) => {
      expect(p.polygon).toHaveLength(3);
      expect(hasPoint(p.polygon, 2, 2, 2)).toBe(true);
    });
  });

  it('keeps gable edges vertical with a full-length ridge', () => {
    const ring = rect(6, 4);
    const { patches, maxHeight } = checkAll(
      weightedSkeleton({ rings: [ring], speed: [[1, 0, 1, 0]] }),
      24,
    );
    expect(maxHeight).toBeCloseTo(2, 6);
    expect(patches).toHaveLength(4);
    for (const e of [0, 2]) {
      const [p] = patchesOf(patches, e);
      expect(p!.polygon).toHaveLength(4);
      expect(hasPoint(p!.polygon, 0, 2, 2)).toBe(true);
      expect(hasPoint(p!.polygon, 6, 2, 2)).toBe(true);
    }
    for (const e of [1, 3]) {
      const [p] = patchesOf(patches, e);
      expect(p!.polygon).toHaveLength(3);
      expect(Math.abs(planArea(p!.polygon))).toBeLessThan(1e-9);
      expect(pitchOf(p!.polygon)).toBeCloseTo(90, 6);
    }
    expect(hasPoint(patchesOf(patches, 1)[0]!.polygon, 6, 2, 2)).toBe(true);
    expect(hasPoint(patchesOf(patches, 3)[0]!.polygon, 0, 2, 2)).toBe(true);
  });

  it('builds a shed from one sloped edge', () => {
    const ring = rect(6, 4);
    const { patches, maxHeight } = checkAll(
      weightedSkeleton({ rings: [ring], speed: [[1, 0, 0, 0]] }),
      24,
    );
    expect(maxHeight).toBeCloseTo(4, 6);
    const sloped = patches.filter((p) => Math.abs(planArea(p.polygon)) > 1e-9);
    expect(sloped).toHaveLength(1);
    expect(sloped[0]!.edge).toBe(0);
    expect(Math.max(...sloped[0]!.polygon.map((p) => p.z))).toBeCloseTo(4, 6);
    expect(hasPoint(sloped[0]!.polygon, 0, 4, 4)).toBe(true);
    expect(hasPoint(sloped[0]!.polygon, 6, 4, 4)).toBe(true);
  });

  it('puts one valley on the reflex corner of an L', () => {
    const ring = pts([0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]);
    const { patches, maxHeight } = checkAll(
      weightedSkeleton({ rings: [ring], speed: ones([ring]) }),
      27,
    );
    expect(maxHeight).toBeCloseTo(1.5, 6);
    for (const e of [2, 3]) {
      const ps = patchesOf(patches, e);
      expect(ps).toHaveLength(1);
      expect(hasPoint(ps[0]!.polygon, 3, 3, 0)).toBe(true);
      expect(hasPoint(ps[0]!.polygon, 1.5, 1.5, 1.5)).toBe(true);
    }
  });

  it('roofs U and T shapes with planar patches covering the plan', () => {
    const u = pts([0, 0], [9, 0], [9, 6], [6, 6], [6, 2], [3, 2], [3, 6], [0, 6]);
    const t = pts([3, 0], [6, 0], [6, 4], [9, 4], [9, 7], [0, 7], [0, 4], [3, 4]);
    for (const ring of [u, t]) {
      const { patches } = checkAll(
        weightedSkeleton({ rings: [ring], speed: ones([ring]) }),
        signedArea(ring),
      );
      // One face per input edge on these plans.
      ring.forEach((_, e) => expect(patchesOf(patches, e).length).toBeGreaterThanOrEqual(1));
    }
  });

  it('roofs a square with a centred hole', () => {
    const outer = rect(10, 10);
    const hole = pts([4, 4], [4, 6], [6, 6], [6, 4]);
    const { maxHeight } = checkAll(
      weightedSkeleton({ rings: [outer, hole], speed: ones([outer, hole]) }),
      96,
    );
    expect(maxHeight).toBeCloseTo(2, 6);
  });

  it('switches to the upper pitch at a mansard break', () => {
    const ring = rect(8, 6);
    const lower = 1 / Math.tan((70 * Math.PI) / 180);
    const upper = 1 / Math.tan((30 * Math.PI) / 180);
    const { patches, maxHeight } = checkAll(
      weightedSkeleton({
        rings: [ring],
        speed: ones([ring], lower),
        breakAt: { at: 1.5, upper: ones([ring], upper) },
      }),
      48,
    );
    expect(maxHeight).toBeGreaterThan(1.5);
    const below = patches.filter((p) => Math.max(...p.polygon.map((q) => q.z)) <= 1.5 + 1e-9);
    const above = patches.filter((p) => Math.min(...p.polygon.map((q) => q.z)) >= 1.5 - 1e-9);
    expect(below).toHaveLength(4);
    expect(below.length + above.length).toBe(patches.length);
    below.forEach((p) => expect(pitchOf(p.polygon)).toBeCloseTo(70, 6));
    above.forEach((p) => expect(pitchOf(p.polygon)).toBeCloseTo(30, 6));
  });

  it('roofs the trapezoid and acute fixture outlines', () => {
    for (const floor of [trapezoidFloor(), acuteFloor()]) {
      const ring = floorOutline(floor)[0]!.points;
      checkAll(weightedSkeleton({ rings: [ring], speed: ones([ring]) }), signedArea(ring));
    }
  });

  it('steps vertically between collinear edges of different pitch', () => {
    const ring = pts([0, 0], [3, 0], [6, 0], [6, 4], [0, 4]);
    const { patches } = checkAll(
      weightedSkeleton({ rings: [ring], speed: [[1, 0.5, 1, 1, 1]] }),
      24,
    );
    // The step between edge 0 and edge 1 is a vertical patch at x = 3.
    const step = patches.filter(
      (p) =>
        Math.abs(planArea(p.polygon)) < 1e-9 && p.polygon.every((q) => Math.abs(q.x - 3) < 1e-9),
    );
    expect(step.length).toBeGreaterThanOrEqual(1);
    step.forEach((p) => expect(pitchOf(p.polygon)).toBeCloseTo(90, 6));
  });

  it('caps a region walled in by gables with a flat patch', () => {
    // Gables on the reflex corner of an L leave a strip no slope sweeps.
    const ring = pts([3.5, 4.5], [7.5, 4.5], [7.5, 8.5], [1, 8.5], [1, 2.5], [3.5, 2.5]);
    const { patches } = checkAll(
      weightedSkeleton({ rings: [ring], speed: [[0, 0, 0, 1, 1, 0]] }),
      signedArea(ring),
    );
    expect(patches.some((p) => pitchOf(p.polygon) < 1e-6)).toBe(true);
  });

  it('rejects self-intersecting input and all-gable input', () => {
    const bow = pts([0, 0], [2, 2], [2, 0], [0, 2]);
    expect(weightedSkeleton({ rings: [bow], speed: ones([bow]) })).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    const two = pts([0, 0], [1, 0]);
    expect(weightedSkeleton({ rings: [two], speed: [[1, 1]] })).toEqual({
      ok: false,
      reason: 'invalid-input',
    });
    const ring = rect(6, 4);
    expect(weightedSkeleton({ rings: [ring], speed: ones([ring], 0) })).toEqual({
      ok: false,
      reason: 'degenerate',
    });
  });

  it('roofs random rectilinear polygons', () => {
    let tested = 0;
    for (let seed = 1; tested < 50; seed++) {
      const ring = randomRectilinear(seed);
      if (!ring) continue;
      tested++;
      const res = weightedSkeleton({ rings: [ring], speed: ones([ring]) });
      if (!res.ok) throw new Error(`seed ${seed}: ${res.reason} ${JSON.stringify(ring)}`);
      res.patches.forEach((p) => expectPlanar(p.polygon));
      const a = slopedArea(res.patches);
      if (Math.abs(a - signedArea(ring)) > 1e-6) {
        throw new Error(`seed ${seed}: area ${a} vs ${signedArea(ring)} ${JSON.stringify(ring)}`);
      }
    }
  });
});

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random simple rectilinear polygon (4-12 vertices, CCW) traced around a
 * random polyomino on an uneven grid; null when the attempt is unusable.
 */
function randomRectilinear(seed: number): Vec2[] | null {
  const rnd = mulberry32(seed);
  const size = 5;
  const xs = [0];
  const ys = [0];
  for (let i = 0; i < size; i++) {
    xs.push(xs[i]! + 1 + Math.floor(rnd() * 5) * 0.5);
    ys.push(ys[i]! + 1 + Math.floor(rnd() * 5) * 0.5);
  }
  const cells = new Set<string>([`${Math.floor(size / 2)},${Math.floor(size / 2)}`]);
  const target = 2 + Math.floor(rnd() * 8);
  for (let guard = 0; cells.size < target && guard < 200; guard++) {
    const list = [...cells];
    const [cx, cy] = list[Math.floor(rnd() * list.length)]!.split(',').map(Number) as [
      number,
      number,
    ];
    const dir = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ][Math.floor(rnd() * 4)]!;
    const nx = cx + dir[0]!;
    const ny = cy + dir[1]!;
    if (nx >= 0 && ny >= 0 && nx < size && ny < size) cells.add(`${nx},${ny}`);
  }
  const has = (x: number, y: number): boolean => cells.has(`${x},${y}`);
  // Directed unit boundary edges with the cells on the left (CCW).
  const next = new Map<string, string[]>();
  const push = (a: [number, number], b: [number, number]): void => {
    const k = `${a[0]},${a[1]}`;
    next.set(k, [...(next.get(k) ?? []), `${b[0]},${b[1]}`]);
  };
  for (const c of cells) {
    const [x, y] = c.split(',').map(Number) as [number, number];
    if (!has(x, y - 1)) push([x, y], [x + 1, y]);
    if (!has(x + 1, y)) push([x + 1, y], [x + 1, y + 1]);
    if (!has(x, y + 1)) push([x + 1, y + 1], [x, y + 1]);
    if (!has(x - 1, y)) push([x, y + 1], [x, y]);
  }
  if ([...next.values()].some((v) => v.length > 1)) return null; // pinch
  const start = next.keys().next().value as string;
  const loop: [number, number][] = [];
  let cur = start;
  do {
    loop.push(cur.split(',').map(Number) as [number, number]);
    cur = next.get(cur)![0]!;
  } while (cur !== start && loop.length <= next.size);
  if (loop.length !== next.size) return null; // hole -> more than one loop
  const corners = loop.filter((p, i) => {
    const a = loop[(i + loop.length - 1) % loop.length]!;
    const b = loop[(i + 1) % loop.length]!;
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
  if (corners.length < 4 || corners.length > 12) return null;
  const ring = corners.map(([i, j]) => ({ x: xs[i]!, y: ys[j]! }));
  return isSimple(ring) && signedArea(ring) > 0 ? ring : null;
}
