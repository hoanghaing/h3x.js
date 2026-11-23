import type {
  FloorQuantities,
  OpeningQuantity,
  ProjectQuantities,
  QuantityTotals,
} from './quantities';
import type { OpeningType } from './types';

/** The priced items besides openings. */
export type PriceKey =
  | 'masonry'
  | 'plaster'
  | 'paintInterior'
  | 'paintExterior'
  | 'slab'
  | 'flooring'
  | 'ceiling'
  | 'skirting'
  | 'roof';

/** Price per opening set: by preset, else by type. */
export interface OpeningPrices {
  byPreset?: Record<string, number>;
  byType?: Partial<Record<OpeningType, number>>;
}

/** Unit prices in any one currency; a key left out is not estimated. */
export type PriceTable = Partial<Record<PriceKey, number>> & { openings?: OpeningPrices };

export interface EstimateLine {
  key: PriceKey | 'opening';
  quantity: number;
  unit: 'm' | 'm2' | 'm3' | 'set';
  unitPrice: number;
  /** quantity × unitPrice. */
  cost: number;
  /** Opening lines only: the group priced. */
  type?: OpeningType;
  preset?: string;
  width?: number;
  height?: number;
}

export interface Estimate {
  /** Priced keys in PriceKey order, then opening groups in quantities order. */
  lines: EstimateLine[];
  total: number;
  /** Opening groups with no preset or type price. */
  unpriced: OpeningQuantity[];
}

/** What each key measures and in which unit. */
const MEASURES: ReadonlyArray<
  readonly [PriceKey, EstimateLine['unit'], (t: QuantityTotals) => number]
> = [
  ['masonry', 'm3', (t) => t.wallVolume],
  ['plaster', 'm2', (t) => t.paintInterior + t.paintExterior],
  ['paintInterior', 'm2', (t) => t.paintInterior],
  ['paintExterior', 'm2', (t) => t.paintExterior],
  ['slab', 'm3', (t) => t.slabVolume],
  ['flooring', 'm2', (t) => t.floorArea],
  ['ceiling', 'm2', (t) => t.floorArea],
  ['skirting', 'm', (t) => t.skirting],
  ['roof', 'm2', (t) => t.roofArea],
];

/** Opening groups of every floor, the same type, preset and size merged. */
function openingGroups(floors: readonly FloorQuantities[]): OpeningQuantity[] {
  const groups = new Map<string, OpeningQuantity>();
  for (const o of floors.flatMap((f) => f.openings)) {
    const key = [o.type, o.preset, o.width, o.height].join('|');
    const g = groups.get(key);
    if (g) {
      g.count += o.count;
      g.area += o.area;
    } else groups.set(key, { ...o });
  }
  return [...groups.values()];
}

/**
 * Cost of `q` (one floor or a whole project) at the unit `prices`: one line per priced key, one
 * per priced opening group, their total, and the opening groups left without a price.
 */
export function estimate(
  q: Readonly<ProjectQuantities | FloorQuantities>,
  prices: Readonly<PriceTable>,
): Estimate {
  const lines: EstimateLine[] = [];
  for (const [key, unit, measure] of MEASURES) {
    const unitPrice = prices[key];
    if (unitPrice === undefined) continue;
    const quantity = measure(q.totals);
    lines.push({ key, quantity, unit, unitPrice, cost: quantity * unitPrice });
  }
  const unpriced: OpeningQuantity[] = [];
  const floors = 'floors' in q ? q.floors : [q as FloorQuantities];
  for (const o of openingGroups(floors)) {
    const unitPrice = prices.openings?.byPreset?.[o.preset] ?? prices.openings?.byType?.[o.type];
    if (unitPrice === undefined) {
      unpriced.push(o);
      continue;
    }
    lines.push({
      key: 'opening',
      quantity: o.count,
      unit: 'set',
      unitPrice,
      cost: o.count * unitPrice,
      type: o.type,
      preset: o.preset,
      width: o.width,
      height: o.height,
    });
  }
  return { lines, total: lines.reduce((s, l) => s + l.cost, 0), unpriced };
}
