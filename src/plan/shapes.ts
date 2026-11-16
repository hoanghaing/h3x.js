import type { Floor, Id, Item, Opening, PresetResolver, Room, Vec2 } from '../core';
import { roomArea, roomPolygon } from '../core';
import { GEOM_TOL } from '../core/constants';
import { add, leftNormal, normalize, scale, sub } from '../core/geometry/vec';
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

/** Midpoint of the widest horizontal chord through the polygon, sampled at several heights. */
function labelPoint(poly: Vec2[]): Vec2 {
  const minY = Math.min(...poly.map((p) => p.y));
  const maxY = Math.max(...poly.map((p) => p.y));
  let best: Vec2 | undefined;
  let bestWidth = -1;
  const STEPS = 16;
  for (let s = 1; s < STEPS; s++) {
    const y = minY + ((maxY - minY) * s) / STEPS;
    const xs: number[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      if (p.y > y !== q.y > y) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x));
    });
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const width = xs[k + 1]! - xs[k]!;
      const mid = { x: (xs[k]! + xs[k + 1]!) / 2, y };
      if (width > bestWidth && pointInPolygon(mid, poly)) {
        bestWidth = width;
        best = mid;
      }
    }
  }
  if (best) return best;
  const n = poly.length || 1;
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / n,
    y: poly.reduce((s, p) => s + p.y, 0) / n,
  };
}

export function roomLabel(floor: Floor, room: Room): { at: Vec2; name: string; area: string } {
  const poly = roomPolygon(floor, room, 'inner');
  return {
    at: labelPoint(poly),
    name: room.name,
    area: `${roomArea(floor, room, 'inner').toFixed(1)} m²`,
  };
}

export interface OpeningShape {
  kind: 'door' | 'window';
  gap: [Vec2, Vec2, Vec2, Vec2];
  leaf?: [Vec2, Vec2];
  /** `sweep` is the SVG sweep flag in screen space (plan y is flipped on screen). */
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
    arc: { from: leafEnd, to: closed, center: hinge, r: o.width, sweep: 1 },
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
