import type { EntityChange } from '../document/changes';
import { floorOutline } from '../floors/outline';
import { polygonOverlapArea } from '../geometry/clip';
import { signedArea } from '../geometry/polygon';
import { netArea, netOverlap, shapeOf, type Shape } from '../rooms/sync';
import type { Floor, Id, Roof, Room } from '../types';
import { detachedRoofs } from './detach';

/** Areas (m²) closer than this are the same coverage. */
const AREA_TOL = 1e-4;

/** Area inside the centre lines of the outline of `rooms`. */
const coveredArea = (floor: Readonly<Floor>, rooms: readonly Id[]): number =>
  floorOutline(floor, rooms).reduce((sum, ring) => sum + signedArea(ring.centre), 0);

/** Whether room `inner` lies within the outer loop of the larger room `outer`. */
function encloses(outer: Shape, inner: Shape): boolean {
  const area = Math.abs(signedArea(inner.outer));
  if (Math.abs(signedArea(outer.outer)) <= area + AREA_TOL) return false;
  return polygonOverlapArea(outer.outer, inner.outer) >= area - AREA_TOL;
}

/**
 * Keeps what follow roofs cover when a structural edit adds or deletes rooms, given the room
 * changes of that edit (`after.rooms` is still the old set). A roof never grows or shrinks
 * because rooms change:
 * - a new room lying mostly under a roof joins it (a split), unless it is a block inside one of
 *   the roof's rooms, which that room's outline covers already;
 * - a merge of roofed rooms drops the deleted ids;
 * - a merge with a room the roof does not cover, or a roofed room that is opened, detaches the
 *   roof with the shape it had, unless the covered area is the same.
 * Edits that only move walls change no room ids, so roofs keep following them. Mutates
 * `after.roofs`.
 */
export function syncRoofs(
  before: Readonly<Floor>,
  after: Floor,
  changes: readonly EntityChange[],
  newId: (roof: Id, k: number) => Id,
): void {
  const follows = Object.values(before.roofs).filter((r) => r.follow && r.rooms?.length);
  if (follows.length === 0) return;
  const rooms: Record<Id, Room> = { ...before.rooms };
  const created: Id[] = [];
  const deleted: Id[] = [];
  for (const c of changes) {
    if (c.kind !== 'room') continue;
    if (c.after) {
      rooms[c.id] = c.after;
      if (!c.before) created.push(c.id);
    } else {
      delete rooms[c.id];
      deleted.push(c.id);
    }
  }
  if (created.length === 0 && deleted.length === 0) return;

  const next: Floor = { ...after, rooms };
  const was = new Map<Id, Shape | null>();
  const now = new Map<Id, Shape | null>();
  for (const r of Object.values(before.rooms)) was.set(r.id, shapeOf(before, r));
  for (const r of Object.values(rooms)) now.set(r.id, shapeOf(next, r));

  /** The room that took in most of each deleted room; none when it was opened. */
  const host = new Map<Id, Id>();
  for (const id of deleted) {
    const s = was.get(id);
    if (!s) continue;
    let most = netArea(s) / 2;
    for (const [other, shape] of now) {
      const shared = shape ? netOverlap(s, shape) : 0;
      if (shared > most) {
        most = shared;
        host.set(id, other);
      }
    }
  }

  for (const old of follows) {
    const roof: Roof | undefined = after.roofs[old.id];
    if (!roof) continue;
    const had = new Set(old.rooms);
    const added = new Set(
      created.filter((id) => {
        const s = now.get(id);
        if (!s) return false;
        let shared = 0;
        for (const r of had) {
          const o = was.get(r);
          if (o) shared += netOverlap(o, s);
        }
        return shared > netArea(s) / 2;
      }),
    );
    const members = [...new Set([...old.rooms!.filter((id) => !deleted.includes(id)), ...added])];
    // A block and the room around it: only the surrounding room stays, or the block would get
    // a second body.
    const covering = members.filter(
      (id) =>
        !members.some((other) => {
          if (other === id || (!added.has(id) && !added.has(other))) return false;
          const inner = now.get(id);
          const outer = now.get(other);
          return !!inner && !!outer && encloses(outer, inner);
        }),
    );

    const mergedAcross = deleted.some((id) => {
      const into = host.get(id);
      return had.has(id) !== (into !== undefined && members.includes(into));
    });
    if (
      mergedAcross &&
      Math.abs(coveredArea(before, old.rooms!) - coveredArea(next, covering)) > AREA_TOL
    ) {
      const kept = detachedRoofs(old, before, (k) => newId(old.id, k));
      if (kept.length > 0) {
        for (const r of kept) after.roofs[r.id] = r;
        continue;
      }
    }
    if (covering.length !== old.rooms!.length || covering.some((id, i) => id !== old.rooms![i])) {
      roof.rooms = covering;
    }
  }
}
