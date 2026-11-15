import { H3xValidationError } from '../errors';
import { signedArea } from '../geometry/polygon';
import type { Floor, Room } from '../types';
import { roomPolygon } from './detect';

/**
 * Ruling R2: rooms are stored CCW. Reverses `room.walls` in place for every CW
 * room. Rooms whose walls do not form a loop are skipped (validation flags them
 * later) unless `onOpenRoom` is given, which is then called with the room and
 * the error.
 */
export function normalizeRoomOrientation(
  floor: Floor,
  onOpenRoom?: (room: Room, err: H3xValidationError) => void,
): void {
  for (const room of Object.values(floor.rooms)) {
    try {
      if (signedArea(roomPolygon(floor, room, 'center')) < 0) room.walls.reverse();
    } catch (err) {
      if (!(err instanceof H3xValidationError)) throw err;
      onOpenRoom?.(room, err);
    }
  }
}
