import { GEOM_TOL } from '../constants';
import { H3xValidationError } from '../errors';
import { signedArea } from '../geometry/polygon';
import { closestPointOnSegment } from '../geometry/segment';
import {
  EPS,
  add,
  cross,
  distance,
  dot,
  leftNormal,
  normalize,
  scale,
  sub,
  tidy,
} from '../geometry/vec';
import { roomNodeLoop } from '../rooms/detect';
import { openingSpan } from '../shapes';
import { openingRange } from '../validate/layout';
import { checkOpening } from '../validate/placement';
import type { Floor, Hinge, Id, Opening, Swing, Vec2, Wall } from '../types';
import type { Placement, PlacementGuide, PlacementRequest } from './types';

/** Share of the reach by which another wall must be nearer to take over from the current one. */
const HOST_HYSTERESIS = 0.25;
/** A dot of wall directions below this means they face back; above, it is noise or not. */
const FACING_BACK = -1e-6;

interface Frame {
  wall: Wall;
  a: Vec2;
  dir: Vec2;
  left: Vec2;
  len: number;
}

function frameOf(floor: Readonly<Floor>, id: Id | undefined): Frame | null {
  const wall = id === undefined ? undefined : floor.walls[id];
  const a = wall && floor.nodes[wall.a];
  const b = wall && floor.nodes[wall.b];
  if (!wall || !a || !b) return null;
  const len = distance(a, b);
  if (len < EPS) return null;
  const dir = normalize(sub(b, a));
  return { wall, a, dir, left: leftNormal(dir), len };
}

/** Distance from `p` to the wall's faces: to the centre segment minus half the thickness, >= 0. */
function faceDistance(f: Frame, p: Vec2): number {
  const b = add(f.a, scale(f.dir, f.len));
  return Math.max(0, distance(p, closestPointOnSegment(p, f.a, b).point) - f.wall.thickness / 2);
}

/** The host: the known wall, else the nearest in reach, keeping `current` until another is clearly nearer. */
function chooseHost(floor: Readonly<Floor>, req: PlacementRequest): Frame | null {
  if (req.wall !== undefined) return frameOf(floor, req.wall);
  let best: { f: Frame; d: number } | null = null;
  let kept: { f: Frame; d: number } | null = null;
  for (const id of Object.keys(floor.walls)) {
    const f = frameOf(floor, id);
    if (!f) continue;
    const d = faceDistance(f, req.point);
    if (d > req.reach) continue;
    if (!best || d < best.d) best = { f, d };
    if (id === req.current) kept = { f, d };
  }
  if (kept && best && best.d >= kept.d - HOST_HYSTERESIS * req.reach) return kept.f;
  return best?.f ?? null;
}

const other = (s: Swing): Swing => (s === 'left' ? 'right' : 'left');
const otherEnd = (h: Hinge): Hinge => (h === 'a' ? 'b' : 'a');

/**
 * The room on `side` of a wall, or null (outdoors, or inside a hole). Taken from the stored room
 * loops: a room lies left of its outline walked counter-clockwise, and left of a hole walked
 * clockwise.
 */
function roomOnSide(floor: Readonly<Floor>, wall: Wall, side: Swing): Id | null {
  for (const room of Object.values(floor.rooms)) {
    const loops = [room.walls, ...(room.holes ?? [])];
    for (let k = 0; k < loops.length; k++) {
      const walls = loops[k]!;
      const i = walls.indexOf(wall.id);
      if (i < 0) continue;
      let nodes: Id[];
      try {
        nodes = roomNodeLoop(floor as Floor, { ...room, walls });
      } catch (err) {
        if (err instanceof H3xValidationError) continue;
        throw err;
      }
      const area = signedArea(nodes.map((n) => floor.nodes[n]!));
      const roomLeftOfLoop = k === 0 ? area > 0 : area < 0;
      const alongLoop = wall.a === nodes[i];
      const roomSide: Swing = roomLeftOfLoop === alongLoop ? 'left' : 'right';
      if (roomSide === side) return room.id;
    }
  }
  return null;
}

/**
 * Hinge and swing on `host` for an opening that had `hinge` / `swing` on `start`. It keeps the
 * space it opened into (the room on the swing side of the start wall, or outdoors); where that
 * does not decide, it keeps the swing, mirrored when the walls face back. The hinge mirrors with
 * the swing, so the hand seen from the space stays.
 */
function rehost(
  floor: Readonly<Floor>,
  start: Frame,
  host: Frame,
  hinge: Hinge,
  swing: Swing,
): { hinge: Hinge; swing: Swing } {
  if (host.wall.id === start.wall.id) return { hinge, swing };
  const space = roomOnSide(floor, start.wall, swing);
  const left = roomOnSide(floor, host.wall, 'left') === space;
  const right = roomOnSide(floor, host.wall, 'right') === space;
  let side: Swing;
  if (left !== right) side = left ? 'left' : 'right';
  else side = dot(start.dir, host.dir) < FACING_BACK ? other(swing) : swing;
  return side === swing ? { hinge, swing } : { hinge: otherEnd(hinge), swing: side };
}

interface Snap {
  kind: PlacementGuide['kind'];
  offset: number;
  /** Where along the wall the guide is drawn. */
  at: number;
}

const SNAP_ORDER: PlacementGuide['kind'][] = ['end', 'middle', 'opening', 'gap', 'grid'];

/** Every snap for a centre on `f`, strongest kind first. */
function snapsFor(
  f: Frame,
  width: number,
  range: { lo: number; hi: number },
  others: Opening[],
  grid: number,
  raw: number,
): Snap[] {
  const half = width / 2;
  const inside = (s: Snap): boolean =>
    s.offset >= range.lo - GEOM_TOL && s.offset <= range.hi + GEOM_TOL;
  const out: Snap[] = [
    { kind: 'end', offset: range.lo, at: range.lo - half },
    { kind: 'end', offset: range.hi, at: range.hi + half },
    { kind: 'middle', offset: f.len / 2, at: f.len / 2 },
  ];
  const spans = others.map(openingSpan).sort((p, q) => p.lo - q.lo);
  for (const s of spans) {
    out.push(
      { kind: 'opening', offset: s.lo - half, at: s.lo },
      { kind: 'opening', offset: s.hi + half, at: s.hi },
      { kind: 'opening', offset: (s.lo + s.hi) / 2, at: (s.lo + s.hi) / 2 },
    );
  }
  // Free gaps between the face limits and the other openings.
  let from = range.lo - half;
  for (const s of [...spans, { lo: range.hi + half, hi: Infinity }]) {
    if (s.lo - from >= width - GEOM_TOL) {
      const mid = (from + s.lo) / 2;
      out.push({ kind: 'gap', offset: mid, at: mid });
    }
    from = Math.max(from, s.hi);
  }
  if (grid > 0) {
    const g = Math.round(raw / grid) * grid;
    out.push({ kind: 'grid', offset: g, at: g });
  }
  return out.filter(inside);
}

function pick(snaps: Snap[], raw: number, reach: number): Snap | null {
  for (const kind of SNAP_ORDER) {
    let best: Snap | null = null;
    for (const s of snaps) {
      if (s.kind !== kind) continue;
      const d = Math.abs(s.offset - raw);
      if (kind !== 'grid' && d > reach) continue;
      if (!best || d < Math.abs(best.offset - raw)) best = s;
    }
    if (best) return best;
  }
  return null;
}

/**
 * Where an opening goes for a pointer: the host wall in reach (null when none), the centre
 * offset snapped and kept in the usable range (`openingRange`), the hinge and swing, guides for
 * the snap taken, and the issues that make it invalid there. Overlapping another opening is
 * reported, not pushed away, so a drag can pass over it.
 */
export function resolvePlacement(floor: Readonly<Floor>, req: PlacementRequest): Placement | null {
  const host = chooseHost(floor, req);
  if (!host) return null;
  const { opening } = req.subject;
  const start = req.from ? frameOf(floor, req.from.wall) : null;

  // The centre: the pointer minus the grab, kept along the start wall's direction.
  const centre = start && req.from ? sub(req.point, scale(start.dir, req.from.grab)) : req.point;
  const raw = dot(sub(centre, host.a), host.dir);

  const range = openingRange(floor as Floor, { wall: host.wall.id, width: opening.width });
  let offset: number;
  let snap: Snap | null = null;
  if (!(range.hi >= range.lo - GEOM_TOL) || !Number.isFinite(range.lo + range.hi)) {
    offset = host.len / 2;
  } else {
    if (!req.free) {
      const others = Object.values(floor.openings).filter(
        (o) => o.wall === host.wall.id && o.id !== opening.id,
      );
      snap = pick(snapsFor(host, opening.width, range, others, req.grid, raw), raw, req.snapReach);
    }
    offset = Math.min(Math.max(snap ? snap.offset : raw, range.lo), Math.max(range.lo, range.hi));
  }
  offset = tidy(offset);

  let orientation: { hinge: Hinge; swing: Swing };
  if (start) {
    orientation = rehost(floor, start, host, opening.hinge, opening.swing);
  } else {
    const side = cross(host.dir, sub(req.point, host.a)) >= 0 ? 'left' : 'right';
    orientation = { hinge: opening.hinge, swing: side };
  }

  const guides: PlacementGuide[] = [];
  if (snap) {
    const p = add(host.a, scale(host.dir, snap.at));
    const across = scale(host.left, host.wall.thickness / 2);
    guides.push({ kind: snap.kind, from: sub(p, across), to: add(p, across) });
  }

  const id = opening.id ?? '';
  const candidate: Opening = { ...opening, id, wall: host.wall.id, offset, ...orientation };
  const issues = checkOpening(floor as Floor, candidate).map((i) =>
    id === '' ? { ...i, ids: i.ids.filter((x) => x !== '') } : i,
  );
  return { wall: host.wall.id, offset, ...orientation, guides, issues };
}
