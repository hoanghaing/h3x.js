import type { Command, CommandContext } from '../document/changes';
import { assertFreeId, fail, notFound } from './shared';
import { createId } from '../ids';
import { defaultOpeningType } from '../openings/normalize';
import type {
  CeilingItem,
  FloorItem,
  Hinge,
  Id,
  Item,
  Opening,
  PresetInfo,
  Swing,
  WallItem,
} from '../types';

type Created = Command & { createdId: Id };

function presetFor(ctx: CommandContext, preset: string, ids: Id[]): PresetInfo {
  const info = ctx.presets?.(preset);
  if (!info) throw fail('unknown-preset', ids, `Unknown preset ${preset}`);
  return info;
}

export function addOpening(input: {
  wall: Id;
  preset: string;
  offset: number;
  hinge?: Hinge;
  swing?: Swing;
  sill?: number;
}): Created {
  const id = createId();
  return {
    label: 'addOpening',
    createdId: id,
    run: (ctx) => {
      assertFreeId(ctx, id);
      if (!ctx.floor.walls[input.wall]) throw notFound('Wall', input.wall);
      const info = presetFor(ctx, input.preset, [id]);
      if (info.mount !== 'opening') {
        throw fail('unknown-preset', [id], `Preset ${input.preset} is not an opening preset`);
      }
      if (!(info.footprint.w > 0)) {
        throw fail('invalid-opening', [id], `Opening ${id} width must be above 0`);
      }
      const sill = input.sill ?? info.sill ?? 0;
      const after: Opening = {
        id,
        wall: input.wall,
        preset: input.preset,
        offset: input.offset,
        width: info.footprint.w,
        height: info.footprint.h,
        sill,
        type: info.opening?.type ?? defaultOpeningType(sill),
        hinge: input.hinge ?? info.opening?.hinge ?? 'a',
        swing: input.swing ?? info.opening?.swing ?? 'left',
      };
      if (info.opening?.leaves !== undefined) after.leaves = info.opening.leaves;
      if (info.opening?.split !== undefined) after.split = info.opening.split;
      return [{ kind: 'opening', id, before: null, after }];
    },
  };
}

export function moveOpening(id: Id, patch: { offset?: number; sill?: number }): Command {
  return {
    label: 'moveOpening',
    run: (ctx) => {
      const o = ctx.floor.openings[id];
      if (!o) throw notFound('Opening', id);
      const after: Opening = { ...structuredClone(o) };
      if (patch.offset !== undefined) after.offset = patch.offset;
      if (patch.sill !== undefined) after.sill = patch.sill;
      return [{ kind: 'opening', id, before: structuredClone(o), after }];
    },
  };
}

export function removeOpening(id: Id): Command {
  return {
    label: 'removeOpening',
    run: (ctx) => {
      const o = ctx.floor.openings[id];
      if (!o) throw notFound('Opening', id);
      return [{ kind: 'opening', id, before: structuredClone(o), after: null }];
    },
  };
}

export type NewItem = Omit<FloorItem, 'id'> | Omit<WallItem, 'id'> | Omit<CeilingItem, 'id'>;

export function addItem(input: NewItem): Created {
  const id = createId();
  return {
    label: 'addItem',
    createdId: id,
    run: (ctx) => {
      assertFreeId(ctx, id);
      const info = presetFor(ctx, input.preset, [id]);
      if (info.mount !== input.mount) {
        throw fail(
          'mount-mismatch',
          [id],
          `Preset ${input.preset} mounts on ${info.mount}, not ${input.mount}`,
        );
      }
      if (input.mount === 'wall' && !ctx.floor.walls[input.wall]) {
        throw notFound('Wall', input.wall);
      }
      const after = { ...structuredClone(input), id } as Item;
      return [{ kind: 'item', id, before: null, after }];
    },
  };
}

type ItemPatch = Partial<{
  x: number;
  y: number;
  rotation: number;
  wall: Id;
  side: 'left' | 'right';
  offset: number;
  elevation: number;
  variant: string;
}>;

const KEYS: Record<Item['mount'], (keyof ItemPatch)[]> = {
  floor: ['x', 'y', 'rotation', 'variant'],
  ceiling: ['x', 'y', 'rotation', 'variant'],
  wall: ['wall', 'side', 'offset', 'elevation', 'variant'],
};

/** Keys that do not apply to the item's mount are ignored. */
export function moveItem(id: Id, patch: ItemPatch): Command {
  return {
    label: 'moveItem',
    run: (ctx) => {
      const it = ctx.floor.items[id];
      if (!it) throw notFound('Item', id);
      const after: Record<string, unknown> = { ...structuredClone(it) };
      for (const k of KEYS[it.mount]) if (patch[k] !== undefined) after[k] = patch[k];
      if (it.mount === 'wall' && !ctx.floor.walls[after.wall as Id]) {
        throw notFound('Wall', after.wall as Id);
      }
      return [{ kind: 'item', id, before: structuredClone(it), after: after as unknown as Item }];
    },
  };
}

export function removeItem(id: Id): Command {
  return {
    label: 'removeItem',
    run: (ctx) => {
      const it = ctx.floor.items[id];
      if (!it) throw notFound('Item', id);
      return [{ kind: 'item', id, before: structuredClone(it), after: null }];
    },
  };
}
