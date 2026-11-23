import type { Command } from '../document/changes';
import { columnPolygon, itemFootprint } from '../shapes';
import { stairBay } from '../stairs/layout';
import type { Floor, Id, Vec2 } from '../types';
import { sequence, transformObjects, type ObjectSet } from './transform';

/** Which side (or centre line) of the selection the objects line up on; plan +y is up. */
export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';

interface Box {
  set: ObjectSet;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const boxOf = (set: ObjectSet, pts: readonly Vec2[]): Box | null =>
  pts.length === 0
    ? null
    : {
        set,
        minX: Math.min(...pts.map((p) => p.x)),
        maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)),
        maxY: Math.max(...pts.map((p) => p.y)),
      };

/**
 * Moves each column, stair, floor / ceiling item and independent roof of the set so that its
 * outline's edge (or centre) lines up with the same edge (or centre) of the whole set's bounding
 * box, as one change list. Outlines: the column shape, the stair bay, the item footprint (its
 * point without a preset), the roof outline. Walls, wall items, openings and follow roofs are
 * left where they are. Rejected as a whole when a move is invalid.
 */
export function alignObjects(set: Readonly<ObjectSet>, edge: AlignEdge): Command {
  return {
    label: 'alignObjects',
    run: (ctx) => {
      const f = ctx.floor as Floor;
      const boxes: Box[] = [];
      const push = (b: Box | null): void => {
        if (b) boxes.push(b);
      };
      for (const id of set.columns ?? []) {
        const c = f.columns[id];
        if (c) push(boxOf({ columns: [id] }, columnPolygon(c)));
      }
      for (const id of set.stairs ?? []) {
        const s = f.stairs[id];
        if (s) push(boxOf({ stairs: [id] }, stairBay(s)));
      }
      for (const id of set.items ?? []) {
        const it = f.items[id];
        if (!it || it.mount === 'wall') continue;
        push(boxOf({ items: [id] }, itemFootprint(it, f, ctx.presets) ?? [{ x: it.x, y: it.y }]));
      }
      for (const id of set.roofs ?? []) {
        const r = f.roofs[id];
        if (r && !r.follow && r.points) push(boxOf({ roofs: [id] as Id[] }, r.points));
      }
      if (boxes.length < 2) return [];
      const all = {
        minX: Math.min(...boxes.map((b) => b.minX)),
        maxX: Math.max(...boxes.map((b) => b.maxX)),
        minY: Math.min(...boxes.map((b) => b.minY)),
        maxY: Math.max(...boxes.map((b) => b.maxY)),
      };
      const delta = (b: Box): Vec2 => {
        switch (edge) {
          case 'left':
            return { x: all.minX - b.minX, y: 0 };
          case 'right':
            return { x: all.maxX - b.maxX, y: 0 };
          case 'bottom':
            return { x: 0, y: all.minY - b.minY };
          case 'top':
            return { x: 0, y: all.maxY - b.maxY };
          case 'centerX':
            return { x: (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2, y: 0 };
          case 'centerY':
            return { x: 0, y: (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2 };
        }
      };
      const steps = boxes.map(
        (b) => () => transformObjects(b.set, { kind: 'translate', delta: delta(b) }),
      );
      return sequence('alignObjects', steps).run(ctx);
    },
  };
}
