import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three';
import type { Floor, Id, Vec2, Wall } from '../../core';
import { GEOM_TOL } from '../../core/constants';
import { openingCut } from '../../core/openings/geometry';
import { gableProfile } from '../../core/roofs/geometry';
import { add, dot, leftNormal, normalize, scale, sub } from '../../core/geometry/vec';
import { toWorld } from '../coords';
import { TriangleSink, triangulateInto } from '../triangulate';
import type { WallCorners } from './joins';

/** Material group indices of a wall geometry. */
export const WALL_GROUP = { left: 0, right: 1, trim: 2 } as const;

/** An opening cut, in wall-axis distance from node a (x) and height above the floor (v). */
interface Cut {
  x0: number;
  x1: number;
  v0: number;
  v1: number;
}

/** One side face of the wall: its start corner and axis offset of that corner. */
interface Face {
  start: Vec2;
  s: number;
  len: number;
}

/**
 * Clamped opening cuts sorted along the wall. A cut overlapping an earlier one by
 * more than GEOM_TOL (validation normally prevents this) is skipped rather than merged.
 */
function openingCuts(floor: Floor, wall: Wall, a: Vec2, dir: Vec2, corners: WallCorners): Cut[] {
  const raw: Cut[] = [];
  for (const o of Object.values(floor.openings)) {
    if (o.wall !== wall.id) continue;
    const { x0, x1, z0: v0, z1: v1 } = openingCut(o, a, dir, wall.height, corners);
    if (x1 - x0 <= GEOM_TOL || v1 - v0 <= GEOM_TOL) continue;
    raw.push({ x0, x1, v0, v1 });
  }
  raw.sort((p, q) => p.x0 - q.x0);
  const out: Cut[] = [];
  for (const c of raw) {
    const prev = out[out.length - 1];
    // Openings that only touch (overlap ≤ GEOM_TOL) are both kept, as in core validation.
    if (prev && prev.x1 - c.x0 > GEOM_TOL) continue;
    // Snap a sub-tolerance overlap so the face outline never doubles back.
    out.push(prev && c.x0 < prev.x1 ? { ...c, x0: prev.x1 } : c);
  }
  return out;
}

/** Triangulates one side face (outline with door notches, window holes) into `sink`. */
function buildFace(
  sink: TriangleSink,
  face: Face,
  dir: Vec2,
  cuts: Cut[],
  h: number,
  elevation: number,
  want: Vector3,
  top: Top | null,
): void {
  const outline: Vector2[] = [new Vector2(0, 0)];
  const holes: Vector2[][] = [];
  for (const c of cuts) {
    const u0 = c.x0 - face.s;
    const u1 = c.x1 - face.s;
    if (c.v0 === 0) {
      outline.push(
        new Vector2(u0, 0),
        new Vector2(u0, c.v1),
        new Vector2(u1, c.v1),
        new Vector2(u1, 0),
      );
    } else {
      holes.push([
        new Vector2(u0, c.v0),
        new Vector2(u1, c.v0),
        new Vector2(u1, c.v1),
        new Vector2(u0, c.v1),
      ]);
    }
  }
  outline.push(new Vector2(face.len, 0));
  if (top) {
    // Raised top edge, from the end back to the start along the profile.
    const xs = top.breaks.filter((x) => x > face.s + GEOM_TOL && x < face.s + face.len - GEOM_TOL);
    const pts = [face.s + face.len, ...xs.reverse(), face.s].map(
      (x) => new Vector2(x - face.s, top.at(x)),
    );
    outline.push(...dropCollinear(pts));
  } else {
    outline.push(new Vector2(face.len, h), new Vector2(0, h));
  }

  const toW = (p: Vector2) => toWorld(add(face.start, scale(dir, p.x)), elevation + p.y);
  triangulateInto(sink, outline, holes, toW, want);
}

/** A raised wall top: height above the floor at an axis distance, and the profile breaks. */
interface Top {
  at: (x: number) => number;
  breaks: number[];
}

/**
 * The wall top under a gable profile `(axis distance, absolute height)`: the profile clamped to
 * its own range, never below the wall height `h`. Null when the profile never rises above h.
 */
function raisedTop(profile: Vec2[] | null, h: number, elevation: number): Top | null {
  if (!profile || profile.length === 0) return null;
  const pts = [...profile].sort((p, q) => p.x - q.x);
  if (pts.every((p) => p.y - elevation <= h + GEOM_TOL)) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const raw = (x: number): number => {
    if (x <= first.x) return first.y;
    if (x >= last.x) return last.y;
    for (let i = 0; i + 1 < pts.length; i++) {
      const p = pts[i]!;
      const q = pts[i + 1]!;
      if (x > q.x) continue;
      // Vertical steps (equal x): take the higher side.
      if (q.x - p.x <= 1e-12) return Math.max(p.y, q.y);
      return p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
    }
    return last.y;
  };
  const at = (x: number): number => Math.max(h, raw(x) - elevation);
  // Where the profile crosses the wall height the clamped top bends too.
  const breaks = pts.map((p) => p.x);
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!.y - elevation - h;
    const b = pts[i + 1]!.y - elevation - h;
    if (a * b < 0) breaks.push(pts[i]!.x + ((pts[i + 1]!.x - pts[i]!.x) * a) / (a - b));
  }
  breaks.sort((p, q) => p - q);
  return { at, breaks: breaks.filter((x, i) => i === 0 || x - breaks[i - 1]! > GEOM_TOL) };
}

/** Drops interior points lying on the segment between their neighbours. */
function dropCollinear(pts: Vector2[]): Vector2[] {
  const out: Vector2[] = [];
  for (const p of pts) {
    while (out.length >= 2) {
      const a = out[out.length - 2]!;
      const b = out[out.length - 1]!;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) > 1e-9) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Clips a convex plan polygon to `lo <= along(p) <= hi`. */
function clipAlong(poly: Vec2[], along: (p: Vec2) => number, lo: number, hi: number): Vec2[] {
  const half = (pts: Vec2[], keep: (p: Vec2) => number): Vec2[] => {
    const out: Vec2[] = [];
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      const kp = keep(p);
      const kq = keep(q);
      if (kp >= 0) out.push(p);
      if (kp >= 0 !== kq >= 0) out.push(add(p, scale(sub(q, p), kp / (kp - kq))));
    });
    return out;
  };
  return half(
    half(poly, (p) => along(p) - lo),
    (p) => hi - along(p),
  );
}

function degree(floor: Floor, nodeId: Id): number {
  let n = 0;
  for (const w of Object.values(floor.walls)) if (w.a === nodeId || w.b === nodeId) n++;
  return n;
}

/**
 * Wall mesh geometry: left face, right face and trim (top cap, end caps at
 * free ends, opening reveals), as groups in WALL_GROUP order. No bottom face.
 * A wall under gable roof edges has its top raised along `profile` (default:
 * `gableProfile(floor, wallId)`; pass null to skip): faces, top cap and end caps follow the
 * profile clamped to its range, never below the wall height. Openings are unchanged.
 */
export function buildWallGeometry(
  floor: Floor,
  wallId: Id,
  corners: WallCorners,
  profile?: Vec2[] | null,
): BufferGeometry {
  const geom = new BufferGeometry();
  const wall = floor.walls[wallId];
  const a = wall && floor.nodes[wall.a];
  const b = wall && floor.nodes[wall.b];
  const sinks = [new TriangleSink(), new TriangleSink(), new TriangleSink()] as const;

  if (wall && a && b) {
    const h = wall.height;
    const elev = floor.elevation;
    const dir = normalize(sub(b, a));
    const n = leftNormal(dir);
    const along = (p: Vec2) => dot(sub(p, a), dir);
    const left: Face = {
      start: corners.startLeft,
      s: along(corners.startLeft),
      len: dot(sub(corners.endLeft, corners.startLeft), dir),
    };
    const right: Face = {
      start: corners.startRight,
      s: along(corners.startRight),
      len: dot(sub(corners.endRight, corners.startRight), dir),
    };
    // Cuts are clamped strictly inside both faces (keeps reveals flush with both).
    const cuts = openingCuts(floor, wall, a, dir, corners);
    const top = raisedTop(profile === undefined ? gableProfile(floor, wallId) : profile, h, elev);
    const hAt = (p: Vec2): number => (top ? top.at(along(p)) : h);

    const nW = new Vector3(n.x, 0, -n.y);
    // A short wall between long miters can have a face of zero or negative length;
    // skip it rather than emit a self-intersecting outline.
    if (left.len > GEOM_TOL) buildFace(sinks[WALL_GROUP.left], left, dir, cuts, h, elev, nW, top);
    if (right.len > GEOM_TOL) {
      buildFace(sinks[WALL_GROUP.right], right, dir, cuts, h, elev, nW.clone().negate(), top);
    }

    const trim = sinks[WALL_GROUP.trim];
    const up = new Vector3(0, 1, 0);
    const down = new Vector3(0, -1, 0);

    // Top cap: flat, or one planar strip per profile segment.
    const quad = [corners.startLeft, corners.endLeft, corners.endRight, corners.startRight];
    if (top) {
      const ends = quad.map(along);
      const lo = Math.min(...ends);
      const hi = Math.max(...ends);
      const xs = [lo, ...top.breaks.filter((x) => x > lo + GEOM_TOL && x < hi - GEOM_TOL), hi];
      for (let k = 0; k + 1 < xs.length; k++) {
        const x0 = xs[k]!;
        const x1 = xs[k + 1]!;
        if (x1 - x0 <= GEOM_TOL) continue;
        const piece = clipAlong(quad, along, x0, x1);
        if (piece.length < 3) continue;
        const g = (top.at(x1) - top.at(x0)) / (x1 - x0);
        const want = new Vector3(-g * dir.x, 1, g * dir.y).normalize();
        const w = piece.map((p) => toWorld(p, elev + top.at(along(p))));
        for (let i = 1; i + 1 < w.length; i++) trim.tri(w[0]!, w[i]!, w[i + 1]!, want);
      }
    } else {
      const top2 = quad.map((p) => new Vector2(p.x, p.y));
      triangulateInto(trim, top2, [], (p) => toWorld(p, elev + h), up);
    }

    // End caps at free ends.
    const cap = (l: Vec2, r: Vec2, out: Vec2) => {
      const want = new Vector3(out.x, 0, -out.y);
      trim.quad(
        toWorld(l, elev),
        toWorld(r, elev),
        toWorld(r, elev + hAt(r)),
        toWorld(l, elev + hAt(l)),
        want,
      );
    };
    if (degree(floor, wall.a) === 1) cap(corners.startLeft, corners.startRight, scale(dir, -1));
    if (degree(floor, wall.b) === 1) cap(corners.endLeft, corners.endRight, dir);

    // Reveals.
    const onLeft = (x: number) => add(left.start, scale(dir, x - left.s));
    const onRight = (x: number) => add(right.start, scale(dir, x - right.s));
    const dirW = new Vector3(dir.x, 0, -dir.y);
    for (const c of cuts) {
      const l0 = onLeft(c.x0);
      const r0 = onRight(c.x0);
      const l1 = onLeft(c.x1);
      const r1 = onRight(c.x1);
      const vertical = (l: Vec2, r: Vec2, want: Vector3) =>
        trim.quad(
          toWorld(l, elev + c.v0),
          toWorld(r, elev + c.v0),
          toWorld(r, elev + c.v1),
          toWorld(l, elev + c.v1),
          want,
        );
      const horizontal = (v: number, want: Vector3) =>
        trim.quad(
          toWorld(l0, elev + v),
          toWorld(l1, elev + v),
          toWorld(r1, elev + v),
          toWorld(r0, elev + v),
          want,
        );
      vertical(l0, r0, dirW);
      vertical(l1, r1, dirW.clone().negate());
      horizontal(c.v1, down);
      if (c.v0 > GEOM_TOL) horizontal(c.v0, up);
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  let start = 0;
  sinks.forEach((s, group) => {
    positions.push(...s.positions);
    normals.push(...s.normals);
    geom.addGroup(start, s.vertexCount, group);
    start += s.vertexCount;
  });
  geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  return geom;
}
