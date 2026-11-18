import type { Vec2 } from '../types';
import { GEOM_TOL } from '../constants';
import { add, cross, distance, dot, leftNormal, normalize, scale, sub } from '../geometry/vec';
import { isSimple, pointInPolygon, signedArea } from '../geometry/polygon';
import { segmentsIntersect } from '../geometry/segment';

export interface SkeletonInput {
  rings: Vec2[][]; // outer CCW first, holes CW
  /** Per ring, per edge: horizontal inward speed per meter of rise = 1 / tan(pitch); 0 = gable. */
  speed: number[][];
  /** Optional break: at height `at`, edge speeds switch to `upper` (same shape as speed). */
  breakAt?: { at: number; upper: number[][] };
}

/**
 * One planar piece of the roof surface. One input edge can yield several
 * patches (its sloped face, vertical connector steps where it meets a
 * collinear edge of another pitch, its upper-stage face after a break, or raw
 * strips when merging falls back), so consumers group patches by
 * `(ring, edge)`.
 */
export interface SkeletonPatch {
  /**
   * Source edge: ring index and edge index in the input. Meaningless on a
   * `cap` patch — do not use it there.
   */
  ring: number;
  edge: number;
  /** Planar polygon in 3D plan coords (x, y, z = height above eaves). */
  polygon: { x: number; y: number; z: number }[];
  /**
   * Set on horizontal caps closing a region walled in by gables / vertical
   * steps that no slope sweeps (e.g. a shed over an L). Its ring/edge are
   * arbitrary.
   */
  cap?: true;
}

export type SkeletonResult =
  | { ok: true; patches: SkeletonPatch[]; maxHeight: number }
  | { ok: false; reason: 'invalid-input' | 'event-limit' | 'degenerate' };

type Vec3 = { x: number; y: number; z: number };

/** One planar roof face: a source edge at one stage, or a vertical step between two stages. */
interface Face {
  ring: number;
  edge: number;
  speed: number;
  /** Fixed direction of the face's wavefront line. */
  d: Vec2;
}

/** A wavefront edge: a line moving along its left normal at `speed` per meter of rise. */
interface WEdge {
  face: number;
  d: Vec2;
  n: Vec2;
  speed: number;
  upper: number;
}

/** Edge k runs from pts[k] to pts[k + 1]; the domain lies on its left. */
interface Ring {
  pts: Vec2[];
  edges: WEdge[];
}

/** Events closer than this (in height) to the current one are ignored. */
const MIN_STEP = 1e-9;
/** Adjacent lines with |cross| below this are treated as parallel. */
const PARALLEL = 1e-9;
/** Smallest ring area kept in the wavefront. */
const MIN_AREA = 1e-9;
/**
 * Wavefront snapping distance: vertices closer than this merge, and a vertex
 * this close to another edge lies on it. Far below GEOM_TOL on purpose: real
 * coincidences agree to ~1e-12, while snapping near-coincident vertices by
 * up to GEOM_TOL pulls them off their face planes by as much.
 */
const SNAP = 1e-7;

const at = <T>(arr: T[], i: number): T => arr[((i % arr.length) + arr.length) % arr.length] as T;

/**
 * Weighted straight skeleton of a polygon with holes, computed as a sequence
 * of wavefront offsets restarted at every event: each step advances every
 * vertex linearly to the next event height, emits the swept strip of every
 * wavefront edge, then rebuilds the wavefront (merging coincident vertices,
 * splitting / joining rings, cancelling overlapping opposite edges).
 *
 * Patches are grouped per input edge only loosely: an edge may yield several
 * patches (see `SkeletonPatch`), and horizontal `cap` patches carry an
 * arbitrary ring/edge that must not be used to look up edge properties.
 */
export function weightedSkeleton(input: SkeletonInput): SkeletonResult {
  if (!validInput(input)) return { ok: false, reason: 'invalid-input' };
  if (input.speed.every((r) => r.every((s) => s === 0))) return { ok: false, reason: 'degenerate' };

  const faces: Face[] = [];
  let rings: Ring[] = input.rings.map((ring, r) => ({
    pts: ring.map((p) => ({ x: p.x, y: p.y })),
    edges: ring.map((p, i) => {
      const d = normalize(sub(at(ring, i + 1), p));
      const speed = input.speed[r]![i]!;
      faces.push({ ring: r, edge: i, speed, d });
      return {
        face: faces.length - 1,
        d,
        n: leftNormal(d),
        speed,
        upper: input.breakAt ? input.breakAt.upper[r]![i]! : speed,
      };
    }),
  }));
  rings = insertConnectors(rings, faces);

  const pieces = new Map<number, Vec3[][]>();
  const caps: SkeletonPatch[] = [];
  const n = input.rings.reduce((s, r) => s + r.length, 0);
  const cap = 8 * n * n + 64;
  let h = 0;
  let broken = !input.breakAt;

  for (let iter = 0; rings.length > 0; iter++) {
    if (iter >= cap) return { ok: false, reason: 'event-limit' };
    const vel = rings.map(velocities);
    let t = nextEvent(rings, vel);
    let doBreak = false;
    if (!broken && input.breakAt) {
      const tb = input.breakAt.at - h;
      if (tb <= t + MIN_STEP) {
        t = Math.max(tb, 0);
        doBreak = true;
      }
    }
    if (!Number.isFinite(t)) {
      // Only gable (speed 0) rings are left: regions walled in by vertical
      // steps. Close each with a flat cap at the current height.
      if (!rings.every((r) => r.edges.every((e) => e.speed === 0) && signedArea(r.pts) > 0)) {
        return { ok: false, reason: 'degenerate' };
      }
      for (const r of rings) {
        const src = faces[r.edges[0]!.face]!;
        caps.push({
          ring: src.ring,
          edge: src.edge,
          polygon: r.pts.map((p) => ({ ...p, z: h })),
          cap: true,
        });
      }
      break;
    }

    const moved: Ring[] = rings.map((r, k) => ({
      pts: r.pts.map((p, i) => add(p, scale(vel[k]![i]!, t))),
      edges: r.edges,
    }));
    const clean = rebuild(moved);
    if (!clean) return { ok: false, reason: 'degenerate' };

    rings.forEach((r, k) => {
      r.edges.forEach((e, i) => {
        const poly = dedupe([
          { ...r.pts[i]!, z: h },
          { ...at(r.pts, i + 1), z: h },
          { ...at(clean.map[k]!, i + 1), z: h + t },
          { ...clean.map[k]![i]!, z: h + t },
        ]);
        if (poly.length < 3) return;
        const list = pieces.get(e.face) ?? [];
        list.push(poly);
        pieces.set(e.face, list);
      });
    });

    h += t;
    rings = clean.rings;
    if (doBreak) {
      broken = true;
      const upperFace = new Map<number, number>();
      rings = rings.map((r) => ({
        pts: r.pts,
        edges: r.edges.map((e) => {
          if (e.upper === e.speed) return e; // same plane carries on
          let f = upperFace.get(e.face);
          if (f === undefined) {
            const old = faces[e.face]!;
            faces.push({ ...old, speed: e.upper });
            f = faces.length - 1;
            upperFace.set(e.face, f);
          }
          return { ...e, face: f, speed: e.upper };
        }),
      }));
    }
    rings = insertConnectors(rings, faces);
  }

  const patches: SkeletonPatch[] = [];
  let maxHeight = 0;
  faces.forEach((face, f) => {
    const list = pieces.get(f);
    if (!list) return;
    for (const polygon of mergeFace(face, list)) {
      patches.push({ ring: face.ring, edge: face.edge, polygon });
      for (const p of polygon) maxHeight = Math.max(maxHeight, p.z);
    }
  });
  patches.push(...caps);
  return { ok: true, patches, maxHeight };
}

function validInput(input: SkeletonInput): boolean {
  const { rings, speed, breakAt } = input;
  if (!Array.isArray(rings) || rings.length === 0) return false;
  const shaped = (s: number[][] | undefined): boolean =>
    Array.isArray(s) &&
    s.length === rings.length &&
    s.every(
      (row, r) =>
        Array.isArray(row) &&
        row.length === rings[r]!.length &&
        row.every((v) => Number.isFinite(v) && v >= 0),
    );
  if (!shaped(speed)) return false;
  if (breakAt && !(Number.isFinite(breakAt.at) && breakAt.at > 0 && shaped(breakAt.upper))) {
    return false;
  }
  for (const [r, ring] of rings.entries()) {
    if (ring.length < 3) return false;
    if (!ring.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return false;
    if (ring.some((p, i) => distance(p, at(ring, i + 1)) < GEOM_TOL)) return false;
    if (!isSimple(ring)) return false;
    const a = signedArea(ring);
    if (r === 0 ? a <= MIN_AREA : a >= -MIN_AREA) return false;
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
    }
  }
  return true;
}

/**
 * Between two parallel same-direction edges with different speeds, inserts a
 * zero-length speed-0 edge (a vertical step) so each side keeps its own line.
 */
function insertConnectors(rings: Ring[], faces: Face[]): Ring[] {
  return rings.map((ring) => {
    const pts: Vec2[] = [];
    const edges: WEdge[] = [];
    ring.edges.forEach((out, i) => {
      const inc = at(ring.edges, i - 1);
      const p = ring.pts[i]!;
      if (
        Math.abs(cross(inc.d, out.d)) < PARALLEL &&
        dot(inc.d, out.d) > 0 &&
        Math.abs(inc.speed - out.speed) > 1e-12
      ) {
        const d = out.speed > inc.speed ? inc.n : scale(inc.n, -1);
        const src = faces[inc.face]!;
        faces.push({ ring: src.ring, edge: src.edge, speed: 0, d });
        pts.push({ ...p });
        edges.push({ face: faces.length - 1, d, n: leftNormal(d), speed: 0, upper: 0 });
      }
      pts.push(p);
      edges.push(out);
    });
    return { pts, edges };
  });
}

/** Velocity (plan displacement per meter of rise) of every vertex of a ring. */
function velocities(ring: Ring): Vec2[] {
  return ring.edges.map((out, i) => {
    const inc = at(ring.edges, i - 1);
    const det = cross(inc.n, out.n);
    if (Math.abs(det) < PARALLEL) {
      // Collinear equal-speed edges: the joint moves straight inward. Anything
      // else here is a transient degenerate spike; average the two motions.
      if (dot(inc.d, out.d) > 0) return scale(inc.n, inc.speed);
      return scale(add(scale(inc.n, inc.speed), scale(out.n, out.speed)), 0.5);
    }
    return {
      x: (inc.speed * out.n.y - out.speed * inc.n.y) / det,
      y: (inc.n.x * out.speed - out.n.x * inc.speed) / det,
    };
  });
}

/** Rise to the next edge collapse or split event (Infinity when none). */
function nextEvent(rings: Ring[], vel: Vec2[][]): number {
  let best = Infinity;
  rings.forEach((r, k) => {
    r.edges.forEach((e, i) => {
      const len = dot(e.d, sub(at(r.pts, i + 1), r.pts[i]!));
      const rate = dot(e.d, sub(at(vel[k]!, i + 1), vel[k]![i]!));
      if (rate < -1e-12) {
        const t = -len / rate;
        if (t > MIN_STEP && t < best) best = t;
      }
    });
  });
  rings.forEach((r, k) => {
    r.pts.forEach((v, i) => {
      const inc = at(r.edges, i - 1);
      const out = r.edges[i]!;
      if (cross(inc.d, out.d) >= -PARALLEL) return; // only reflex vertices split
      const u = vel[k]![i]!;
      rings.forEach((s, m) => {
        s.edges.forEach((e, j) => {
          if (m === k && (j === i || j === (i - 1 + r.edges.length) % r.edges.length)) return;
          const a = s.pts[j]!;
          const b = at(s.pts, j + 1);
          const c = (dot(e.n, a) + dot(e.n, b)) / 2;
          const rate = dot(e.n, u) - e.speed;
          if (rate >= -1e-12) return;
          const t = -(dot(e.n, v) - c) / rate;
          if (t <= MIN_STEP || t >= best) return;
          const p = add(v, scale(u, t));
          const pa = add(a, scale(vel[m]![j]!, t));
          const pb = add(b, scale(at(vel[m]!, j + 1), t));
          const along = dot(e.d, sub(p, pa));
          if (along >= -SNAP && along <= dot(e.d, sub(pb, pa)) + SNAP) best = t;
        });
      });
    });
  });
  return best;
}

interface HalfEdge {
  e: WEdge;
  s: number;
  t: number;
  next?: HalfEdge;
  alive: boolean;
}

/**
 * Rebuilds the wavefront after an advance: clusters coincident vertices,
 * inserts vertices lying on other edges, drops zero-length edges, cancels
 * coincident opposite edges and re-pairs edges at every cluster by angle.
 * `map[k][i]` is the rebuilt position of input vertex i of ring k.
 */
function rebuild(rings: Ring[]): { rings: Ring[]; map: Vec2[][] } | null {
  const all: Vec2[] = [];
  const gid: number[][] = rings.map((r) => r.pts.map((p) => all.push(p) - 1));
  const parent = all.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (distance(all[i]!, all[j]!) < SNAP) parent[find(i)] = find(j);
    }
  }
  const clusterOf = new Map<number, number>();
  const sums: { x: number; y: number; n: number }[] = [];
  const cl = all.map((p, i) => {
    const root = find(i);
    let c = clusterOf.get(root);
    if (c === undefined) {
      c = sums.push({ x: 0, y: 0, n: 0 }) - 1;
      clusterOf.set(root, c);
    }
    const acc = sums[c]!;
    acc.x += p.x;
    acc.y += p.y;
    acc.n++;
    return c;
  });
  const pos = sums.map((s) => ({ x: s.x / s.n, y: s.y / s.n }));
  const map = gid.map((row) => row.map((g) => pos[cl[g]!]!));

  // Half-edges, split where another cluster lies on them.
  let hes: HalfEdge[] = [];
  rings.forEach((r, k) => {
    r.edges.forEach((e, i) => {
      const s = cl[gid[k]![i]!]!;
      const t = cl[at(gid[k]!, i + 1)]!;
      if (s === t) return;
      const a = pos[s]!;
      const b = pos[t]!;
      const ab = sub(b, a);
      const len = Math.hypot(ab.x, ab.y);
      const inner: { c: number; f: number }[] = [];
      pos.forEach((p, c) => {
        if (c === s || c === t) return;
        const f = dot(sub(p, a), ab) / (len * len);
        if (f <= 0 || f >= 1) return;
        if (Math.abs(cross(ab, sub(p, a))) / len < SNAP) inner.push({ c, f });
      });
      inner.sort((x, y) => x.f - y.f);
      const chain = [s, ...inner.map((x) => x.c), t];
      for (let q = 0; q + 1 < chain.length; q++) {
        hes.push({ e, s: chain[q]!, t: chain[q + 1]!, alive: true });
      }
    });
  });

  // Coincident opposite edges annihilate.
  const byKey = new Map<string, HalfEdge[]>();
  for (const he of hes) {
    const opp = byKey.get(`${he.t},${he.s}`);
    const mate = opp?.find((o) => o.alive);
    if (mate) {
      mate.alive = false;
      he.alive = false;
      continue;
    }
    const key = `${he.s},${he.t}`;
    byKey.set(key, [...(byKey.get(key) ?? []), he]);
  }
  hes = hes.filter((he) => he.alive);

  // Re-pair incoming and outgoing edges at every cluster.
  const ins: HalfEdge[][] = pos.map(() => []);
  const outs: HalfEdge[][] = pos.map(() => []);
  for (const he of hes) {
    outs[he.s]!.push(he);
    ins[he.t]!.push(he);
  }
  for (let c = 0; c < pos.length; c++) {
    const I = ins[c]!;
    const O = outs[c]!;
    if (I.length !== O.length) return null;
    if (I.length === 0) continue;
    if (I.length === 1) {
      I[0]!.next = O[0];
      continue;
    }
    // Rays around the cluster in CCW order; a domain wedge runs CCW from an
    // outgoing ray to the next incoming ray.
    const rays = [
      ...O.map((he) => ({ he, out: true, a: Math.atan2(he.e.d.y, he.e.d.x) })),
      ...I.map((he) => ({ he, out: false, a: Math.atan2(-he.e.d.y, -he.e.d.x) })),
    ].sort((x, y) => x.a - y.a || (x.out ? 1 : -1));
    while (rays.length > 0) {
      const idx = rays.findIndex((r, q) => r.out && !at(rays, q + 1).out);
      if (idx < 0) return null;
      const o = rays[idx]!;
      const i2 = (idx + 1) % rays.length;
      rays[i2]!.he.next = o.he;
      rays.splice(Math.max(idx, i2), 1);
      rays.splice(Math.min(idx, i2), 1);
    }
  }

  const out: Ring[] = [];
  const seen = new Set<HalfEdge>();
  for (const start of hes) {
    if (seen.has(start)) continue;
    const pts: Vec2[] = [];
    const edges: WEdge[] = [];
    let he: HalfEdge | undefined = start;
    while (he && !seen.has(he)) {
      seen.add(he);
      pts.push(pos[he.s]!);
      edges.push(he.e);
      he = he.next;
    }
    if (he !== start) return null;
    if (edges.length >= 3 && Math.abs(signedArea(pts)) >= MIN_AREA) out.push({ pts, edges });
  }
  return { rings: out, map };
}

function dedupe(poly: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) > 1e-9) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0]!;
    const b = out[out.length - 1]!;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-9) break;
    out.pop();
  }
  return out;
}

const MERGE_TOL = 1e-7;

/**
 * Unions the coplanar strips swept by one face into its outline polygon(s):
 * shared edges cancel, the rest is traced into loops. Falls back to the raw
 * strips if the union is not a set of simple CCW loops.
 */
function mergeFace(face: Face, polys: Vec3[][]): Vec3[][] {
  const proj = (p: Vec3): Vec2 =>
    face.speed > 0 ? { x: p.x, y: p.y } : { x: dot(face.d, p), y: p.z };
  const P2: Vec2[] = [];
  const P3: Vec3[] = [];
  const idOf = (p: Vec3): number => {
    const q = proj(p);
    const k = P2.findIndex((r) => distance(r, q) < MERGE_TOL);
    if (k >= 0) return k;
    P3.push(p);
    return P2.push(q) - 1;
  };
  const kept: Vec3[][] = [];
  const segs: [number, number][] = [];
  for (const poly of polys) {
    const ids = poly.map(idOf).filter((v, i, arr) => v !== at(arr, i - 1));
    if (ids.length < 3 || Math.abs(signedArea(ids.map((i) => P2[i]!))) < 1e-12) continue;
    kept.push(poly);
    ids.forEach((v, i) => segs.push([v, at(ids, i + 1)]));
  }
  if (kept.length === 0) return [];

  // Split segments at T-junctions.
  const split: [number, number][] = [];
  for (const [s, t] of segs) {
    const a = P2[s]!;
    const ab = sub(P2[t]!, a);
    const len = Math.hypot(ab.x, ab.y);
    const inner = P2.map((p, c) => ({ c, f: dot(sub(p, a), ab) / (len * len), p }))
      .filter(
        ({ c, f, p }) =>
          c !== s && c !== t && f > 0 && f < 1 && Math.abs(cross(ab, sub(p, a))) / len < MERGE_TOL,
      )
      .sort((x, y) => x.f - y.f);
    const chain = [s, ...inner.map((x) => x.c), t];
    for (let q = 0; q + 1 < chain.length; q++) split.push([chain[q]!, chain[q + 1]!]);
  }

  // Cancel shared (opposite) segments.
  const count = new Map<string, number>();
  for (const [s, t] of split) {
    const opp = `${t},${s}`;
    const c = count.get(opp) ?? 0;
    if (c > 0) count.set(opp, c - 1);
    else count.set(`${s},${t}`, (count.get(`${s},${t}`) ?? 0) + 1);
  }
  const outs = new Map<number, number[]>();
  let total = 0;
  for (const [key, c] of count) {
    const [s, t] = key.split(',').map(Number) as [number, number];
    for (let q = 0; q < c; q++) {
      outs.set(s, [...(outs.get(s) ?? []), t]);
      total++;
    }
  }

  const loops: number[][] = [];
  let used = 0;
  for (;;) {
    const startEntry = [...outs.entries()].find(([, l]) => l.length > 0);
    if (!startEntry) break;
    const s0 = startEntry[0];
    const loop: number[] = [s0];
    let prev = s0;
    let cur = startEntry[1].shift()!;
    used++;
    for (let guard = 0; cur !== s0 && guard <= total; guard++) {
      loop.push(cur);
      const cand = outs.get(cur) ?? [];
      if (cand.length === 0) return kept;
      // First outgoing ray clockwise from the reversed incoming ray.
      const back = sub(P2[prev]!, P2[cur]!);
      const base = Math.atan2(back.y, back.x);
      let bestK = 0;
      let bestA = Infinity;
      cand.forEach((t, k) => {
        const dv = sub(P2[t]!, P2[cur]!);
        let a = base - Math.atan2(dv.y, dv.x);
        while (a <= 1e-12) a += 2 * Math.PI;
        if (a < bestA) {
          bestA = a;
          bestK = k;
        }
      });
      prev = cur;
      cur = cand.splice(bestK, 1)[0]!;
      used++;
    }
    if (cur !== s0) return kept;
    loops.push(loop);
  }
  if (used !== total) return kept;

  const result: Vec3[][] = [];
  for (const loop of loops) {
    const simple = loop.filter((v, i) => {
      const a = P2[at(loop, i - 1)]!;
      const p = P2[v]!;
      const b = P2[at(loop, i + 1)]!;
      const u = sub(p, a);
      const w = sub(b, p);
      const lu = Math.hypot(u.x, u.y);
      const lw = Math.hypot(w.x, w.y);
      return !(Math.abs(cross(u, w)) < 1e-9 * lu * lw && dot(u, w) > 0);
    });
    if (simple.length < 3) continue;
    const area = signedArea(simple.map((i) => P2[i]!));
    if (area < -1e-9) return kept;
    if (area > 1e-9) result.push(simple.map((i) => P3[i]!));
  }
  return result;
}
