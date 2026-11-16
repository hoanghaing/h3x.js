import type { Column, Floor, Id, Item, Opening, PresetResolver, Room, Vec2 } from '../core';
import { roomArea, roomShape } from '../core';
import { GEOM_TOL } from '../core/constants';
import { add, cross, leftNormal, normalize, scale, sub } from '../core/geometry/vec';
import { obbCorners } from '../core/geometry/obb';
import { pointInPolygon } from '../core/geometry/polygon';
import type { Joins, WallCorners } from '../shared/walls/joins';

/** Thickness (m) of the box drawn for a wall-mounted item. */
const WALL_ITEM_DEPTH = 0.1;

/** Wall outline: [startLeft, endLeft, endRight, startRight]. */
export function wallOutline(c: WallCorners): Vec2[] {
  return [c.startLeft, c.endLeft, c.endRight, c.startRight];
}

/** Node id to the polygon covering the uncovered area at that junction. */
export function junctionPolygons(joins: Joins): Record<Id, Vec2[]> {
  const out: Record<Id, Vec2[]> = {};
  for (const [id, j] of Object.entries(joins.junctions)) out[id] = j.points;
  return out;
}

/** Chords within this fraction of the widest count as equally wide when placing a label. */
const LABEL_WIDTH_SLACK = 0.05;

/** Area centroid's y, or the vertex mean for a degenerate polygon. */
function centroidY(poly: Vec2[]): number {
  let a2 = 0;
  let cy = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length]!;
    const c = p.x * q.y - q.x * p.y;
    a2 += c;
    cy += (p.y + q.y) * c;
  });
  if (Math.abs(a2) < GEOM_TOL) return poly.reduce((s, p) => s + p.y, 0) / (poly.length || 1);
  return cy / (3 * a2);
}

/** Inside the outer ring and outside every hole. */
export function inRoomShape(p: Vec2, shape: { outer: Vec2[]; holes: Vec2[][] }): boolean {
  return pointInPolygon(p, shape.outer) && !shape.holes.some((h) => pointInPolygon(p, h));
}

/**
 * Midpoint of a widest horizontal chord through the net area, sampled at several heights; among
 * chords about as wide as the widest, the one nearest the outline's vertical middle.
 */
function labelPoint(shape: { outer: Vec2[]; holes: Vec2[][] }): Vec2 {
  const poly = shape.outer;
  const minY = Math.min(...poly.map((p) => p.y));
  const maxY = Math.max(...poly.map((p) => p.y));
  const chords: Array<{ mid: Vec2; width: number }> = [];
  const STEPS = 16;
  for (let s = 1; s < STEPS; s++) {
    const y = minY + ((maxY - minY) * s) / STEPS;
    const xs: number[] = [];
    for (const ring of [poly, ...shape.holes]) {
      ring.forEach((p, i) => {
        const q = ring[(i + 1) % ring.length]!;
        if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
      });
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const mid = { x: (xs[k]! + xs[k + 1]!) / 2, y };
      if (inRoomShape(mid, shape)) chords.push({ mid, width: xs[k + 1]! - xs[k]! });
    }
  }
  if (chords.length > 0) {
    const widest = Math.max(...chords.map((c) => c.width));
    const cy = centroidY(poly);
    const wide = chords.filter((c) => c.width >= widest * (1 - LABEL_WIDTH_SLACK) - GEOM_TOL);
    return wide.reduce((b, c) => (Math.abs(c.mid.y - cy) < Math.abs(b.mid.y - cy) ? c : b)).mid;
  }
  const n = poly.length || 1;
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  };
}

export function roomLabel(floor: Floor, room: Room): { at: Vec2; name: string; area: string } {
  return {
    at: labelPoint(roomShape(floor, room, 'inner')),
    name: room.name,
    area: `${roomArea(floor, room, 'inner').toFixed(1)} m²`,
  };
}

/** One SVG path (outer ring, then each hole) meant to be filled with `fill-rule="evenodd"`. */
export function roomPath(shape: { outer: Vec2[]; holes: Vec2[][] }): string {
  return [shape.outer, ...shape.holes]
    .filter((ring) => ring.length > 0)
    .map((ring) => `M${ring.map((p) => `${p.x},${p.y}`).join('L')}Z`)
    .join('');
}

/** A column's plan shape: a circle, or the (rotated) rectangle's corners. */
export function columnShape(
  c: Column,
): { kind: 'circle'; cx: number; cy: number; r: number } | { kind: 'polygon'; points: Vec2[] } {
  if (c.shape === 'round') return { kind: 'circle', cx: c.x, cy: c.y, r: c.width / 2 };
  return {
    kind: 'polygon',
    points: obbCorners({
      center: { x: c.x, y: c.y },
      halfW: c.width / 2,
      halfD: (c.depth ?? c.width) / 2,
      rotation: c.rotation,
    }),
  };
}

export interface OpeningShape {
  kind: 'door' | 'window';
  gap: [Vec2, Vec2, Vec2, Vec2];
  leaf?: [Vec2, Vec2];
  /** `sweep` is the SVG sweep flag for plan-space coordinates (1 = increasing angle, CCW with +y up). */
  arc?: { from: Vec2; to: Vec2; center: Vec2; r: number; sweep: 0 | 1 };
  lines?: [Vec2, Vec2][];
}

export function openingShape(floor: Floor, o: Opening): OpeningShape {
  const wall = floor.walls[o.wall];
  const a = wall && floor.nodes[wall.a];
  const b = wall && floor.nodes[wall.b];
  if (!wall || !a || !b) {
    const z = { x: 0, y: 0 };
    return { kind: 'door', gap: [z, z, z, z] };
  }
  const d = normalize(sub(b, a));
  const n = leftNormal(d);
  const t = wall.thickness;
  const half = o.width / 2;
  const c = add(a, scale(d, o.offset));
  const near = sub(c, scale(d, half));
  const far = add(c, scale(d, half));
  const nt = scale(n, t / 2);
  const gap: [Vec2, Vec2, Vec2, Vec2] = [add(near, nt), add(far, nt), sub(far, nt), sub(near, nt)];

  if (o.sill >= GEOM_TOL) {
    const lines = [-t / 2, 0, t / 2].map((k): [Vec2, Vec2] => [
      add(near, scale(n, k)),
      add(far, scale(n, k)),
    ]);
    return { kind: 'window', gap, lines };
  }

  const hinge = o.flip ? far : near;
  const side = o.flip ? -1 : 1;
  const leafEnd = add(hinge, scale(n, side * o.width));
  const closed = o.flip ? near : far;
  return {
    kind: 'door',
    gap,
    leaf: [hinge, leafEnd],
    arc: {
      from: leafEnd,
      to: closed,
      center: hinge,
      r: o.width,
      sweep: cross(sub(leafEnd, hinge), sub(closed, hinge)) > 0 ? 1 : 0,
    },
  };
}

/** Plan-space footprint of an item, or undefined when its preset (or wall) does not resolve. */
export function itemFootprint(
  item: Item,
  floor: Floor,
  presets?: PresetResolver,
): Vec2[] | undefined {
  const fp = presets?.(item.preset)?.footprint;
  if (!fp) return undefined;

  if (item.mount === 'wall') {
    const wall = floor.walls[item.wall];
    const a = wall && floor.nodes[wall.a];
    const b = wall && floor.nodes[wall.b];
    if (!wall || !a || !b) return undefined;
    const d = normalize(sub(b, a));
    const sign = item.side === 'left' ? 1 : -1;
    const n = scale(leftNormal(d), sign);
    const centre = add(
      add(a, scale(d, item.offset)),
      scale(n, wall.thickness / 2 + WALL_ITEM_DEPTH / 2),
    );
    const u = scale(d, fp.w / 2);
    const v = scale(n, WALL_ITEM_DEPTH / 2);
    return [
      sub(sub(centre, u), v),
      sub(add(centre, u), v),
      add(add(centre, u), v),
      add(sub(centre, u), v),
    ];
  }

  const cos = Math.cos(item.rotation);
  const sin = Math.sin(item.rotation);
  const hw = fp.w / 2;
  const hd = fp.d / 2;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([x, y]) => ({
    x: item.x + x! * cos - y! * sin,
    y: item.y + x! * sin + y! * cos,
  }));
}
