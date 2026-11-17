import type { Command } from '../document/changes';
import { H3xValidationError } from '../errors';
import { createId } from '../ids';
import type { Id, Issue, Stair } from '../types';
import { assertFreeId, notFound } from './shared';

type Created = Command & { createdId: Id };

const pos = (n: number): boolean => Number.isFinite(n) && n > 0;

/** Issues (code `invalid-stair`) for non-positive sizes or a flight wider than the footprint allows. */
export function validateStairParams(s: Stair): Issue[] {
  const out: Issue[] = [];
  const bad = (message: string): void => {
    out.push({ code: 'invalid-stair', ids: [s.id], message });
  };
  if (!pos(s.width)) bad('Stair width must be finite and > 0');
  if (!pos(s.depth)) bad('Stair depth must be finite and > 0');
  if (s.type === 'spiral') return out;
  if (!pos(s.flightWidth)) {
    bad('Stair flightWidth must be finite and > 0');
  } else if (pos(s.width)) {
    const max = s.type === 'U' ? s.width / 2 : s.width;
    if (s.flightWidth > max) bad(`Stair flightWidth ${s.flightWidth} exceeds the allowed ${max}`);
  }
  return out;
}

function check(s: Stair): void {
  const issues = validateStairParams(s);
  if (issues.length > 0) throw new H3xValidationError(issues);
}

type NewStair = Pick<Stair, 'x' | 'y' | 'width' | 'depth'> &
  Partial<Omit<Stair, 'id' | 'x' | 'y' | 'width' | 'depth'>>;

export function addStair(input: NewStair): Created {
  const id = createId();
  return {
    label: 'addStair',
    createdId: id,
    run: (ctx) => {
      assertFreeId(ctx, id);
      const after: Stair = {
        rotation: 0,
        type: 'U',
        turn: 'landing',
        hand: 'right',
        flightWidth: 0.9,
        ...structuredClone(input),
        id,
      };
      check(after);
      return [{ kind: 'stair', id, before: null, after }];
    },
  };
}

const STAIR_KEYS = [
  'x',
  'y',
  'width',
  'depth',
  'rotation',
  'type',
  'turn',
  'hand',
  'flightWidth',
] as const;

export function updateStair(id: Id, patch: Partial<Omit<Stair, 'id'>>): Command {
  return {
    label: 'updateStair',
    run: (ctx) => {
      const s = ctx.floor.stairs[id];
      if (!s) throw notFound('Stair', id);
      const after: Stair = structuredClone(s);
      let changed = false;
      for (const k of STAIR_KEYS) {
        const v = patch[k];
        if (v !== undefined && v !== s[k]) {
          (after as unknown as Record<string, unknown>)[k] = v;
          changed = true;
        }
      }
      if (!changed) return [];
      check(after);
      return [{ kind: 'stair', id, before: structuredClone(s), after }];
    },
  };
}

export function removeStair(id: Id): Command {
  return {
    label: 'removeStair',
    run: (ctx) => {
      const s = ctx.floor.stairs[id];
      if (!s) throw notFound('Stair', id);
      return [{ kind: 'stair', id, before: structuredClone(s), after: null }];
    },
  };
}
