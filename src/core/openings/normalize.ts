import { GEOM_TOL } from '../constants';
import type { Opening, OpeningType } from '../types';

/** What an opening without a type is: a door at floor level, a window above it. */
export function defaultOpeningType(sill: number): OpeningType {
  return sill < GEOM_TOL ? 'door-swing' : 'window-fixed';
}

/** An opening as an older file or project holds it: no type, hinge or swing, maybe `flip`. */
export type RawOpening = Omit<Opening, 'type' | 'hinge' | 'swing'> &
  Partial<Pick<Opening, 'type' | 'hinge' | 'swing'>> & { flip?: boolean };

/**
 * Fills what an older opening lacks: the type from the sill, hinge and swing from `flip`
 * (false: a + left, true: b + right). Attributes that are present win; `flip` is dropped.
 */
export function normalizeOpening(raw: RawOpening): Opening {
  const { flip, type, hinge, swing, leaves, split, ...rest } = raw;
  const o: Opening = {
    ...rest,
    type: type ?? defaultOpeningType(raw.sill),
    hinge: hinge ?? (flip ? 'b' : 'a'),
    swing: swing ?? (flip ? 'right' : 'left'),
  };
  if (leaves !== undefined) o.leaves = leaves;
  if (split !== undefined) o.split = split;
  return o;
}
