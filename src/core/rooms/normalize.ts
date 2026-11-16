import { H3xValidationError } from '../errors';
import { signedArea } from '../geometry/polygon';
import type { Floor, Room } from '../types';
import { roomPolygon } from './detect';

/**
 * Ruling R2: rooms are stored CCW and their holes CW. Reverses `room.walls` in
 * place for every CW room and each CCW hole loop. Rooms whose walls do not form a loop are skipped (validation flags them
 * later) unless `onOpenRoom` is given, which is then called with the room and
 * the error.
 */
export function normalizeRoomOrientation(
  floor: Floor,
  onOpenRoom?: (room: Room, err: H3xValidationError, attribute: 'walls' | 'holes') => void,
): void {
  for (const room of Object.values(floor.rooms)) {
    try {
      if (signedArea(roomPolygon(floor, room, 'center')) < 0) room.walls.reverse();
    } catch (err) {
      if (!(err instanceof H3xValidationError)) throw err;
      onOpenRoom?.(room, err, 'walls');
    }
    // Holes are stored clockwise (the room interior stays on the left of the traversal).
    for (const hole of room.holes ?? []) {
      try {
        const loop = { ...room, walls: hole };
        if (signedArea(roomPolygon(floor, loop, 'center')) > 0) hole.reverse();
      } catch (err) {
        if (!(err instanceof H3xValidationError)) throw err;
        onOpenRoom?.(room, err, 'holes');
      }
    }
  }
}
