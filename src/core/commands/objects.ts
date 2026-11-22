import type { Command } from '../document/changes';
import { assertFreeId, fail, notFound, presetFor, type Created } from './shared';
import { createId } from '../ids';
import type { CeilingItem, FloorItem, Id, Item, WallItem } from '../types';

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
