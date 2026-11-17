import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import { SPIRAL_COLUMN_DIAMETER, type Floor, type StairLayout, type Vec2 } from '../core';
import { pointInPolygon } from '../core/geometry/polygon';
import { closestPointOnSegment } from '../core/geometry/segment';
import { toWorld } from './coords';
import { triangulate2D } from './openings';
import { TriangleSink } from './triangulate';

type OkLayout = Extract<StairLayout, { ok: true }>;

/** Thickness (m) of the concrete waist below the flights, measured square to the pitch, and of landings. */
export const STAIR_WAIST = 0.12;
/** Handrail height (m) above the step nosings. */
export const HANDRAIL_HEIGHT = 0.9;
/** Handrail square cross-section (m). */
const RAIL_SIZE = 0.05;
/** Distance (m) of the handrail centre line in from the open edge of a flight. */
const RAIL_INSET = 0.05;
/** Spacing (m) of the walking-line samples used to follow the nosings. */
const RAIL_SAMPLE = 0.02;
const COLUMN_SEGMENTS = 16;

interface Piece {
  outline: Vec2[];
  top: number;
  step: boolean;
}

/** Steps and landings in climbing order. */
function pieces(layout: OkLayout): Piece[] {
  return [
    ...layout.steps.map((s) => ({ ...s, step: true })),
    ...layout.landings.map((s) => ({ ...s, step: false })),
  ].sort((a, b) => a.top - b.top);
}

const centroid = (pts: Vec2[]): Vec2 => ({
  x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
  y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
});

/** A 4-vertex polygon with right angles (flight treads; spiral wedges are not). */
function isRect(pts: Vec2[]): boolean {
  if (pts.length !== 4) return false;
  return pts.every((p, i) => {
    const a = pts[(i + 3) % 4]!;
    const b = pts[(i + 1) % 4]!;
    const u = { x: a.x - p.x, y: a.y - p.y };
    const v = { x: b.x - p.x, y: b.y - p.y };
    const l = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    return l > 0 && Math.abs(u.x * v.x + u.y * v.y) / l < 1e-6;
  });
}

/**
 * Closed prism over a counter-clockwise plan outline: flat top at `top`, bottom at `bottom(p)`
 * (always below the top), vertical sides. Heights are above the floor elevation `base`.
 */
function prism(
  sink: TriangleSink,
  outline: Vec2[],
  top: number,
  bottom: (p: Vec2) => number,
  base: number,
): void {
  const up = new Vector3(0, 1, 0);
  const down = new Vector3(0, -1, 0);
  const hi = (p: Vec2) => toWorld(p, base + top);
  const lo = (p: Vec2) => toWorld(p, base + bottom(p));
  for (const [a, b, c] of triangulate2D(outline, []) as [Vec2, Vec2, Vec2][]) {
    sink.tri(hi(a), hi(b), hi(c), up);
    sink.tri(lo(a), lo(b), lo(c), down);
  }
  outline.forEach((p, i) => {
    const q = outline[(i + 1) % outline.length]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    sink.quad(hi(p), hi(q), lo(q), lo(p), new Vector3(dy / len, 0, dx / len));
  });
}

function finish(sink: TriangleSink): BufferGeometry {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  // Sloped soffits: replace the hint normals with the true (flat) face normals.
  geom.computeVertexNormals();
  return geom;
}

/**
 * Concrete stair mass for an ok layout: each step is a solid on a sloped soffit `STAIR_WAIST`
 * below the line of its inner corners (clamped to the floor), landings are slabs
 * `STAIR_WAIST` thick, winder and spiral wedges follow the same rule along their climb, and a
 * spiral gets its centre column up to the floor above. World coordinates (elevation baked in).
 */
export function buildStairGeometry(layout: OkLayout, floor: Floor): BufferGeometry {
  const sink = new TriangleSink();
  const h = layout.riserHeight;
  const slope = layout.treadDepth > 0 ? h / layout.treadDepth : 0;
  const waist = STAIR_WAIST * Math.sqrt(1 + slope * slope);
  const list = pieces(layout);
  const centres = list.map((p) => centroid(p.outline));

  list.forEach((piece, i) => {
    if (!piece.step) {
      prism(
        sink,
        piece.outline,
        piece.top,
        () => Math.max(0, piece.top - STAIR_WAIST),
        floor.elevation,
      );
      return;
    }
    // Climb direction: from the previous step, or toward the next piece after a landing / at the start.
    const c = centres[i]!;
    const prev = i > 0 && list[i - 1]!.step ? centres[i - 1] : undefined;
    const next = centres[i + 1];
    let dir = prev
      ? { x: c.x - prev.x, y: c.y - prev.y }
      : next
        ? { x: next.x - c.x, y: next.y - c.y }
        : { x: 0, y: 0 };
    const len = Math.hypot(dir.x, dir.y);
    dir = len > 1e-9 ? { x: dir.x / len, y: dir.y / len } : { x: 0, y: 0 };
    const proj = (p: Vec2) => p.x * dir.x + p.y * dir.y;
    const ps = piece.outline.map(proj);
    const min = Math.min(...ps);
    const range = Math.max(...ps) - min;
    const u = (p: Vec2) => (range > 1e-9 ? (proj(p) - min) / range : 1);
    prism(
      sink,
      piece.outline,
      piece.top,
      (p) => Math.max(0, piece.top - waist - h * (1 - u(p))),
      floor.elevation,
    );
  });

  const first = layout.steps[0];
  if (first && !isRect(first.outline)) {
    const centre = centroid(layout.opening);
    const r = SPIRAL_COLUMN_DIAMETER / 2;
    const column = Array.from({ length: COLUMN_SEGMENTS }, (_, k) => {
      const a = (2 * Math.PI * k) / COLUMN_SEGMENTS;
      return { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) };
    });
    prism(sink, column, layout.risers * h, () => 0, floor.elevation);
  }
  return finish(sink);
}

/** Distance from p to the nearest edge of a polygon. */
function boundaryDistance(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  poly.forEach((a, i) => {
    const { point } = closestPointOnSegment(p, a, poly[(i + 1) % poly.length]!);
    best = Math.min(best, Math.hypot(point.x - p.x, point.y - p.y));
  });
  return best;
}

/** Polyline offset by `d` to its left (negative: right), mitred at the inner vertices. */
function offsetPolyline(line: Vec2[], d: number): Vec2[] {
  const normals = line.slice(1).map((q, i) => {
    const p = line[i]!;
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: -(q.y - p.y) / len, y: (q.x - p.x) / len };
  });
  return line.map((p, i) => {
    const a = normals[Math.max(0, i - 1)]!;
    const b = normals[Math.min(normals.length - 1, i)]!;
    const m = { x: a.x + b.x, y: a.y + b.y };
    const ml = Math.hypot(m.x, m.y);
    const n = ml > 1e-9 ? { x: m.x / ml, y: m.y / ml } : a;
    const cos = n.x * a.x + n.y * a.y;
    const k = cos > 0.2 ? d / cos : d;
    return { x: p.x + n.x * k, y: p.y + n.y * k };
  });
}

/** Square box around segment p→q (world), closed. */
function railBox(sink: TriangleSink, p: Vector3, q: Vector3): void {
  const dir = new Vector3().subVectors(q, p);
  if (dir.lengthSq() < 1e-12) return;
  dir.normalize();
  let side = new Vector3().crossVectors(dir, new Vector3(0, 1, 0));
  if (side.lengthSq() < 1e-12) side = new Vector3(1, 0, 0);
  side.normalize();
  const up = new Vector3().crossVectors(side, dir).normalize();
  const s = RAIL_SIZE / 2;
  const corner = (base: Vector3, i: number, j: number) =>
    base
      .clone()
      .addScaledVector(side, i * s)
      .addScaledVector(up, j * s);
  const ring = (base: Vector3) => [
    corner(base, -1, -1),
    corner(base, 1, -1),
    corner(base, 1, 1),
    corner(base, -1, 1),
  ];
  const a = ring(p);
  const b = ring(q);
  const outward = [up.clone().negate(), side.clone(), up.clone(), side.clone().negate()];
  for (let k = 0; k < 4; k++) {
    const l = (k + 1) % 4;
    sink.quad(a[k]!, a[l]!, b[l]!, b[k]!, outward[k]!);
  }
  sink.quad(a[0]!, a[1]!, a[2]!, a[3]!, dir.clone().negate());
  sink.quad(b[0]!, b[1]!, b[2]!, b[3]!, dir);
}

/**
 * One handrail `HANDRAIL_HEIGHT` above the nosings: along the open side of the flights (the
 * side away from the bay edge: the well side for L / U), along the outer edge for a spiral.
 * Returns null when the layout has no walking line.
 */
export function buildHandrailGeometry(layout: OkLayout, floor: Floor): BufferGeometry | null {
  const walk = layout.walkLine;
  const first = layout.steps[0];
  if (walk.length < 2 || !first) return null;
  const w0 = walk[0]!;
  const w1 = walk[1]!;
  const d0 = { x: w1.x - w0.x, y: w1.y - w0.y };
  const l0 = Math.hypot(d0.x, d0.y);
  if (!(l0 > 1e-9)) return null;
  const left = { x: -d0.y / l0, y: d0.x / l0 };

  let offset: number;
  if (isRect(first.outline)) {
    const proj = first.outline.map((p) => (p.x - w0.x) * left.x + (p.y - w0.y) * left.y);
    const fw = Math.max(...proj) - Math.min(...proj);
    const mid = { x: (w0.x + w1.x) / 2, y: (w0.y + w1.y) / 2 };
    const at = (s: number) => ({
      x: mid.x + left.x * s * (fw / 2),
      y: mid.y + left.y * s * (fw / 2),
    });
    const sign =
      boundaryDistance(at(1), layout.opening) >= boundaryDistance(at(-1), layout.opening) - 1e-9
        ? 1
        : -1;
    offset = sign * Math.max(0, fw / 2 - RAIL_INSET);
  } else {
    // spiral: the walking line is at 2/3 of the radius; the rail runs inside the outer edge
    const c = centroid(layout.opening);
    const rw = Math.hypot(w0.x - c.x, w0.y - c.y);
    const centreLeft = (c.x - w0.x) * left.x + (c.y - w0.y) * left.y > 0;
    offset = (centreLeft ? -1 : 1) * Math.max(0, rw / 2 - RAIL_INSET);
  }
  const path = offsetPolyline(walk, offset);

  // Sample the walking line; each sample takes the piece it lies in.
  const list = pieces(layout);
  interface Sample {
    s: number;
    rail: Vec2;
    piece: number;
  }
  const samples: Sample[] = [];
  let acc = 0;
  for (let k = 0; k + 1 < walk.length; k++) {
    const a = walk[k]!;
    const b = walk[k + 1]!;
    const pa = path[k]!;
    const pb = path[k + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(len / RAIL_SAMPLE));
    const dir = len > 1e-9 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 0, y: 0 };
    for (let j = 0; j <= n; j++) {
      if (j === 0 && k > 0) continue;
      const t = j / n;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const probes = [
        p,
        { x: p.x + dir.x * 1e-6, y: p.y + dir.y * 1e-6 },
        { x: p.x - dir.x * 1e-6, y: p.y - dir.y * 1e-6 },
      ];
      let piece = -1;
      for (const q of probes) {
        // highest piece wins on a shared riser (both give the same nosing height there)
        for (let i = list.length - 1; i >= 0 && piece < 0; i--) {
          if (pointInPolygon(q, list[i]!.outline)) piece = i;
        }
        if (piece >= 0) break;
      }
      if (piece < 0) continue;
      samples.push({
        s: acc + len * t,
        rail: { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t },
        piece,
      });
    }
    acc += len;
  }
  const range = new Map<number, [number, number]>();
  for (const { s, piece } of samples) {
    const r = range.get(piece);
    range.set(piece, r ? [Math.min(r[0], s), Math.max(r[1], s)] : [s, s]);
  }
  const h = layout.riserHeight;
  const pts: Vector3[] = samples.map(({ s, rail, piece }) => {
    const pc = list[piece]!;
    const [s0, s1] = range.get(piece)!;
    const u = pc.step && s1 - s0 > 1e-9 ? (s - s0) / (s1 - s0) : 0;
    const nosing = pc.top + (pc.step ? h * u : 0);
    return toWorld(rail, floor.elevation + nosing + HANDRAIL_HEIGHT);
  });

  // Drop collinear points.
  const line: Vector3[] = [];
  for (const p of pts) {
    if (line.length >= 2) {
      const a = line[line.length - 2]!;
      const b = line[line.length - 1]!;
      const ab = new Vector3().subVectors(b, a);
      const ap = new Vector3().subVectors(p, a);
      const l = ap.length();
      if (l > 1e-9 && new Vector3().crossVectors(ab, ap).length() / l < 1e-5 && ab.dot(ap) > 0) {
        line[line.length - 1] = p;
        continue;
      }
    }
    if (line.length === 0 || line[line.length - 1]!.distanceTo(p) > 1e-6) line.push(p);
  }
  if (line.length < 2) return null;
  const sink = new TriangleSink();
  for (let i = 0; i + 1 < line.length; i++) railBox(sink, line[i]!, line[i + 1]!);
  return finish(sink);
}
