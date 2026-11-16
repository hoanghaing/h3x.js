import type { Command } from '../document/changes';
import { assertFreeId, fail, notFound } from './shared';
import { signedArea } from '../geometry/polygon';
import { createId } from '../ids';
import type { Column, Id, Site, Vec2 } from '../types';

type Created = Command & { createdId: Id };

export function addColumn(input: Omit<Column, 'id' | 'rotation'> & { rotation?: number }): Created {
  const id = createId();
  return {
    label: 'addColumn',
    createdId: id,
    run: (ctx) => {
      assertFreeId(ctx, id);
      const after: Column = { ...structuredClone(input), id, rotation: input.rotation ?? 0 };
      return [{ kind: 'column', id, before: null, after }];
    },
  };
}

type ColumnPatch = Partial<
  Pick<Column, 'x' | 'y' | 'rotation' | 'width' | 'depth' | 'shape' | 'height'>
>;
const COLUMN_KEYS: (keyof ColumnPatch)[] = [
  'x',
  'y',
  'rotation',
  'width',
  'depth',
  'shape',
  'height',
];

export function moveColumn(id: Id, patch: ColumnPatch): Command {
  return {
    label: 'moveColumn',
    run: (ctx) => {
      const c = ctx.floor.columns[id];
      if (!c) throw notFound('Column', id);
      const after: Record<string, unknown> = { ...structuredClone(c) };
      let changed = false;
      for (const k of COLUMN_KEYS) {
        if (patch[k] !== undefined && patch[k] !== c[k]) {
          after[k] = patch[k];
          changed = true;
        }
      }
      if (!changed) return [];
      return [
        { kind: 'column', id, before: structuredClone(c), after: after as unknown as Column },
      ];
    },
  };
}

export function removeColumn(id: Id): Command {
  return {
    label: 'removeColumn',
    run: (ctx) => {
      const c = ctx.floor.columns[id];
      if (!c) throw notFound('Column', id);
      return [{ kind: 'column', id, before: structuredClone(c), after: null }];
    },
  };
}

/** Sets the site outline (stored counter-clockwise); `null` clears it. */
export function setSite(points: Vec2[] | null): Command {
  return {
    label: 'setSite',
    run: (ctx) => {
      const before = ctx.site ? (structuredClone(ctx.site) as Site) : null;
      if (points === null) {
        return before ? [{ kind: 'site', id: 'site', before, after: null }] : [];
      }
      if (points.length < 3 || points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
        throw fail(
          'site-invalid',
          ['site'],
          'Site needs at least 3 points with finite coordinates',
        );
      }
      const pts = points.map((p) => ({ x: p.x, y: p.y }));
      if (signedArea(pts) < 0) pts.reverse();
      return [{ kind: 'site', id: 'site', before, after: { id: 'site', points: pts } }];
    },
  };
}
