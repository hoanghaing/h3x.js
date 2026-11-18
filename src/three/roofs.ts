import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three';
import type { Floor, Roof, Vec2 } from '../core';
import { roofGeometry, type RoofBody, type Vec3 } from '../core/roofs/geometry';
import { toWorld } from './coords';
import { TriangleSink, triangulateInto } from './triangulate';

/** Coincidence tolerance on roof face coordinates (metres). */
const EPS = 1e-6;
/** Below this |n.z| a face counts as vertical (gable / step verticals: left to the walls). */
const VERTICAL = 1e-6;
/** Parapet wall thickness (m), standing inside the outline. */
const PARAPET_THICKNESS = 0.1;
/** Frame bar cross-section (m) and spacing along the eaves (m). */
const BAR = 0.04;
const BAR_SPACING = 1;

/** A non-vertical face: its underside polygon, unit upward plane normal and top offset. */
interface Piece {
  poly: Vec3[];
  n: Vec3;
  /** Vertical thickness: `thickness / cos(pitch)`. */
  d: number;
}

const world = (p: Vec3, dz = 0): Vector3 => toWorld(p, p.z + dz);

/** Unit Newell normal of a planar polygon, z >= 0. */
function upNormal(poly: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  });
  const len = Math.hypot(x, y, z) || 1;
  const s = z < 0 ? -1 / len : 1 / len;
  return { x: x * s, y: y * s, z: z * s };
}

/** Plan normal (z up) to world (y up, plan y -> world -z). */
const worldDir = (n: Vec3): Vector3 => new Vector3(n.x, n.z, -n.y);

/** Height of the plane through `o` with normal `n` above plan point `p`. */
const planeZ = (o: Vec3, n: Vec3, p: Vec2): number =>
  o.z - (n.x * (p.x - o.x) + n.y * (p.y - o.y)) / n.z;

function pieces(body: RoofBody, thickness: number): Piece[] {
  const out: Piece[] = [];
  for (const f of body.faces) {
    if (f.polygon.length < 3) continue;
    const n = upNormal(f.polygon);
    if (n.z <= VERTICAL) continue;
    // Faces are CCW from above; keep that so the right normal of each edge points outward.
    let area = 0;
    f.polygon.forEach((a, i) => {
      const b = f.polygon[(i + 1) % f.polygon.length]!;
      area += a.x * b.y - b.x * a.y;
    });
    const poly = area < 0 ? [...f.polygon].reverse() : f.polygon;
    out.push({ poly, n, d: thickness / n.z });
  }
  return out;
}

/** Underside, top surface and exposed edge sides of every non-vertical face. */
function emitFaces(sink: TriangleSink, list: Piece[]): void {
  for (const p of list) {
    const contour = p.poly.map((q) => new Vector2(q.x, q.y));
    const o = p.poly[0]!;
    const at = (v: Vector2, dz: number): Vector3 =>
      toWorld({ x: v.x, y: v.y }, planeZ(o, p.n, v) + dz);
    const up = worldDir(p.n);
    triangulateInto(sink, contour, [], (v) => at(v, p.d), up);
    triangulateInto(sink, contour, [], (v) => at(v, 0), up.clone().negate());
  }
  list.forEach((p, i) => {
    p.poly.forEach((a, k) => {
      const b = p.poly[(k + 1) % p.poly.length]!;
      emitSide(sink, list, i, a, b);
    });
  });
}

/**
 * Side of edge a -> b of piece `i`: full height where no other face shares the edge (eaves
 * fascia, rakes, gable tops, hole sides), the step between the two tops where a thinner face
 * shares it, nothing where a face at least as thick does.
 */
function emitSide(sink: TriangleSink, list: Piece[], i: number, a: Vec3, b: Vec3): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS * EPS) return;
  const len = Math.sqrt(len2);
  const d = list[i]!.d;
  const param = (q: Vec3): number | null => {
    const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2;
    const off = Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / len;
    if (off > EPS) return null;
    return Math.abs(q.z - (a.z + (b.z - a.z) * t)) > EPS ? null : t;
  };
  const cover: { t0: number; t1: number; d: number }[] = [];
  list.forEach((o, j) => {
    if (j === i) return;
    o.poly.forEach((r, k) => {
      const s = o.poly[(k + 1) % o.poly.length]!;
      const tr = param(r);
      const ts = tr === null ? null : param(s);
      if (tr === null || ts === null) return;
      const t0 = Math.max(0, Math.min(tr, ts));
      const t1 = Math.min(1, Math.max(tr, ts));
      if ((t1 - t0) * len > EPS) cover.push({ t0, t1, d: o.d });
    });
  });
  const ts = [...new Set([0, 1, ...cover.flatMap((c) => [c.t0, c.t1])])].sort((x, y) => x - y);
  const out = new Vector3(dy / len, 0, dx / len); // right normal (dy, -dx) in plan
  const point = (t: number): Vec3 => ({
    x: a.x + dx * t,
    y: a.y + dy * t,
    z: a.z + (b.z - a.z) * t,
  });
  for (let k = 0; k + 1 < ts.length; k++) {
    const t0 = ts[k]!;
    const t1 = ts[k + 1]!;
    if ((t1 - t0) * len <= EPS) continue;
    const mid = (t0 + t1) / 2;
    let bottom = 0;
    let hidden = false;
    for (const c of cover) {
      if (c.t0 > mid || c.t1 < mid) continue;
      if (c.d >= d - EPS) hidden = true;
      else bottom = Math.max(bottom, c.d);
    }
    if (hidden) continue;
    const p0 = point(t0);
    const p1 = point(t1);
    sink.quad(world(p0, bottom), world(p1, bottom), world(p1, d), world(p0, d), out);
  }
}

/** Newell normal of world points, flipped to agree with `hint`. */
function worldNormal(pts: Vector3[], hint: Vector3): Vector3 {
  const n = new Vector3();
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  });
  if (n.lengthSq() < 1e-24) return hint.clone();
  n.normalize();
  return n.dot(hint) < 0 ? n.negate() : n;
}

/** A box-like prism: plan quad `base` (z per corner) raised vertically by `h`. 12 triangles. */
function prism(sink: TriangleSink, base: Vec3[], h: number): void {
  let area = 0;
  base.forEach((a, i) => {
    const b = base[(i + 1) % base.length]!;
    area += a.x * b.y - b.x * a.y;
  });
  const ring = area < 0 ? [...base].reverse() : base;
  const bot = ring.map((p) => world(p));
  const top = ring.map((p) => world(p, h));
  const [b0, b1, b2, b3] = bot as [Vector3, Vector3, Vector3, Vector3];
  const [t0, t1, t2, t3] = top as [Vector3, Vector3, Vector3, Vector3];
  sink.quad(t0, t1, t2, t3, worldNormal(top, new Vector3(0, 1, 0)));
  sink.quad(b0, b1, b2, b3, worldNormal(bot, new Vector3(0, -1, 0)));
  ring.forEach((a, i) => {
    const j = (i + 1) % ring.length;
    const b = ring[j]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const out = new Vector3((b.y - a.y) / len, 0, (b.x - a.x) / len);
    sink.quad(bot[i]!, bot[j]!, top[j]!, top[i]!, out);
  });
}

/** Parapet boxes: PARAPET_THICKNESS wide on the roof side (left) of each outline segment. */
function emitParapets(sink: TriangleSink, body: RoofBody): void {
  for (const { a, b, bottom, top } of body.parapets) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < EPS || top - bottom < EPS) continue;
    const nx = (-(b.y - a.y) / len) * PARAPET_THICKNESS;
    const ny = ((b.x - a.x) / len) * PARAPET_THICKNESS;
    prism(
      sink,
      [
        { x: a.x, y: a.y, z: bottom },
        { x: b.x, y: b.y, z: bottom },
        { x: b.x + nx, y: b.y + ny, z: bottom },
        { x: a.x + nx, y: a.y + ny, z: bottom },
      ],
      top - bottom,
    );
  }
}

function toGeometry(sink: TriangleSink): BufferGeometry {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}

function emitBody(sink: TriangleSink, body: RoofBody, roof: Roof): void {
  emitFaces(sink, pieces(body, roof.thickness));
  emitParapets(sink, body);
}

/**
 * Roof body mesh: every non-vertical face (slopes, overhang / rake strips, caps, flat slabs)
 * extruded upward by `thickness / cos(pitch)` (the underside is the soffit), with fascia sides
 * along the exposed edges (eaves, rakes, holes) and steps where faces of unequal pitch meet.
 * Vertical faces are skipped: the gable walls fill them (open gables stay open). Flat bodies
 * also get parapet boxes 0.1 m thick inside the outline.
 */
export function buildRoofGeometry(body: RoofBody, roof: Roof): BufferGeometry {
  const sink = new TriangleSink();
  emitBody(sink, body, roof);
  return toGeometry(sink);
}

/**
 * Decorative frame bars (0.04 × 0.04 m) running down the slope on top of every inclined
 * face, on a 1 m grid across the slope (aligned between faces of one plane). For glass /
 * polycarbonate roofs. The bars stand on the top surface of a roof `thickness` thick (0: on
 * the underside). Null when the body has no inclined face.
 */
export function buildRoofFrame(body: RoofBody, thickness = 0): BufferGeometry | null {
  const sink = new TriangleSink();
  emitFrame(sink, body, thickness);
  return sink.vertexCount > 0 ? toGeometry(sink) : null;
}

function emitFrame(sink: TriangleSink, body: RoofBody, thickness: number): void {
  for (const f of body.faces) {
    if (!f.slope || f.polygon.length < 3) continue;
    const n = upNormal(f.polygon);
    const g = Math.hypot(n.x, n.y);
    if (n.z <= VERTICAL || g < EPS) continue;
    const down = { x: n.x / g, y: n.y / g };
    const across = { x: -down.y, y: down.x };
    const o = f.polygon[0]!;
    const d = thickness / n.z;
    const ss = f.polygon.map((q) => q.x * across.x + q.y * across.y);
    const lo = Math.min(...ss);
    const hi = Math.max(...ss);
    const first = Math.ceil((lo + BAR / 2) / BAR_SPACING);
    for (let s = first * BAR_SPACING; s < hi - BAR / 2; s += BAR_SPACING) {
      // crossings of the line {p · across = s} with the face outline, along the slope
      const us: number[] = [];
      f.polygon.forEach((a, i) => {
        const b = f.polygon[(i + 1) % f.polygon.length]!;
        const sa = ss[i]! - s;
        const sb = ss[(i + 1) % ss.length]! - s;
        if (sa > 0 === sb > 0) return;
        const t = sa / (sa - sb);
        us.push((a.x + (b.x - a.x) * t) * down.x + (a.y + (b.y - a.y) * t) * down.y);
      });
      us.sort((x, y) => x - y);
      for (let k = 0; k + 1 < us.length; k += 2) {
        const u0 = us[k]!;
        const u1 = us[k + 1]!;
        if (u1 - u0 < EPS) continue;
        const corner = (u: number, w: number): Vec3 => {
          const p = {
            x: down.x * u + across.x * (s + w),
            y: down.y * u + across.y * (s + w),
          };
          return { ...p, z: planeZ(o, n, p) + d };
        };
        prism(
          sink,
          [corner(u0, -BAR / 2), corner(u1, -BAR / 2), corner(u1, BAR / 2), corner(u0, BAR / 2)],
          BAR,
        );
      }
    }
  }
}

/** Square posts `size` wide from each post's bottom to its top. Null when there are none. */
export function buildPostsGeometry(body: RoofBody, size: number): BufferGeometry | null {
  const sink = new TriangleSink();
  emitPosts(sink, body, size);
  return sink.vertexCount > 0 ? toGeometry(sink) : null;
}

function emitPosts(sink: TriangleSink, body: RoofBody, size: number): void {
  const h = size / 2;
  for (const p of body.posts) {
    if (p.top - p.bottom < EPS) continue;
    prism(
      sink,
      [
        { x: p.x - h, y: p.y - h, z: p.bottom },
        { x: p.x + h, y: p.y - h, z: p.bottom },
        { x: p.x + h, y: p.y + h, z: p.bottom },
        { x: p.x - h, y: p.y + h, z: p.bottom },
      ],
      p.top - p.bottom,
    );
  }
}

/** The geometries of one roof on its floor; null parts are not drawn. */
export interface RoofParts {
  body: BufferGeometry | null;
  /** Glass / polycarbonate frame bars. */
  frame: BufferGeometry | null;
  /** `supports: 'posts'`. */
  posts: BufferGeometry | null;
}

/**
 * Every body of a roof (`roofGeometry`) merged into one body, frame and posts geometry.
 * Failed roofs give their flat fallback; never throws (an unexpected error gives no parts).
 */
export function buildRoofParts(roof: Roof, floor: Readonly<Floor>): RoofParts {
  const none: RoofParts = { body: null, frame: null, posts: null };
  let bodies: RoofBody[];
  try {
    bodies = roofGeometry(roof, floor).bodies;
  } catch {
    return none;
  }
  const bodySink = new TriangleSink();
  const frameSink = new TriangleSink();
  const postSink = new TriangleSink();
  const light = roof.material === 'glass' || roof.material === 'polycarbonate';
  try {
    for (const b of bodies) {
      emitBody(bodySink, b, roof);
      if (light) emitFrame(frameSink, b, roof.thickness);
      emitPosts(postSink, b, roof.postSize ?? 0.1);
    }
  } catch {
    return none;
  }
  const geom = (s: TriangleSink): BufferGeometry | null =>
    s.vertexCount > 0 ? toGeometry(s) : null;
  return { body: geom(bodySink), frame: geom(frameSink), posts: geom(postSink) };
}
