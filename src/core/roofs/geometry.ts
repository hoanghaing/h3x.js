import { GEOM_TOL, MITER_LIMIT } from '../constants';
import { floorOutline } from '../floors/outline';
import { growPolygon, isSimple, pointInPolygon, signedArea } from '../geometry/polygon';
import { closestPointOnSegment, segmentsIntersect } from '../geometry/segment';
import { wallOutlines } from '../shapes';
import type { Floor, Id, Roof, RoofEdge, Vec2 } from '../types';
import { weightedSkeleton, type SkeletonInput } from './skeleton';

/** A 3D point; z = absolute height (world up). */
export type Vec3 = { x: number; y: number; z: number };

/**
 * One planar piece of a roof underside. `ring` / `edge` name the source outline edge
 * (`-1` for pieces with no source edge: flat slabs and horizontal caps). Non-vertical
 * polygons are wound counter-clockwise seen from above. `slope` is true for inclined faces
 * only: gable / step verticals, caps and flat slabs are `slope: false` with `pitch: 0`.
 * `pitch` is the pitch of the source edge at that height, degrees (the upper pitch above a
 * break).
 */
export interface RoofFace {
  ring: number;
  edge: number;
  wallId?: Id;
  slope: boolean;
  polygon: Vec3[];
  pitch: number;
}

export type RoofLineKind = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';

export interface RoofBody {
  /** Outer ring (CCW) then holes (CW), at eaves level (outer wall faces). */
  outline: Vec2[][];
  /** The outline grown by the overhang (slope edges) / rake (gable edges), holes included. */
  overhangOutline: Vec2[][];
  /** Every face, overhang / rake strips included; gable verticals have `slope: false`. */
  faces: RoofFace[];
  lines: { kind: RoofLineKind; a: Vec3; b: Vec3 }[];
  posts: { x: number; y: number; bottom: number; top: number }[];
  /** Flat roofs: parapet segments along the outline, standing on the slab top. */
  parapets: { a: Vec2; b: Vec2; bottom: number; top: number }[];
}

/** `ok: false` means at least one body is a flat fallback (see `validateRoofs`). */
export type RoofGeometry = { ok: boolean; bodies: RoofBody[] };

export type RoofIssueCode = 'roof-invalid-outline' | 'roof-no-walls' | 'roof-build-failed';

/** Distance (m) under which an outline vertex counts as standing on a wall (no post). */
const POST_WALL_TOL = 0.05;
/** Distance (m) a gable face may stray from a wall's outer-face line in `gableProfile`. */
const GABLE_WALL_TOL = 0.01;
const DEFAULT_POST_SPACING = 3;
/** Numeric tolerance for coincidence tests on computed geometry. */
const TOL = 1e-6;
const TINY = 1e-9;

const rad = (deg: number): number => (deg * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const at = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length] as T;
const v3 = (p: Vec2, z: number): Vec3 => ({ x: p.x, y: p.y, z });
const plan = (p: Vec3): Vec2 => ({ x: p.x, y: p.y });

/** The roof outline as rings with one edge spec and (follow mode) one wall id per edge. */
interface Plan {
  rings: Vec2[][];
  specs: RoofEdge[][];
  walls: (Id | undefined)[][];
}

interface Built {
  geometry: RoofGeometry;
  issue?: { code: RoofIssueCode; message: string };
  /** Gable vertical faces, for `gableProfile`. */
  gables: Vec3[][];
}

function newell(poly: Vec3[]): Vec3 {
  const n = { x: 0, y: 0, z: 0 };
  poly.forEach((a, i) => {
    const b = at(poly, i + 1);
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  });
  return n;
}

/** True sloped area of a face (m²). */
export function roofFaceArea(face: RoofFace): number {
  const n = newell(face.polygon);
  return Math.hypot(n.x, n.y, n.z) / 2;
}

const isVertical = (poly: Vec3[]): boolean => {
  const n = newell(poly);
  const len = Math.hypot(n.x, n.y, n.z);
  return len < TINY || Math.abs(n.z) / len < TOL;
};

/** Height of the (non-vertical) plane of `poly` above plan point `p`. */
function planeZ(poly: Vec3[], p: Vec2): number {
  const n = newell(poly);
  const o = poly[0]!;
  return o.z - (n.x * (p.x - o.x) + n.y * (p.y - o.y)) / n.z;
}

/** Drops consecutive duplicates; null when fewer than 3 points or no area remain. */
function clean(poly: Vec3[]): Vec3[] | null {
  const out: Vec3[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > TINY) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > TINY) break;
    out.pop();
  }
  if (out.length < 3) return null;
  const n = newell(out);
  return Math.hypot(n.x, n.y, n.z) / 2 > 1e-10 ? out : null;
}

/** Non-vertical faces wound CCW from above. */
function orient(poly: Vec3[]): Vec3[] {
  if (isVertical(poly)) return poly;
  return signedArea(poly.map(plan)) < 0 ? [...poly].reverse() : poly;
}

function defaultEdge(roof: Roof): RoofEdge {
  return { kind: 'slope', pitch: roof.pitch };
}

/** Applies the roof-wide default break to slope edges that have none. */
function withBreak(roof: Roof, e: RoofEdge): RoofEdge {
  if (e.kind !== 'slope' || e.breakHeight !== undefined) return e;
  if (roof.breakHeight === undefined || roof.upperPitch === undefined) return e;
  return { ...e, breakHeight: roof.breakHeight, upperPitch: roof.upperPitch };
}

/** Reverses a ring and re-indexes its per-edge data (edge k joins points k and k + 1). */
function reverseRing<T>(pts: Vec2[], data: T[]): { pts: Vec2[]; data: T[] } {
  const n = pts.length;
  return {
    pts: [...pts].reverse(),
    data: pts.map((_, k) => at(data, n - 2 - k)),
  };
}

/** Same rules as the skeleton's input check: simple rings, holes inside and disjoint. */
function validRings(rings: Vec2[][]): boolean {
  for (const [r, ring] of rings.entries()) {
    if (ring.length < 3) return false;
    if (!ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
    if (
      ring.some((p, i) => Math.hypot(p.x - at(ring, i + 1).x, p.y - at(ring, i + 1).y) < GEOM_TOL)
    )
      return false;
    if (!isSimple(ring)) return false;
    const a = signedArea(ring);
    if (r === 0 ? a <= TINY : a >= -TINY) return false;
    if (r > 0 && !ring.every((p) => pointInPolygon(p, rings[0]!))) return false;
  }
  for (let r = 0; r < rings.length; r++) {
    for (let s = r + 1; s < rings.length; s++) {
      const A = rings[r]!;
      const B = rings[s]!;
      for (let i = 0; i < A.length; i++) {
        for (let j = 0; j < B.length; j++) {
          if (segmentsIntersect(A[i]!, at(A, i + 1), B[j]!, at(B, j + 1))) return false;
        }
      }
      if (r > 0 && (pointInPolygon(A[0]!, B) || pointInPolygon(B[0]!, A))) return false;
    }
  }
  return true;
}

/** Follow mode: one plan per outer ring of the rooms' outline, holes assigned by containment. */
function followPlans(roof: Roof, floor: Readonly<Floor>): Plan[] {
  const rings = floorOutline(floor, roof.rooms ?? []);
  const outers = rings.filter((r) => !r.hole);
  const plans: Plan[] = outers.map(() => ({ rings: [], specs: [], walls: [] }));
  const spec = (wall: Id | undefined): RoofEdge =>
    withBreak(roof, (wall !== undefined && roof.wallEdges?.[wall]) || defaultEdge(roof));
  const push = (k: number, ring: (typeof rings)[number]): void => {
    plans[k]!.rings.push(ring.points);
    plans[k]!.specs.push(ring.walls.map(spec));
    plans[k]!.walls.push([...ring.walls]);
  };
  outers.forEach((o, k) => push(k, o));
  for (const h of rings.filter((r) => r.hole)) {
    let best = -1;
    let bestCount = 0;
    outers.forEach((o, k) => {
      const count = h.points.filter((p) => pointInPolygon(p, o.points)).length;
      if (count > bestCount) {
        best = k;
        bestCount = count;
      }
    });
    if (best >= 0) push(best, h);
  }
  return plans;
}

/** Independent mode: points / holes oriented (outer CCW, holes CW) with their edge specs. */
function independentPlan(roof: Roof): Plan {
  const def = defaultEdge(roof);
  const fix = (pts: Vec2[], specs: RoofEdge[], ccw: boolean): { pts: Vec2[]; data: RoofEdge[] } =>
    signedArea(pts) > 0 === ccw || pts.length < 3 ? { pts, data: specs } : reverseRing(pts, specs);
  const pts = roof.points ?? [];
  const outer = fix(
    pts,
    pts.map((_, i) => withBreak(roof, roof.edges?.[i] ?? def)),
    true,
  );
  const holes = (roof.holes ?? []).map((h, k) =>
    fix(
      h,
      h.map((_, i) => withBreak(roof, roof.holeEdges?.[k]?.[i] ?? def)),
      false,
    ),
  );
  const all = [outer, ...holes];
  return {
    rings: all.map((r) => r.pts),
    specs: all.map((r) => r.data),
    walls: all.map((r) => r.pts.map(() => undefined)),
  };
}

/**
 * Outward-grown points of a ring, per vertex: one miter point, or the two points of a bevel
 * (the first ends edge i - 1, the second starts edge i).
 */
function grownPerVertex(ring: Vec2[], offsets: number[]): { per: Vec2[][]; points: Vec2[] } {
  const { points, source } = growPolygon(ring, offsets, MITER_LIMIT);
  const per: Vec2[][] = [];
  let k = 0;
  for (let i = 0; i < ring.length; i++) {
    if (source[k] !== i && k + 1 < points.length) {
      per.push([points[k]!, points[k + 1]!]);
      k += 2;
    } else {
      per.push([points[k] ?? ring[i]!]);
      k += 1;
    }
  }
  return { per, points };
}

const rightNormal = (a: Vec2, b: Vec2): Vec2 => {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: (b.y - a.y) / l, y: -(b.x - a.x) / l };
};

/**
 * Overhang strips of one ring: for each edge with a plane, the quad between the edge and its
 * grown copy; at a vertex between two planed edges, the closing triangle (bevel gap, or the
 * vertical sliver where the planes disagree at a shared miter point).
 */
function stripFaces(
  ring: Vec2[],
  per: Vec2[][],
  eaves: number,
  zOf: (i: number) => ((p: Vec2) => number) | null,
  makeStrip: (i: number, poly: Vec3[]) => RoofFace,
  makeCorner: (i: number, poly: Vec3[]) => RoofFace = makeStrip,
): RoofFace[] {
  const out: RoofFace[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const z = zOf(i);
    if (!z) continue;
    const A = per[i]![per[i]!.length - 1]!;
    const B = per[(i + 1) % n]![0]!;
    const poly = clean([v3(ring[i]!, eaves), v3(at(ring, i + 1), eaves), v3(B, z(B)), v3(A, z(A))]);
    if (poly) out.push(makeStrip(i, poly));
  }
  for (let i = 0; i < n; i++) {
    const zp = zOf((i - 1 + n) % n);
    const zc = zOf(i);
    if (!zp || !zc) continue;
    const g = per[i]!;
    const v = v3(ring[i]!, eaves);
    const b0 = g[0]!;
    const b1 = g[g.length - 1]!;
    if (g.length === 1 && Math.abs(zp(b0) - zc(b0)) <= TINY) continue;
    const poly = clean([v, v3(b0, zp(b0)), v3(b1, zc(b1))]);
    if (poly) out.push(makeCorner(i, poly));
  }
  return out;
}

/** Height of the roof surface above `p`: highest face containing it, or `fallback`. */
function surfaceZ(faces: RoofFace[], p: Vec2, fallback: number): number {
  let z = -Infinity;
  for (const f of faces) {
    if (isVertical(f.polygon)) continue;
    if (!pointInPolygon(p, f.polygon.map(plan))) continue;
    z = Math.max(z, planeZ(f.polygon, p));
  }
  return Number.isFinite(z) ? z : fallback;
}

function distToRing(p: Vec2, ring: Vec2[]): number {
  let d = Infinity;
  ring.forEach((a, i) => {
    const { point } = closestPointOnSegment(p, a, at(ring, i + 1));
    d = Math.min(d, Math.hypot(point.x - p.x, point.y - p.y));
  });
  return d;
}

/**
 * Posts: at every outline vertex not within POST_WALL_TOL of a wall outline, and along every
 * edge whose midpoint has no wall under it, evenly spaced at most `postSpacing` apart.
 */
function makePosts(
  roof: Roof,
  floor: Readonly<Floor>,
  rings: Vec2[][],
  top: (p: Vec2) => number,
): RoofBody['posts'] {
  if (roof.supports !== 'posts') return [];
  const walls = Object.values(wallOutlines(floor as Floor));
  const onWall = (p: Vec2): boolean =>
    walls.some((w) => pointInPolygon(p, w) || distToRing(p, w) <= POST_WALL_TOL);
  const spacing = roof.postSpacing ?? DEFAULT_POST_SPACING;
  const out: RoofBody['posts'] = [];
  const post = (p: Vec2): void => {
    out.push({ x: p.x, y: p.y, bottom: floor.elevation, top: top(p) });
  };
  for (const ring of rings) {
    ring.forEach((a, i) => {
      if (!onWall(a)) post(a);
      const b = at(ring, i + 1);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (onWall(mid)) return;
      const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing - TINY);
      for (let k = 1; k < count; k++) {
        post({ x: a.x + ((b.x - a.x) * k) / count, y: a.y + ((b.y - a.y) * k) / count });
      }
    });
  }
  return out;
}

/** Flat slab (also the fallback): horizontal faces at the eaves, optional parapet. */
function flatBody(
  roof: Roof,
  floor: Readonly<Floor>,
  rings: Vec2[][],
  eaves: number,
  opts: { grow: boolean; parapet: boolean },
): RoofBody {
  const overhang = opts.grow ? roof.overhang : 0;
  const grown = rings.map((r) =>
    grownPerVertex(
      r,
      r.map(() => overhang),
    ),
  );
  const flatFace = (poly: Vec3[], ring = -1, edge = -1): RoofFace => ({
    ring,
    edge,
    slope: false,
    polygon: orient(poly),
    pitch: 0,
  });
  let faces: RoofFace[] = [flatFace(grown[0]!.points.map((p) => v3(p, eaves)))];
  if (rings.length > 1 && opts.grow) {
    // Holes: split the slab into one simple piece per edge (an all-equal skeleton, flattened).
    const res = weightedSkeleton({ rings, speed: rings.map((r) => r.map(() => 1)) });
    if (res.ok) {
      faces = res.patches.flatMap((p) => {
        const poly = clean(p.polygon.map((q) => ({ x: q.x, y: q.y, z: eaves })));
        return poly && !isVertical(poly) ? [flatFace(poly)] : [];
      });
      rings.forEach((ring, r) => {
        faces.push(
          ...stripFaces(
            ring,
            grown[r]!.per,
            eaves,
            () => () => eaves,
            (_, poly) => flatFace(poly),
          ),
        );
      });
    }
  }
  const parapet = opts.parapet ? (roof.parapet ?? 0) : 0;
  const bottom = eaves + roof.thickness;
  return {
    outline: rings,
    overhangOutline: grown.map((g) => g.points),
    faces,
    lines: [],
    posts: makePosts(roof, floor, rings, () => eaves),
    parapets:
      parapet > 0
        ? rings.flatMap((ring) =>
            ring.map((a, i) => ({ a, b: at(ring, i + 1), bottom, top: bottom + parapet })),
          )
        : [],
  };
}

interface GableLine {
  a: Vec2;
  b: Vec2;
  rn: Vec2;
  offset: number;
}

/** A face edge piece [t0, t1] (parameters along a → b). */
type Interval = [number, number];

/**
 * Ridge / hip / valley lines where two non-coplanar surface faces share a segment (horizontal →
 * ridge, rising → hip when the fold is convex, valley when concave); eave / rake lines along
 * the surface boundary (rake where it lies over a gable edge or its rake copy). Collinear
 * pieces of one kind are merged.
 */
function extractLines(faces: RoofFace[], gables: GableLine[]): RoofBody['lines'] {
  const surf = faces.filter((f) => !isVertical(f.polygon)).map((f) => f.polygon);
  const unit = surf.map((p) => {
    const n = newell(p);
    const l = Math.hypot(n.x, n.y, n.z);
    return { x: n.x / l, y: n.y / l, z: n.z / l };
  });
  const coplanar = (i: number, j: number): boolean => {
    const a = unit[i]!;
    const b = unit[j]!;
    if (Math.abs(a.x * b.x + a.y * b.y + a.z * b.z - 1) > TOL) return false;
    const o = surf[i]![0]!;
    const q = surf[j]![0]!;
    return Math.abs((q.x - o.x) * a.x + (q.y - o.y) * a.y + (q.z - o.z) * a.z) < TOL;
  };
  const lines: RoofBody['lines'] = [];
  const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  });
  surf.forEach((poly, i) => {
    poly.forEach((a, k) => {
      const b = at(poly, k + 1);
      const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const l2 = d.x * d.x + d.y * d.y + d.z * d.z;
      if (l2 < TINY * TINY) return;
      const len = Math.sqrt(l2);
      const offLine = (p: Vec3): number => {
        const w = { x: p.x - a.x, y: p.y - a.y, z: p.z - a.z };
        const c = {
          x: w.y * d.z - w.z * d.y,
          y: w.z * d.x - w.x * d.z,
          z: w.x * d.y - w.y * d.x,
        };
        return Math.hypot(c.x, c.y, c.z) / len;
      };
      const param = (p: Vec3): number =>
        ((p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z) / l2;
      const covered: Interval[] = [];
      surf.forEach((other, j) => {
        if (j === i) return;
        other.forEach((c, m) => {
          const e = at(other, m + 1);
          if (offLine(c) > TOL || offLine(e) > TOL) return;
          const tc = param(c);
          const te = param(e);
          const lo = Math.max(0, Math.min(tc, te));
          const hi = Math.min(1, Math.max(tc, te));
          if ((hi - lo) * len <= TOL) return;
          covered.push([lo, hi]);
          if (j < i || coplanar(i, j)) return;
          const p = lerp(a, b, lo);
          const q = lerp(a, b, hi);
          const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
          // Face i is CCW from above: its interior lies left of a → b.
          const pl = Math.hypot(d.x, d.y) || 1;
          const probe = { x: mid.x - (d.y / pl) * 1e-3, y: mid.y + (d.x / pl) * 1e-3 };
          const convex = planeZ(other, probe) > planeZ(poly, probe);
          const flat = Math.abs(p.z - q.z) <= TOL;
          const kind: RoofLineKind = !convex ? 'valley' : flat ? 'ridge' : 'hip';
          lines.push({ kind, a: p, b: q });
        });
      });
      // Boundary pieces: the edge minus everything another surface face covers.
      covered.sort((x, y) => x[0] - y[0]);
      let t = 0;
      const free: Interval[] = [];
      for (const [lo, hi] of covered) {
        if (lo > t + TOL / len) free.push([t, lo]);
        t = Math.max(t, hi);
      }
      if (t < 1 - TOL / len) free.push([t, 1]);
      for (const [lo, hi] of free) {
        const p = lerp(a, b, lo);
        const q = lerp(a, b, hi);
        const onGable = gables.some((g) =>
          [p, q].every((s) => {
            const dd = (s.x - g.a.x) * g.rn.x + (s.y - g.a.y) * g.rn.y;
            return Math.abs(dd) < TOL || Math.abs(dd - g.offset) < TOL;
          }),
        );
        lines.push({ kind: onGable ? 'rake' : 'eave', a: p, b: q });
      }
    });
  });
  return mergeLines(lines);
}

function mergeLines(lines: RoofBody['lines']): RoofBody['lines'] {
  const same = (p: Vec3, q: Vec3): boolean => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < TOL;
  const dir = (l: RoofBody['lines'][number]): Vec3 => {
    const d = { x: l.b.x - l.a.x, y: l.b.y - l.a.y, z: l.b.z - l.a.z };
    const n = Math.hypot(d.x, d.y, d.z);
    return { x: d.x / n, y: d.y / n, z: d.z / n };
  };
  const out = [...lines];
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const x = out[i]!;
        const y = out[j]!;
        if (x.kind !== y.kind) continue;
        const u = dir(x);
        const w = dir(y);
        const c = Math.hypot(u.y * w.z - u.z * w.y, u.z * w.x - u.x * w.z, u.x * w.y - u.y * w.x);
        if (c > TOL) continue;
        let merged: RoofBody['lines'][number] | null = null;
        if (same(x.b, y.a)) merged = { kind: x.kind, a: x.a, b: y.b };
        else if (same(x.a, y.b)) merged = { kind: x.kind, a: y.a, b: x.b };
        else if (same(x.a, y.a)) merged = { kind: x.kind, a: x.b, b: y.b };
        else if (same(x.b, y.b)) merged = { kind: x.kind, a: x.a, b: y.a };
        if (!merged) continue;
        out[i] = merged;
        out.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return out;
}

/** Pitched body: skeleton faces, overhang strips, rake strips, lines and posts; null on failure. */
function pitchedBody(
  roof: Roof,
  floor: Readonly<Floor>,
  p: Plan,
  eaves: number,
): { body: RoofBody; gables: Vec3[][] } | null {
  const speedOf = (e: RoofEdge): number => (e.kind === 'gable' ? 0 : 1 / Math.tan(rad(e.pitch)));
  const input: SkeletonInput = { rings: p.rings, speed: p.specs.map((r) => r.map(speedOf)) };
  const brk = p.specs
    .flat()
    .find(
      (e): e is Extract<RoofEdge, { kind: 'slope' }> =>
        e.kind === 'slope' && e.breakHeight !== undefined && e.upperPitch !== undefined,
    );
  if (brk) {
    input.breakAt = {
      at: brk.breakHeight!,
      upper: p.specs.map((r) =>
        r.map((e) =>
          e.kind === 'slope' && e.upperPitch !== undefined && e.breakHeight !== undefined
            ? 1 / Math.tan(rad(e.upperPitch))
            : speedOf(e),
        ),
      ),
    };
  }
  const res = weightedSkeleton(input);
  if (!res.ok) return null;

  const faces: RoofFace[] = [];
  const gables: Vec3[][] = [];
  for (const patch of res.patches) {
    const poly = clean(patch.polygon.map((q) => ({ x: q.x, y: q.y, z: q.z + eaves })));
    if (!poly) continue;
    if (patch.cap) {
      faces.push({ ring: -1, edge: -1, slope: false, polygon: orient(poly), pitch: 0 });
      continue;
    }
    const spec = p.specs[patch.ring]![patch.edge]!;
    const wallId = p.walls[patch.ring]![patch.edge];
    const face: RoofFace = {
      ring: patch.ring,
      edge: patch.edge,
      slope: false,
      polygon: poly,
      pitch: 0,
    };
    if (wallId !== undefined) face.wallId = wallId;
    if (isVertical(poly)) {
      if (spec.kind === 'gable') gables.push(poly);
    } else if (spec.kind === 'slope') {
      const minZ = Math.min(...patch.polygon.map((q) => q.z));
      const upper =
        brk && spec.upperPitch !== undefined && spec.breakHeight !== undefined
          ? minZ >= brk.breakHeight! - TOL
          : false;
      face.slope = true;
      face.pitch = upper ? spec.upperPitch! : spec.pitch;
      face.polygon = orient(poly);
    } else {
      face.polygon = orient(poly);
    }
    faces.push(face);
  }
  const main = faces.slice();

  // Overhang: eaves strips on each slope plane, closing triangles, rake corners.
  const grown = p.rings.map((ring, r) =>
    grownPerVertex(
      ring,
      p.specs[r]!.map((e) => (e.kind === 'gable' ? roof.gableOverhang : roof.overhang)),
    ),
  );
  const gableLines: GableLine[] = [];
  p.rings.forEach((ring, r) => {
    const specs = p.specs[r]!;
    const n = ring.length;
    const wallOf = (i: number): Id | undefined => p.walls[r]![i];
    const zOf = (i: number): ((q: Vec2) => number) | null => {
      const e = specs[i]!;
      if (e.kind !== 'slope') return null;
      const a = ring[i]!;
      const rn = rightNormal(a, at(ring, i + 1));
      const k = Math.tan(rad(e.pitch));
      return (q) => eaves - ((q.x - a.x) * rn.x + (q.y - a.y) * rn.y) * k;
    };
    const make =
      (forceSlope?: boolean) =>
      (i: number, poly: Vec3[]): RoofFace => {
        const vert = isVertical(poly);
        const e = specs[i]!;
        const f: RoofFace = {
          ring: r,
          edge: i,
          slope: !vert,
          polygon: orient(poly),
          pitch: vert ? 0 : forceSlope && e.kind === 'slope' ? e.pitch : pitchOf(poly),
        };
        const w = wallOf(i);
        if (w !== undefined) f.wallId = w;
        return f;
      };
    const per = grown[r]!.per;
    // Strips lie on their edge's plane (exact pitch); closing triangles get their own pitch.
    faces.push(...stripFaces(ring, per, eaves, zOf, make(true), make()));
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const ep = specs[prev]!;
      const ec = specs[i]!;
      const v = ring[i]!;
      if (ep.kind === 'slope' && ec.kind === 'gable') {
        const z = zOf(prev)!;
        const rn = rightNormal(v, at(ring, i + 1));
        const a2 = { x: v.x + rn.x * roof.gableOverhang, y: v.y + rn.y * roof.gableOverhang };
        const pts = [v, ...per[i]!, a2];
        if (signedArea(pts) > TINY) {
          const poly = clean(pts.map((q) => v3(q, z(q))));
          if (poly) faces.push(make(true)(prev, poly));
        }
      } else if (ep.kind === 'gable' && ec.kind === 'slope') {
        const z = zOf(i)!;
        const rn = rightNormal(at(ring, prev), v);
        const a2 = { x: v.x + rn.x * roof.gableOverhang, y: v.y + rn.y * roof.gableOverhang };
        const pts = [v, a2, ...per[i]!];
        if (signedArea(pts) > TINY) {
          const poly = clean(pts.map((q) => v3(q, z(q))));
          if (poly) faces.push(make(true)(i, poly));
        }
      } else if (ep.kind === 'gable' && ec.kind === 'gable' && roof.gableOverhang > 0) {
        // Two rakes meet (the high corners of a shed): fill between them on the plane of the
        // highest slope face reaching this corner, if any.
        let top: RoofFace | null = null;
        let topZ = -Infinity;
        for (const f of main) {
          if (!f.slope) continue;
          const q = f.polygon.find((x) => Math.hypot(x.x - v.x, x.y - v.y) < TOL);
          if (q && q.z > topZ) {
            top = f;
            topZ = q.z;
          }
        }
        if (top) {
          const plane = top.polygon;
          const off = (n: Vec2): Vec2 => ({
            x: v.x + n.x * roof.gableOverhang,
            y: v.y + n.y * roof.gableOverhang,
          });
          const pts = [
            v,
            off(rightNormal(at(ring, prev), v)),
            ...per[i]!,
            off(rightNormal(v, at(ring, i + 1))),
          ];
          if (signedArea(pts) > TINY) {
            const poly = clean(pts.map((q) => v3(q, planeZ(plane, q))));
            if (poly) faces.push({ ...top, polygon: orient(poly) });
          }
        }
      }
    }
    // Rake strips: slope-face boundary segments on a gable's vertical plane, pushed outward.
    specs.forEach((e, i) => {
      if (e.kind !== 'gable') return;
      const a = ring[i]!;
      const b = at(ring, i + 1);
      const rn = rightNormal(a, b);
      gableLines.push({ a, b, rn, offset: roof.gableOverhang });
      if (roof.gableOverhang <= 0) return;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const onPlane = (q: Vec3): boolean => {
        const d = (q.x - a.x) * rn.x + (q.y - a.y) * rn.y;
        const t = ((q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y)) / len;
        return Math.abs(d) < TOL && t > -TOL && t < len + TOL;
      };
      const ends: { q: Vec3; o: Vec3 }[] = [];
      for (const f of main) {
        if (!f.slope) continue;
        f.polygon.forEach((q, k) => {
          const s = at(f.polygon, k + 1);
          if (!onPlane(q) || !onPlane(s)) return;
          if (Math.abs(q.z - eaves) < TOL && Math.abs(s.z - eaves) < TOL) return;
          const out = (x: Vec3): Vec3 => {
            const g = { x: x.x + rn.x * roof.gableOverhang, y: x.y + rn.y * roof.gableOverhang };
            return v3(g, planeZ(f.polygon, g));
          };
          const poly = clean([q, s, out(s), out(q)]);
          if (!poly) return;
          faces.push({ ...f, polygon: orient(poly) });
          ends.push({ q, o: out(q) }, { q: s, o: out(s) });
        });
      }
      // Two rake strips from one point whose planes disagree out there (a slanted gable with
      // unequal slopes): close the gap with a vertical triangle in the rake plane.
      const same = (x: Vec3, y: Vec3): boolean => Math.hypot(x.x - y.x, x.y - y.y, x.z - y.z) < TOL;
      ends.forEach((u, j) => {
        for (const w of ends.slice(j + 1)) {
          if (!same(u.q, w.q) || Math.abs(u.o.z - w.o.z) <= TINY) continue;
          const poly = clean([u.q, u.o, w.o]);
          if (!poly) continue;
          const f: RoofFace = { ring: r, edge: i, slope: false, polygon: poly, pitch: 0 };
          const wall = wallOf(i);
          if (wall !== undefined) f.wallId = wall;
          faces.push(f);
        }
      });
    });
  });

  const body: RoofBody = {
    outline: p.rings,
    overhangOutline: grown.map((g) => g.points),
    faces,
    lines: extractLines(faces, gableLines),
    posts: makePosts(roof, floor, p.rings, (q) => surfaceZ(main, q, eaves)),
    parapets: [],
  };
  return { body, gables };
}

function pitchOf(poly: Vec3[]): number {
  const n = newell(poly);
  return deg(Math.acos(Math.min(1, Math.abs(n.z) / Math.hypot(n.x, n.y, n.z))));
}

/** Geometry plus the warning (if any) and gable faces; shared by `roofGeometry`, `validateRoofs`, `gableProfile`. */
export function buildRoof(roof: Roof, floor: Readonly<Floor>): Built {
  const eaves = floor.elevation + floor.wallHeight + roof.base;
  let plans: Plan[];
  if (roof.follow) {
    plans = followPlans(roof, floor);
    if (plans.length === 0) {
      return {
        geometry: { ok: true, bodies: [] },
        issue: { code: 'roof-no-walls', message: `Roof ${roof.id} follows no rooms` },
        gables: [],
      };
    }
  } else {
    const p = independentPlan(roof);
    if (!validRings(p.rings)) {
      const raw = [roof.points ?? [], ...(roof.holes ?? [])];
      const body = flatBody(roof, floor, raw, eaves, { grow: false, parapet: false });
      return {
        geometry: { ok: false, bodies: raw[0]!.length >= 3 ? [body] : [] },
        issue: {
          code: 'roof-invalid-outline',
          message: `Roof ${roof.id} outline is not simple or its holes are outside / crossing`,
        },
        gables: [],
      };
    }
    plans = [p];
  }
  if (roof.kind === 'flat') {
    return {
      geometry: {
        ok: true,
        bodies: plans.map((p) =>
          flatBody(roof, floor, p.rings, eaves, { grow: true, parapet: true }),
        ),
      },
      gables: [],
    };
  }
  const bodies: RoofBody[] = [];
  const gables: Vec3[][] = [];
  let ok = true;
  for (const p of plans) {
    let built: ReturnType<typeof pitchedBody> = null;
    try {
      built = pitchedBody(roof, floor, p, eaves);
    } catch {
      built = null;
    }
    if (built) {
      bodies.push(built.body);
      gables.push(...built.gables);
    } else {
      ok = false;
      bodies.push(flatBody(roof, floor, p.rings, eaves, { grow: true, parapet: false }));
    }
  }
  return ok
    ? { geometry: { ok, bodies }, gables }
    : {
        geometry: { ok, bodies },
        issue: {
          code: 'roof-build-failed',
          message: `Roof ${roof.id} could not be built; drawn flat instead`,
        },
        gables,
      };
}

/**
 * Plan and 3D geometry of a roof on its floor: one body per outer ring (follow mode: per
 * disjoint loop of the chosen rooms, courtyards as holes). The underside passes through the
 * outline at `elevation + wallHeight + base`. Never throws: an invalid outline or a failed
 * skeleton gives `ok: false` with flat bodies (see `validateRoofs`); a follow roof without
 * rooms gives no bodies.
 */
export function roofGeometry(roof: Roof, floor: Readonly<Floor>): RoofGeometry {
  return buildRoof(roof, floor).geometry;
}

/**
 * Top profile of a wall under gable roof edges: `(distance along the wall axis from node a,
 * absolute height)` points, the upper envelope of every gable face of any pitched roof on the
 * floor that lies on one of the wall's faces (within 1 cm) and overlaps it. Null when no gable
 * edge lies on the wall.
 */
export function gableProfile(floor: Readonly<Floor>, wallId: Id): Vec2[] | null {
  return gableProfileFrom(floor, wallId, floorGables(floor));
}

/** Gable vertical faces of every pitched roof on the floor (one build per roof). */
function floorGables(floor: Readonly<Floor>): Vec3[][] {
  return Object.values(floor.roofs).flatMap((roof) =>
    roof.kind === 'pitched' ? buildRoof(roof, floor).gables : [],
  );
}

/**
 * `gableProfile` from already built gable faces (`buildRoof(...).gables` of the floor's
 * pitched roofs), so a caller drawing every wall builds each roof once. Internal.
 */
export function gableProfileFrom(
  floor: Readonly<Floor>,
  wallId: Id,
  gables: readonly Vec3[][],
): Vec2[] | null {
  if (gables.length === 0) return null;
  const w = floor.walls[wallId];
  const na = w && floor.nodes[w.a];
  const nb = w && floor.nodes[w.b];
  if (!w || !na || !nb) return null;
  const len = Math.hypot(nb.x - na.x, nb.y - na.y);
  if (len < TINY) return null;
  const dir = { x: (nb.x - na.x) / len, y: (nb.y - na.y) / len };
  const half = w.thickness / 2;
  const polys: Vec2[][] = [];
  for (const g of gables) {
    const offs = g.map((q) => (q.x - na.x) * dir.y - (q.y - na.y) * dir.x);
    const side = Math.sign(offs[0]!);
    if (!offs.every((o) => Math.abs(Math.abs(o) - half) <= GABLE_WALL_TOL && Math.sign(o) === side))
      continue;
    const sz = g.map((q) => ({ x: (q.x - na.x) * dir.x + (q.y - na.y) * dir.y, y: q.z }));
    const lo = Math.min(...sz.map((q) => q.x));
    const hi = Math.max(...sz.map((q) => q.x));
    if (Math.min(hi, len) - Math.max(lo, 0) <= GEOM_TOL) continue;
    polys.push(sz);
  }
  if (polys.length === 0) return null;
  const xs = [...new Set(polys.flat().map((q) => q.x))].sort((a, b) => a - b);
  const breaks = xs.filter((x, i) => i === 0 || x - xs[i - 1]! > TINY);
  const out: Vec2[] = [];
  const push = (q: Vec2): void => {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - q.x) > TINY || Math.abs(last.y - q.y) > TINY) out.push(q);
  };
  for (let k = 0; k + 1 < breaks.length; k++) {
    const s0 = breaks[k]!;
    const s1 = breaks[k + 1]!;
    const mid = (s0 + s1) / 2;
    let best: { z: number; f: (s: number) => number } | null = null;
    for (const poly of polys) {
      poly.forEach((a, i) => {
        const b = at(poly, i + 1);
        if (Math.min(a.x, b.x) > mid || Math.max(a.x, b.x) < mid || Math.abs(b.x - a.x) < TINY)
          return;
        const f = (s: number): number => a.y + ((b.y - a.y) * (s - a.x)) / (b.x - a.x);
        const z = f(mid);
        if (!best || z > best.z) best = { z, f };
      });
    }
    if (!best) continue;
    const top: { z: number; f: (s: number) => number } = best;
    push({ x: s0, y: top.f(s0) });
    push({ x: s1, y: top.f(s1) });
  }
  return out.length > 0 ? out : null;
}
