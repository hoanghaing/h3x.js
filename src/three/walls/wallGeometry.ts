import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three';
import type { Floor, Id, Vec2 } from '../../core';
import { GEOM_TOL } from '../../core/constants';
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
function openingCuts(floor: Floor, wallId: Id, xMin: number, xMax: number, h: number): Cut[] {
  const raw: Cut[] = [];
  for (const o of Object.values(floor.openings)) {
    if (o.wall !== wallId) continue;
    const x0 = Math.max(o.offset - o.width / 2, xMin);
    const x1 = Math.min(o.offset + o.width / 2, xMax);
    const v0 = o.sill <= GEOM_TOL ? 0 : Math.min(o.sill, h - GEOM_TOL);
    const v1 = Math.min(o.sill + o.height, h - GEOM_TOL);
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
  outline.push(new Vector2(face.len, 0), new Vector2(face.len, h), new Vector2(0, h));

  const toW = (p: Vector2) => toWorld(add(face.start, scale(dir, p.x)), elevation + p.y);
  triangulateInto(sink, outline, holes, toW, want);
}

function degree(floor: Floor, nodeId: Id): number {
  let n = 0;
  for (const w of Object.values(floor.walls)) if (w.a === nodeId || w.b === nodeId) n++;
  return n;
}

/**
 * Wall mesh geometry: left face, right face and trim (top cap, end caps at
 * free ends, opening reveals), as groups in WALL_GROUP order. No bottom face.
 */
export function buildWallGeometry(floor: Floor, wallId: Id, corners: WallCorners): BufferGeometry {
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
    // Clamp cuts so they lie strictly inside both faces (keeps reveals flush with both).
    const xMin = Math.max(left.s, right.s) + GEOM_TOL;
    const xMax = Math.min(left.s + left.len, right.s + right.len) - GEOM_TOL;
    const cuts = openingCuts(floor, wallId, xMin, xMax, h);

    const nW = new Vector3(n.x, 0, -n.y);
    // A short wall between long miters can have a face of zero or negative length;
    // skip it rather than emit a self-intersecting outline.
    if (left.len > GEOM_TOL) buildFace(sinks[WALL_GROUP.left], left, dir, cuts, h, elev, nW);
    if (right.len > GEOM_TOL) {
      buildFace(sinks[WALL_GROUP.right], right, dir, cuts, h, elev, nW.clone().negate());
    }

    const trim = sinks[WALL_GROUP.trim];
    const up = new Vector3(0, 1, 0);
    const down = new Vector3(0, -1, 0);

    // Top cap.
    const top = [corners.startLeft, corners.endLeft, corners.endRight, corners.startRight];
    const top2 = top.map((p) => new Vector2(p.x, p.y));
    triangulateInto(trim, top2, [], (p) => toWorld(p, elev + h), up);

    // End caps at free ends.
    const cap = (l: Vec2, r: Vec2, out: Vec2) => {
      const want = new Vector3(out.x, 0, -out.y);
      trim.quad(
        toWorld(l, elev),
        toWorld(r, elev),
        toWorld(r, elev + h),
        toWorld(l, elev + h),
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
