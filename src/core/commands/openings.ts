import type { Command, CommandContext, EntityChange } from '../document/changes';
import { deepEqual } from '../document/history';
import { EPS, tidy } from '../geometry/vec';
import { createId } from '../ids';
import { openingClearances } from '../openings/clearance';
import { leavesFit } from '../openings/params';
import { presetOpening } from '../openings/presets';
import { openingSpan } from '../shapes';
import type { Hinge, Id, Opening } from '../types';
import { assertFreeId, fail, notFound, presetFor, type Created } from './shared';

type OpeningPatch = Partial<Omit<Opening, 'id'>>;

const OPENING_KEYS = [
  'wall',
  'preset',
  'offset',
  'width',
  'height',
  'sill',
  'type',
  'hinge',
  'swing',
  'leaves',
  'split',
] as const satisfies readonly (keyof OpeningPatch)[];

/**
 * `o` with the defined fields of `patch`. A new type drops a kept leaf count it cannot take, so
 * the opening has the type's default; a count set in the same patch stays and is validated.
 */
function patched(o: Opening, patch: OpeningPatch): Opening {
  const after: Record<string, unknown> = { ...o };
  for (const k of OPENING_KEYS) if (patch[k] !== undefined) after[k] = patch[k];
  const result = after as unknown as Opening;
  const retyped = patch.type !== undefined && patch.type !== o.type;
  if (retyped && patch.leaves === undefined && result.leaves !== undefined) {
    if (!leavesFit(result.type, result.leaves)) delete result.leaves;
  }
  return result;
}

function getOpening(ctx: CommandContext, id: Id): Opening {
  const o = ctx.floor.openings[id];
  if (!o) throw notFound('Opening', id);
  return o;
}

function checkEnd(id: Id, end: Hinge): void {
  if (end !== 'a' && end !== 'b') {
    throw fail('invalid-opening', [id], `Opening ${id} end must be "a" or "b"`);
  }
}

function changed(o: Opening, after: Opening): EntityChange[] {
  if (deepEqual(o, after)) return [];
  return [{ kind: 'opening', id: o.id, before: structuredClone(o), after }];
}

/**
 * An opening as its preset makes it, then `over`. Orientation the preset does not give stays as
 * in `base`.
 */
function fromPreset(
  ctx: CommandContext,
  base: Pick<Opening, 'id' | 'wall' | 'preset' | 'offset' | 'hinge' | 'swing'>,
  over: OpeningPatch = {},
): Opening {
  const { id, preset } = base;
  const info = presetFor(ctx, preset, [id]);
  if (info.mount !== 'opening') {
    throw fail('unknown-preset', [id], `Preset ${preset} is not an opening preset`);
  }
  const made = presetOpening(info, base, over.sill ?? info.sill ?? 0);
  return patched(made, over);
}

/** Adds an opening as `preset` makes it; any other field given overrides the preset. */
export function addOpening(
  input: { wall: Id; preset: string; offset: number } & Partial<
    Omit<Opening, 'id' | 'wall' | 'preset' | 'offset'>
  >,
): Created {
  const id = createId();
  return {
    label: 'addOpening',
    createdId: id,
    run: (ctx) => {
      assertFreeId(ctx, id);
      if (!ctx.floor.walls[input.wall]) throw notFound('Wall', input.wall);
      const { wall, preset, offset } = input;
      const after = fromPreset(ctx, { id, wall, preset, offset, hinge: 'a', swing: 'left' }, input);
      return [{ kind: 'opening', id, before: null, after }];
    },
  };
}

/**
 * Sets any field but the id, also the wall, in one step. A field left undefined keeps its value;
 * a new `preset` is only a name here (`applyOpeningPreset` applies one). A new `type` drops a
 * stored `leaves` the type cannot take (back to the type's default) unless the patch sets it.
 */
export function updateOpening(id: Id, patch: OpeningPatch): Command {
  return {
    label: 'updateOpening',
    run: (ctx) => {
      const o = getOpening(ctx, id);
      const after = patched(o, patch);
      if (!ctx.floor.walls[after.wall]) throw notFound('Wall', after.wall);
      return changed(o, after);
    },
  };
}

/** The same command as `updateOpening`. */
export const moveOpening = updateOpening;

/**
 * Sets the width by moving the jamb at `end`; the other jamb stays still. `invalid-opening` for
 * another `end`.
 */
export function resizeOpening(id: Id, { end, width }: { end: Hinge; width: number }): Command {
  return {
    label: 'resizeOpening',
    run: (ctx) => {
      const o = getOpening(ctx, id);
      checkEnd(id, end);
      // Before rounding: a stored offset need not be round, and rounding it would move the opening.
      if (Math.abs(width - o.width) <= EPS) return [];
      const { lo, hi } = openingSpan(o);
      const offset = tidy(end === 'a' ? hi - width / 2 : lo + width / 2);
      return changed(o, { ...o, offset, width });
    },
  };
}

/**
 * Moves an opening along its wall until the distance beside the jamb at `end` (see
 * `openingClearances`) is `distance`. `invalid-opening` for another `end` or a distance that is
 * not 0 or more; `opening-overlap` for a clear distance with another opening in the way.
 */
export function setOpeningDistance(
  id: Id,
  { end, distance, from }: { end: Hinge; distance: number; from: 'face' | 'axis' },
): Command {
  return {
    label: 'setOpeningDistance',
    run: (ctx) => {
      const o = getOpening(ctx, id);
      checkEnd(id, end);
      if (!(Number.isFinite(distance) && distance >= 0)) {
        throw fail('invalid-opening', [id], `Opening ${id} distance must be 0 or more`);
      }
      const by = distance - openingClearances(ctx.floor, o)[end][from];
      if (Math.abs(by) <= EPS) return []; // already there, so do not round it
      const offset = tidy(end === 'a' ? o.offset + by : o.offset - by);
      if (from === 'face') {
        // Past another opening, that one would end the clear distance, short of what was asked.
        const inTheWay = Object.values(ctx.floor.openings).find(
          (p) => p.wall === o.wall && (p.offset - o.offset) * (p.offset - offset) < 0,
        );
        if (inTheWay) {
          throw fail(
            'opening-overlap',
            [id, inTheWay.id],
            `Opening ${inTheWay.id} is in the way of a clear distance of ${distance} m`,
          );
        }
      }
      return changed(o, { ...o, offset });
    },
  };
}

/**
 * Makes an opening what `preset` describes, keeping its id, wall, centre and any orientation the
 * preset does not give.
 */
export function applyOpeningPreset(id: Id, preset: string): Command {
  return {
    label: 'applyOpeningPreset',
    run: (ctx) => {
      const o = getOpening(ctx, id);
      return changed(o, fromPreset(ctx, { ...o, preset }));
    },
  };
}

export function removeOpening(id: Id): Command {
  return {
    label: 'removeOpening',
    run: (ctx) => {
      const o = getOpening(ctx, id);
      return [{ kind: 'opening', id, before: structuredClone(o), after: null }];
    },
  };
}
