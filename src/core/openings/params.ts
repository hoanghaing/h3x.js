import type { Hinge, Issue, Opening, OpeningParam, OpeningType, Swing } from '../types';

export const OPENING_TYPES: readonly OpeningType[] = [
  'door-swing',
  'door-double',
  'door-sliding',
  'door-folding',
  'door-rolling',
  'opening',
  'window-casement',
  'window-sliding',
  'window-awning',
  'window-fixed',
];

/** Allowed leaf counts and the default, for the types that have a leaf-count parameter. */
const LEAVES: Partial<Record<OpeningType, { min: number; max: number; def: number }>> = {
  'door-sliding': { min: 1, max: 4, def: 2 },
  'door-folding': { min: 2, max: 8, def: 4 },
  'window-casement': { min: 1, max: 4, def: 2 },
  'window-sliding': { min: 2, max: 4, def: 2 },
  'window-awning': { min: 1, max: 4, def: 1 },
  'window-fixed': { min: 1, max: 6, def: 1 },
};

/** Leaf count of the types without a leaf-count parameter. */
const FIXED_LEAVES: Partial<Record<OpeningType, number>> = {
  'door-swing': 1,
  'door-double': 2,
  'door-rolling': 1,
  opening: 0,
};

type ParamInput = Pick<Opening, 'type' | 'leaves' | 'split'>;

/** Leaf count: the stored one, else the type's default. */
export function openingLeaves(o: ParamInput): number {
  if (o.leaves !== undefined) return o.leaves;
  return LEAVES[o.type]?.def ?? FIXED_LEAVES[o.type] ?? 1;
}

/**
 * The parameters that shape an opening of this type: hinge, swing, leaves, split. A parameter
 * that does not apply is kept but ignored, so switching type and back loses nothing. An editor
 * can disable the inputs for the others.
 */
export function openingParams(o: ParamInput): readonly OpeningParam[] {
  const one = openingLeaves(o) === 1;
  switch (o.type) {
    case 'door-swing':
      return ['hinge', 'swing'];
    case 'door-double':
      return (o.split ?? 0.5) !== 0.5 ? ['hinge', 'swing', 'split'] : ['swing', 'split'];
    case 'door-sliding':
    case 'window-casement':
      return one ? ['hinge', 'swing', 'leaves'] : ['swing', 'leaves'];
    case 'door-folding':
      return ['hinge', 'swing', 'leaves'];
    case 'door-rolling':
      return ['swing'];
    case 'window-awning':
      return ['swing', 'leaves'];
    case 'window-sliding':
    case 'window-fixed':
      return ['leaves'];
    default:
      return [];
  }
}

/** Issues for a type, orientation, leaf count or split outside what the type allows. */
export function validateOpeningParams(o: Opening): Issue[] {
  const bad = (what: string): Issue => ({
    code: 'invalid-opening',
    ids: [o.id],
    message: `Opening ${o.id} ${what}`,
  });
  if (!OPENING_TYPES.includes(o.type)) return [bad(`has an unknown type "${String(o.type)}"`)];
  const out: Issue[] = [];
  if (o.hinge !== 'a' && o.hinge !== 'b') out.push(bad('hinge must be "a" or "b"'));
  if (o.swing !== 'left' && o.swing !== 'right') out.push(bad('swing must be "left" or "right"'));
  if (o.leaves !== undefined) {
    const range = LEAVES[o.type];
    const ok =
      Number.isInteger(o.leaves) &&
      o.leaves >= (range?.min ?? 1) &&
      o.leaves <= (range?.max ?? Infinity);
    if (!ok) {
      const span = range ? `between ${range.min} and ${range.max}` : 'a whole number above 0';
      out.push(bad(`leaves must be ${span}`));
    }
  }
  if (o.split !== undefined && !(o.split >= 0.5 && o.split < 1)) {
    out.push(bad('split must be at least 0.5 and below 1'));
  }
  return out;
}

/** The same opening seen from the other wall direction: hinge end and swing side both swap. */
export function mirrorOrientation(o: Pick<Opening, 'hinge' | 'swing'>): {
  hinge: Hinge;
  swing: Swing;
} {
  return { hinge: o.hinge === 'a' ? 'b' : 'a', swing: o.swing === 'left' ? 'right' : 'left' };
}

/**
 * The next orientation in a cycle over the parameters that apply, or null when none does:
 * both -> (a, left), (b, left), (b, right), (a, right); one -> toggles it.
 */
export function nextOrientation(
  o: Pick<Opening, 'type' | 'leaves' | 'split' | 'hinge' | 'swing'>,
): { hinge: Hinge; swing: Swing } | null {
  const params = openingParams(o);
  const hinge = params.includes('hinge');
  const swing = params.includes('swing');
  if (hinge && swing) {
    // Gray-code order: one parameter changes per step.
    if (o.hinge === 'a' && o.swing === 'left') return { hinge: 'b', swing: 'left' };
    if (o.hinge === 'b' && o.swing === 'left') return { hinge: 'b', swing: 'right' };
    if (o.hinge === 'b') return { hinge: 'a', swing: 'right' };
    return { hinge: 'a', swing: 'left' };
  }
  const m = mirrorOrientation(o);
  if (hinge) return { hinge: m.hinge, swing: o.swing };
  if (swing) return { hinge: o.hinge, swing: m.swing };
  return null;
}
