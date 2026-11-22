import type { Floor, Id, Opening, Room, Vec2 } from '../core';
import { roomArea, roomShape } from '../core';
import { GEOM_TOL } from '../core/constants';
import { add, cross, leftNormal, normalize, scale, sub } from '../core/geometry/vec';
import { pointInPolygon } from '../core/geometry/polygon';
import { openingSpan } from '../core/shapes';
import type { Joins } from '../core/walls/joins';

// The outline of each kind lives in core (validators measure the same shapes); re-exported here.
export { columnShape, itemFootprint, wallOutline } from '../core/shapes';

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
  const span = openingSpan(o);
  const near = add(a, scale(d, span.lo));
  const far = add(a, scale(d, span.hi));
  const nt = scale(n, t / 2);
  const gap: [Vec2, Vec2, Vec2, Vec2] = [add(near, nt), add(far, nt), sub(far, nt), sub(near, nt)];

  if (o.sill >= GEOM_TOL) {
    const lines = [-t / 2, 0, t / 2].map((k): [Vec2, Vec2] => [
      add(near, scale(n, k)),
      add(far, scale(n, k)),
    ]);
    return { kind: 'window', gap, lines };
  }

  const hinge = o.hinge === 'b' ? far : near;
  const side = o.swing === 'right' ? -1 : 1;
  const leafEnd = add(hinge, scale(n, side * o.width));
  const closed = o.hinge === 'b' ? near : far;
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
