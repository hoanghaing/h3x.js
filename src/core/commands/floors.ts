import type { Command, CommandContext, EntityChange } from '../document/changes';
import { createId } from '../ids';
import { detectRooms } from '../rooms/detect';
import { deriveStack, floorProps } from '../floors/stack';
import type { Column, Floor, FloorProps, Id, PlanNode, Room, Stair, Wall } from '../types';
import { fail } from './shared';

type Created = Command & { createdId: Id };

/** `'floor'` update changes for props that differ, matched by id. */
function stackChanges(before: FloorProps[], after: FloorProps[]): EntityChange[] {
  const out: EntityChange[] = [];
  for (const a of after) {
    const b = before.find((f) => f.id === a.id);
    if (!b) continue;
    if (
      b.level !== a.level ||
      b.elevation !== a.elevation ||
      b.wallHeight !== a.wallHeight ||
      b.slabThickness !== a.slabThickness
    ) {
      out.push({ kind: 'floor', id: a.id, floorId: a.id, before: { ...b }, after: { ...a } });
    }
  }
  return out;
}

const stackOf = (ctx: CommandContext): { props: FloorProps[]; ground: number } => {
  const props = ctx.project.floors.map(floorProps);
  return {
    props,
    ground: Math.max(
      0,
      props.findIndex((f) => f.level === 0),
    ),
  };
};

const restack = (props: FloorProps[], ground: number): FloorProps[] =>
  deriveStack(props, ground, props[ground]!.elevation);

const unknownFloor = (id: Id) => fail('unknown-floor', [id], `No floor with id ${id}`);

/** Walls following the storey height: those whose height equals `oldHeight` (custom heights are kept). */
const atStoreyHeight = (w: Wall, oldHeight: number): boolean =>
  Math.abs(w.height - oldHeight) <= 1e-9;

function checkDimension(value: number, what: string, id: Id): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw fail('invalid-floor-dimension', [id], `${what} must be a positive number`);
  }
}

/**
 * Adds a floor above the top or below the bottom, copying the nearest floor's nodes, walls
 * and columns. With `wallHeight`, copied walls at the source storey height get the new one.
 */
export function addFloor(opts: {
  position: 'above' | 'below';
  wallHeight?: number;
  slabThickness?: number;
}): Created {
  const newId = createId();
  return {
    label: 'Add floor',
    createdId: newId,
    run(ctx) {
      const floors = ctx.project.floors;
      const above = opts.position === 'above';
      const src = above ? floors[floors.length - 1]! : floors[0]!;
      const wallHeight = opts.wallHeight ?? src.wallHeight;
      const slabThickness = opts.slabThickness ?? src.slabThickness;
      if (opts.wallHeight !== undefined) checkDimension(wallHeight, 'wallHeight', newId);
      if (opts.slabThickness !== undefined) checkDimension(slabThickness, 'slabThickness', newId);

      const { props, ground } = stackOf(ctx);
      const fresh: FloorProps = { id: newId, level: 0, elevation: 0, wallHeight, slabThickness };
      const next = above ? [...props, fresh] : [fresh, ...props];
      const derived = restack(next, above ? ground : ground + 1);
      const newProps = derived.find((f) => f.id === newId)!;

      const changes: EntityChange[] = [
        { kind: 'floor', id: newId, floorId: newId, before: null, after: { ...newProps } },
      ];
      const add = (e: Omit<EntityChange, 'floorId' | 'before'>): void => {
        changes.push({ ...e, floorId: newId, before: null } as EntityChange);
      };

      const nodeMap = new Map<Id, Id>();
      const nodes: Record<Id, PlanNode> = {};
      for (const n of Object.values(src.nodes)) {
        const id = createId();
        nodeMap.set(n.id, id);
        nodes[id] = { ...n, id };
        add({ kind: 'node', id, after: nodes[id]! });
      }
      const walls: Record<Id, Wall> = {};
      for (const w of Object.values(src.walls)) {
        const id = createId();
        walls[id] = { ...w, id, a: nodeMap.get(w.a)!, b: nodeMap.get(w.b)! };
        if (atStoreyHeight(w, src.wallHeight)) walls[id].height = wallHeight;
        add({ kind: 'wall', id, after: walls[id]! });
      }
      for (const c of Object.values(src.columns)) {
        const id = createId();
        const col: Column = { ...c, id };
        add({ kind: 'column', id, after: col });
      }
      for (const s of Object.values(src.stairs)) {
        const id = createId();
        const copy: Stair = { ...s, id };
        add({ kind: 'stair', id, after: copy });
      }
      const tmp: Floor = {
        ...newProps,
        nodes,
        walls,
        openings: {},
        rooms: {},
        items: {},
        columns: {},
        stairs: {},
        roofs: {},
      };
      for (const r of detectRooms(tmp)) {
        const id = createId();
        const room: Room = { id, name: '', walls: [...r.walls] };
        if (r.holes.length > 0) room.holes = r.holes.map((h) => [...h]);
        add({ kind: 'room', id, after: room });
      }
      changes.push(...stackChanges(props, derived));
      return changes;
    },
  };
}

export function removeFloor(floorId: Id): Command {
  return {
    label: 'Remove floor',
    run(ctx) {
      const floor = ctx.project.floors.find((f) => f.id === floorId);
      if (!floor) throw unknownFloor(floorId);
      if (floor.level === 0 || ctx.project.floors.length <= 1) {
        throw fail(
          'floor-protected',
          [floorId],
          'The ground floor and the last floor cannot be removed',
        );
      }
      const changes: EntityChange[] = [];
      const drop = (
        kind: 'room' | 'item' | 'opening' | 'column' | 'stair' | 'roof' | 'wall' | 'node',
        coll: Record<Id, unknown>,
      ): void => {
        for (const [id, before] of Object.entries(coll)) {
          changes.push({ kind, id, floorId, before, after: null } as EntityChange);
        }
      };
      drop('room', floor.rooms);
      drop('item', floor.items);
      drop('opening', floor.openings);
      drop('column', floor.columns);
      drop('stair', floor.stairs);
      drop('roof', floor.roofs);
      drop('wall', floor.walls);
      drop('node', floor.nodes);
      const { props, ground } = stackOf(ctx);
      const i = props.findIndex((f) => f.id === floorId);
      changes.push({ kind: 'floor', id: floorId, floorId, before: { ...props[i]! }, after: null });
      const rest = props.filter((f) => f.id !== floorId);
      changes.push(...stackChanges(props, restack(rest, i < ground ? ground - 1 : ground)));
      return changes;
    },
  };
}

function edited(
  ctx: CommandContext,
  edit: (props: FloorProps[], ground: number) => void,
): EntityChange[] {
  const { props, ground } = stackOf(ctx);
  const next = props.map((f) => ({ ...f }));
  edit(next, ground);
  return stackChanges(props, restack(next, ground));
}

/**
 * Sets a floor's storey height and re-derives elevations. Walls whose height equals the
 * old storey height follow it; walls with a custom height are kept.
 */
export function setFloorHeight(floorId: Id, wallHeight: number): Command {
  return {
    label: 'Set floor height',
    run(ctx) {
      if (!ctx.project.floors.some((f) => f.id === floorId)) throw unknownFloor(floorId);
      checkDimension(wallHeight, 'wallHeight', floorId);
      const floor = ctx.project.floors.find((f) => f.id === floorId)!;
      const changes: EntityChange[] = [];
      if (floor.wallHeight !== wallHeight) {
        for (const w of Object.values(floor.walls)) {
          if (!atStoreyHeight(w, floor.wallHeight) || w.height === wallHeight) continue;
          changes.push({
            kind: 'wall',
            id: w.id,
            floorId,
            before: { ...w },
            after: { ...w, height: wallHeight },
          });
        }
      }
      changes.push(
        ...edited(ctx, (p) => {
          p.find((f) => f.id === floorId)!.wallHeight = wallHeight;
        }),
      );
      return changes;
    },
  };
}

export function setSlabThickness(floorId: Id, t: number): Command {
  return {
    label: 'Set slab thickness',
    run(ctx) {
      if (!ctx.project.floors.some((f) => f.id === floorId)) throw unknownFloor(floorId);
      checkDimension(t, 'slabThickness', floorId);
      return edited(ctx, (p) => {
        p.find((f) => f.id === floorId)!.slabThickness = t;
      });
    },
  };
}

export function setGroundElevation(value: number): Command {
  return {
    label: 'Set ground elevation',
    run(ctx) {
      if (!Number.isFinite(value)) {
        throw fail('invalid-floor-dimension', [], 'Ground elevation must be a finite number');
      }
      return edited(ctx, (p, g) => {
        p[g]!.elevation = value;
      });
    },
  };
}
