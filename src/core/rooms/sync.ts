import { GEOM_TOL } from '../constants';
import type { EntityChange } from '../document/changes';
import { H3xValidationError } from '../errors';
import { polygonOverlapArea } from '../geometry/clip';
import { signedArea } from '../geometry/polygon';
import { createId, idFor } from '../ids';
import type { Floor, Id, Room, Vec2 } from '../types';
import { detectRooms, roomShape } from './detect';
import type { DetectedRoom } from './detect';

export interface Shape {
  outer: Vec2[];
  holes: Vec2[][];
}

/** Center shape of a room, or null when its loops are open (it then matches no face). */
export function shapeOf(floor: Readonly<Floor>, room: Room): Shape | null {
  try {
    return roomShape(floor, room, 'center');
  } catch (err) {
    if (err instanceof H3xValidationError) return null;
    throw err;
  }
}

/** Overlap of two rooms with holes subtracted (holes are disjoint and inside their outer ring). */
export function netOverlap(a: Shape, b: Shape): number {
  let ov = polygonOverlapArea(a.outer, b.outer);
  for (const h of a.holes) ov -= polygonOverlapArea(h, b.outer);
  for (const h of b.holes) ov -= polygonOverlapArea(a.outer, h);
  for (const ha of a.holes) for (const hb of b.holes) ov += polygonOverlapArea(ha, hb);
  return ov;
}

export const netArea = (s: Shape): number =>
  Math.abs(signedArea(s.outer)) - s.holes.reduce((sum, h) => sum + Math.abs(signedArea(h)), 0);

/** True when `b` is `a` with a different start (same direction). */
function sameCycle(a: Id[], b: Id[]): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const start = b.indexOf(a[0]!);
  return start >= 0 && a.every((id, i) => b[(start + i) % b.length] === id);
}

/** Face holes, reusing the old stored loops (and their order) when they are the same cycles. */
function syncHoles(old: Id[][], face: Id[][]): { holes: Id[][]; changed: boolean } {
  const used = new Set<number>();
  const holes = face.map((loop) => {
    const i = old.findIndex((o, k) => !used.has(k) && sameCycle(o, loop));
    if (i < 0) return loop;
    used.add(i);
    return old[i]!;
  });
  if (used.size === old.length && old.length === face.length) return { holes: old, changed: false };
  return { holes, changed: true };
}

function withLoops(room: Room, walls: Id[], holes: Id[][]): Room {
  const next: Room = { ...structuredClone(room), walls: [...walls] };
  delete next.holes;
  if (holes.length > 0) next.holes = holes.map((h) => [...h]);
  return next;
}

/**
 * Room changes that bring `before.rooms` in line with the faces of `after`.
 * Each old room's identity goes to the face it overlaps most (net of holes;
 * ties: larger face, then smallest node id); when several pick one face the
 * largest overlap wins (ties: smaller room id) and the others are deleted.
 * Leftover faces become new rooms with an empty name, inheriting `floorFinish`
 * from the old room overlapping them most. Rooms whose loops are unchanged up
 * to the start wall produce no change. Inputs are not mutated.
 */
export function syncRooms(before: Readonly<Floor>, after: Readonly<Floor>): EntityChange[] {
  const faces: DetectedRoom[] = detectRooms(after as Floor);
  const faceShapes = faces.map(
    (f) => shapeOf(after, { id: '', name: '', walls: f.walls, holes: f.holes }) as Shape,
  );
  const faceArea = faceShapes.map(netArea);
  const faceMinNode = faces.map((f) => [...f.nodes].sort()[0]!);

  const olds = Object.values(before.rooms).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const overlap = olds.map((room) => {
    const s = shapeOf(before, room);
    return faceShapes.map((fs) => {
      const ov = s ? netOverlap(s, fs) : 0;
      return ov > GEOM_TOL ? ov : 0;
    });
  });

  // Each old room picks its best face.
  const faceBetter = (i: number, j: number, k: number): boolean => {
    const d = overlap[i]![j]! - overlap[i]![k]!;
    if (Math.abs(d) > GEOM_TOL) return d > 0;
    const da = faceArea[j]! - faceArea[k]!;
    if (Math.abs(da) > GEOM_TOL) return da > 0;
    return faceMinNode[j]! < faceMinNode[k]!;
  };
  const owner = new Map<number, number>(); // face -> old room index
  olds.forEach((_, i) => {
    let best = -1;
    faces.forEach((_, j) => {
      if (overlap[i]![j]! > 0 && (best < 0 || faceBetter(i, j, best))) best = j;
    });
    if (best < 0) return;
    const rival = owner.get(best);
    // Olds are in id order, so an equal overlap keeps the earlier (smaller id) room.
    if (rival === undefined || overlap[i]![best]! > overlap[rival]![best]! + GEOM_TOL) {
      owner.set(best, i);
    }
  });
  const faceOf = new Map<number, number>([...owner].map(([j, i]) => [i, j]));

  const changes: EntityChange[] = [];
  olds.forEach((room, i) => {
    const j = faceOf.get(i);
    if (j === undefined) {
      changes.push({ kind: 'room', id: room.id, before: structuredClone(room), after: null });
      return;
    }
    const face = faces[j]!;
    const sameWalls = sameCycle(room.walls, face.walls);
    const { holes, changed } = syncHoles(room.holes ?? [], face.holes);
    if (sameWalls && !changed) return;
    const walls = sameWalls ? room.walls : face.walls;
    changes.push({
      kind: 'room',
      id: room.id,
      before: structuredClone(room),
      after: withLoops(room, walls, holes),
    });
  });

  faces.forEach((face, j) => {
    if (owner.has(j)) return;
    let source = -1;
    olds.forEach((_, i) => {
      if (
        overlap[i]![j]! > 0 &&
        (source < 0 || overlap[i]![j]! > overlap[source]![j]! + GEOM_TOL)
      ) {
        source = i;
      }
    });
    const finish = source >= 0 ? olds[source]!.floorFinish : undefined;
    const room: Room = { id: createId(), name: '', walls: [...face.walls] };
    if (finish !== undefined) room.floorFinish = finish;
    if (face.holes.length > 0) room.holes = face.holes.map((h) => [...h]);
    changes.push({ kind: 'room', id: room.id, before: null, after: room });
  });

  return changes;
}

/** True when some entity of the floor has the id (ids are unique per floor across kinds). */
function inUse(floor: Readonly<Floor>, id: Id): boolean {
  return [
    floor.nodes,
    floor.walls,
    floor.openings,
    floor.rooms,
    floor.items,
    floor.columns,
    floor.stairs,
    floor.roofs,
  ].some((c) => Object.hasOwn(c, id));
}

/**
 * New rooms for the faces of `after` that `before` does not have and that no room of `before`
 * already runs round (same outer walls): what moving walls encloses. Other rooms are left
 * alone. A new room's id comes from its outer walls, so a drag, which re-runs its command
 * from the start at every step, keeps one id.
 */
export function enclosedRooms(before: Readonly<Floor>, after: Readonly<Floor>): EntityChange[] {
  // Sorted wall ids name a loop whatever wall it starts from and whichever way it runs.
  const loopKey = (walls: readonly Id[]): string => [...walls].sort().join(',');
  const stored = new Set(Object.values(before.rooms).map((r) => loopKey(r.walls)));
  const fresh = detectRooms(after as Floor).filter((f) => !stored.has(loopKey(f.walls)));
  if (fresh.length === 0) return [];
  const found = new Set(detectRooms(before as Floor).map((f) => loopKey(f.walls)));
  // A roof may still list a room that is gone; a new room must not take that id and join it.
  const listed = new Set(Object.values(before.roofs).flatMap((r) => r.rooms ?? []));
  const added = new Set<Id>();
  const changes: EntityChange[] = [];
  for (const face of fresh) {
    const key = loopKey(face.walls);
    if (found.has(key)) continue;
    const id = idFor(key, (k) => added.has(k) || listed.has(k) || inUse(before, k));
    added.add(id);
    const room: Room = { id, name: '', walls: [...face.walls] };
    if (face.holes.length > 0) room.holes = face.holes.map((h) => [...h]);
    changes.push({ kind: 'room', id, before: null, after: room });
  }
  return changes;
}
