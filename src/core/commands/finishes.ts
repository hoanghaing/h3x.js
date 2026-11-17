import type { Command } from '../document/changes';
import type { Id } from '../types';
import { notFound } from './shared';

export function setWallFinish(
  wallId: Id,
  side: 'left' | 'right',
  finish: string | undefined,
): Command {
  return {
    label: 'setWallFinish',
    run: ({ floor }) => {
      const w = floor.walls[wallId];
      if (!w) throw notFound('Wall', wallId);
      const after = structuredClone(w);
      const key = side === 'left' ? 'finishLeft' : 'finishRight';
      if (finish === undefined) delete after[key];
      else after[key] = finish;
      if (after[key] === w[key]) return [];
      return [{ kind: 'wall', id: wallId, before: structuredClone(w), after }];
    },
  };
}

export function setRoomFinish(roomId: Id, finish: string | undefined): Command {
  return {
    label: 'setRoomFinish',
    run: ({ floor }) => {
      const r = floor.rooms[roomId];
      if (!r) throw notFound('Room', roomId);
      const after = structuredClone(r);
      if (finish === undefined) delete after.floorFinish;
      else after.floorFinish = finish;
      if (after.floorFinish === r.floorFinish) return [];
      return [{ kind: 'room', id: roomId, before: structuredClone(r), after }];
    },
  };
}

/** The name is trimmed; an empty name is allowed. */
export function renameRoom(roomId: Id, name: string): Command {
  return {
    label: 'renameRoom',
    run: ({ floor }) => {
      const r = floor.rooms[roomId];
      if (!r) throw notFound('Room', roomId);
      const trimmed = name.trim();
      if (trimmed === r.name) return [];
      return [
        {
          kind: 'room',
          id: roomId,
          before: structuredClone(r),
          after: { ...structuredClone(r), name: trimmed },
        },
      ];
    },
  };
}
