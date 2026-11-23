import {
  columnPolygon,
  itemFootprint,
  openingSpan,
  roofGeometry,
  stairOutline,
  type Floor,
  type Id,
  type PresetResolver,
  type Vec2,
  type WallCorners,
} from '../core';
import { pointInPolygon } from '../core/geometry/polygon';
import { wallOutline } from '../core/shapes';
import type { Selection } from './types';

/** An axis-aligned plan rectangle. */
export interface PlanRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function planRect(a: Vec2, b: Vec2): PlanRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

const inRect = (p: Vec2, r: PlanRect): boolean =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

const corners = (r: PlanRect): Vec2[] => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

function segmentsCross(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const side = (u: Vec2, v: Vec2, w: Vec2): number =>
    Math.sign((v.x - u.x) * (w.y - u.y) - (v.y - u.y) * (w.x - u.x));
  return side(p, q, a) * side(p, q, b) <= 0 && side(a, b, p) * side(a, b, q) <= 0;
}

/** Whether the outline (a polygon, a segment or a point) has any part in the rectangle. */
function touches(pts: Vec2[], r: PlanRect): boolean {
  if (pts.some((p) => inRect(p, r))) return true;
  if (pts.length >= 3 && corners(r).some((c) => pointInPolygon(c, pts))) return true;
  const box = corners(r);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    for (let j = 0; j < 4; j++) if (segmentsCross(p, q, box[j]!, box[(j + 1) % 4]!)) return true;
  }
  return false;
}

export interface BoxScene {
  floor: Floor;
  corners: Record<Id, WallCorners>;
  presets?: PresetResolver;
  stairRise: number;
  roofsVisible: boolean;
}

/**
 * The walls, openings, columns, stairs, items and roofs of the floor that the rectangle selects:
 * 'inside' takes those whose outline lies wholly inside it, 'touching' those with any part in it.
 */
export function selectInRect(
  scene: BoxScene,
  rect: PlanRect,
  mode: 'inside' | 'touching',
): Selection[] {
  const { floor } = scene;
  const out: Selection[] = [];
  const take = (kind: Selection['kind'], id: Id, pts: Vec2[] | undefined): void => {
    if (!pts || pts.length === 0) return;
    const hit = mode === 'inside' ? pts.every((p) => inRect(p, rect)) : touches(pts, rect);
    if (hit) out.push({ kind, id });
  };
  for (const w of Object.values(floor.walls)) {
    const c = scene.corners[w.id];
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    take('wall', w.id, c ? wallOutline(c) : a && b ? [a, b] : undefined);
  }
  for (const o of Object.values(floor.openings)) {
    const w = floor.walls[o.wall];
    const a = w && floor.nodes[w.a];
    const b = w && floor.nodes[w.b];
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len === 0) continue;
    const { lo, hi } = openingSpan(o);
    const at = (s: number): Vec2 => ({
      x: a.x + ((b.x - a.x) * s) / len,
      y: a.y + ((b.y - a.y) * s) / len,
    });
    take('opening', o.id, [at(lo), at(hi)]);
  }
  for (const c of Object.values(floor.columns)) take('column', c.id, columnPolygon(c));
  for (const s of Object.values(floor.stairs))
    take('stair', s.id, stairOutline(s, scene.stairRise));
  for (const it of Object.values(floor.items)) {
    const fp = itemFootprint(it, floor, scene.presets);
    take('item', it.id, fp ?? (it.mount === 'wall' ? undefined : [{ x: it.x, y: it.y }]));
  }
  if (scene.roofsVisible) {
    for (const r of Object.values(floor.roofs)) {
      const pts = r.follow
        ? roofGeometry(r, floor).bodies.flatMap((b) =>
            b.faces.flatMap((f) => f.polygon.map(({ x, y }) => ({ x, y }))),
          )
        : r.points;
      take('roof', r.id, pts);
    }
  }
  return out;
}
