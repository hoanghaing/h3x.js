import type { EntityChange, Floor, Id } from '../core';
import { KINDS, LAYER_OF, entitiesOf, isPlanKind, type PlanDom } from './kinds';
import type { Joins } from '../shared/walls/joins';
import {
  createEntityElement,
  createJoinElement,
  pointsAttr,
  setAttr,
  updateEntityElement,
  type KindEntity,
  type RenderContext,
} from './render';
import { junctionPolygons } from './shapes';
import type { PlanKind } from './types';

/**
 * The entities whose elements must be re-synced after `changes`: the changed ones, plus every
 * wall whose corners depend on them (walls sharing a node with a changed wall or moved node,
 * and their neighbours), and the openings, rooms and wall items on those walls.
 */
export function dirtyEntities(
  floor: Readonly<Floor>,
  changes: EntityChange[],
): Record<PlanKind, Set<Id>> {
  const changed = Object.fromEntries(KINDS.map((k) => [k, new Set<Id>()])) as Record<
    PlanKind,
    Set<Id>
  >;
  for (const c of changes) if (isPlanKind(c.kind)) changed[c.kind].add(c.id);

  // Corners depend on neighbouring walls' directions: take the walls touching any moved
  // node or changed wall, then every wall sharing a node with those.
  const wallsAt = new Map<Id, Id[]>();
  for (const w of Object.values(floor.walls)) {
    for (const n of [w.a, w.b]) {
      const list = wallsAt.get(n);
      if (list) list.push(w.id);
      else wallsAt.set(n, [w.id]);
    }
  }
  const seeds = new Set(changed.node);
  for (const c of changes) {
    if (c.kind !== 'wall') continue;
    for (const w of [c.before, c.after]) if (w) seeds.add(w.a).add(w.b);
  }
  const nodes = new Set(seeds);
  for (const n of seeds) {
    for (const id of wallsAt.get(n) ?? []) {
      const w = floor.walls[id]!;
      nodes.add(w.a).add(w.b);
    }
  }
  const dirtyWalls = new Set(changed.wall);
  for (const n of nodes) for (const id of wallsAt.get(n) ?? []) dirtyWalls.add(id);

  const dirty = { ...changed, wall: dirtyWalls };
  for (const o of Object.values(floor.openings)) {
    if (dirtyWalls.has(o.wall)) dirty.opening.add(o.id);
  }
  for (const r of Object.values(floor.rooms)) {
    if ([...r.walls, ...(r.holes?.flat() ?? [])].some((id) => dirtyWalls.has(id))) {
      dirty.room.add(r.id);
    }
  }
  for (const it of Object.values(floor.items)) {
    if (it.mount === 'wall' && dirtyWalls.has(it.wall)) dirty.item.add(it.id);
  }
  // Follow-mode roofs read the walls and rooms of their floor; re-draw them with any of those.
  const structural =
    dirtyWalls.size > 0 || dirty.node.size > 0 || dirty.room.size > 0 || dirty.opening.size > 0;
  if (structural) for (const r of Object.values(floor.roofs)) dirty.roof.add(r.id);
  return dirty;
}

/** Creates, updates or removes the element of one entity to match the floor. */
export function syncEntity(kind: PlanKind, id: Id, dom: PlanDom, ctx: RenderContext): void {
  const els = dom.elements[kind];
  const entity = entitiesOf(kind, ctx.floor, ctx.site)[id];
  let g = els.get(id);
  if (!entity) {
    g?.remove();
    els.delete(id);
    if (kind === 'roof') dom.roofGeometry.delete(id);
    if (kind === 'opening') dom.openingShapes.delete(id);
    return;
  }
  if (!g) {
    g = createEntityElement(kind, id, dom.prefix);
    els.set(id, g);
    dom.layers[LAYER_OF[kind]].appendChild(g);
  }
  updateEntityElement(g, { kind, entity } as KindEntity, ctx);
}

/** Junction fills, keyed by node id; recomputed every change (they are cheap). */
export function syncJoins(joins: Joins, dom: PlanDom): void {
  const joinEls = dom.joins;
  const polys = junctionPolygons(joins);
  for (const [id, g] of joinEls) {
    if (polys[id]) continue;
    g.remove();
    joinEls.delete(id);
  }
  for (const [id, pts] of Object.entries(polys)) {
    let g = joinEls.get(id);
    if (!g) {
      g = createJoinElement(id, dom.prefix);
      joinEls.set(id, g);
      dom.layers.joins.appendChild(g);
    }
    setAttr(g.firstElementChild!, 'points', pointsAttr(pts));
  }
}
