import type { Floor, Id, Site } from '../core';
import type { PlanKind, Rect } from './types';

/** Layers, bottom to top. */
export const LAYERS = [
  'grid',
  'site',
  'rooms',
  'stairs',
  'walls',
  'joins',
  'columns',
  'openings',
  'items',
  'roofs',
  'dimensions',
  'nodes',
  'overlay',
] as const;
export type LayerName = (typeof LAYERS)[number];

export const LAYER_OF: Record<PlanKind, LayerName> = {
  node: 'nodes',
  wall: 'walls',
  room: 'rooms',
  opening: 'openings',
  item: 'items',
  column: 'columns',
  stair: 'stairs',
  roof: 'roofs',
  site: 'site',
};
export const KINDS = Object.keys(LAYER_OF) as PlanKind[];

/** Floor collection of each floor-level kind (the site is project-level, not in the floor). */
export const COLLECTION = {
  node: 'nodes',
  wall: 'walls',
  room: 'rooms',
  opening: 'openings',
  item: 'items',
  column: 'columns',
  stair: 'stairs',
  roof: 'roofs',
} as const satisfies Record<Exclude<PlanKind, 'site'>, keyof Floor>;

export const isPlanKind = (kind: string): kind is PlanKind => kind in LAYER_OF;

/** The entities of one kind by id; the site is the single entity `site`. */
export function entitiesOf(
  kind: PlanKind,
  floor: Readonly<Floor>,
  site: Readonly<Site> | undefined,
): Readonly<Record<Id, unknown>> {
  if (kind === 'site') return site ? { site } : {};
  return floor[COLLECTION[kind]] as Record<Id, unknown>;
}

/** The retained SVG a plan maintains: layers, class prefix and the elements by entity. */
export interface PlanDom {
  layers: Record<LayerName, SVGGElement>;
  prefix: string;
  elements: Record<PlanKind, Map<Id, SVGGElement>>;
  /** Junction fills by node id. */
  joins: Map<Id, SVGGElement>;
  /** Dimension labels by wall id, and their screen rects. */
  dimensions: Map<Id, SVGGElement>;
  dimensionRects: Map<Id, Rect>;
}
