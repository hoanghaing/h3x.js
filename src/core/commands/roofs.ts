import type { Command, EntityChange } from '../document/changes';
import { deepEqual } from '../document/history';
import { H3xValidationError } from '../errors';
import { floorOutline, type OutlineRing } from '../floors/outline';
import { pointInPolygon, signedArea } from '../geometry/polygon';
import { createId } from '../ids';
import { roomPolygon } from '../rooms/detect';
import { ROOF_PRESETS, presetEdges, presetWallEdges, type RoofPresetId } from '../roofs/presets';
import type { Floor, Id, Issue, Roof, RoofEdge, Vec2 } from '../types';
import { assertFreeId, fail, notFound } from './shared';

type Created = Command & { createdId: Id };

/** Distance (m) an independent edge may stray from a wall's outer-face line when fitting. */
const FIT_TOL = 0.01;

const MATERIALS: readonly string[] = ['tile', 'metal', 'concrete', 'glass', 'polycarbonate'];
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const angle = (n: unknown): boolean => finite(n) && n > 0 && n < 90;

function validEdge(e: RoofEdge | undefined): string | undefined {
  if (!e || typeof e !== 'object') return 'is missing';
  if (e.kind === 'gable') return undefined;
  if (e.kind !== 'slope') return 'must be slope or gable';
  if (!angle(e.pitch)) return 'pitch must be in (0, 90)';
  if (e.breakHeight !== undefined && !(finite(e.breakHeight) && e.breakHeight > 0)) {
    return 'breakHeight must be finite and > 0';
  }
  if (e.upperPitch !== undefined && !angle(e.upperPitch)) return 'upperPitch must be in (0, 90)';
  if ((e.breakHeight === undefined) !== (e.upperPitch === undefined)) {
    return 'needs both breakHeight and upperPitch, or neither';
  }
  return undefined;
}

/**
 * Issues (code `invalid-roof`) for an unknown kind / material / supports, a pitch outside
 * (0, 90), non-finite or negative sizes, a follow roof without `rooms` (empty is fine), an
 * independent roof with fewer than 3 points, a pitched one whose `edges` do not match the points
 * one to one (a flat one may leave `edges` out), holes with fewer than 3 points, `holeEdges`
 * not matching their hole, a malformed edge spec, or a break height without an upper pitch (or
 * the reverse) on the roof or on an edge.
 */
export function validateRoofParams(r: Roof): Issue[] {
  const out: Issue[] = [];
  const bad = (message: string): void => {
    out.push({ code: 'invalid-roof', ids: [r.id], message });
  };
  if (r.kind !== 'pitched' && r.kind !== 'flat') {
    bad(`Roof kind must be pitched or flat: "${String(r.kind)}"`);
  }
  if (!MATERIALS.includes(r.material)) bad(`Roof material is unknown: "${String(r.material)}"`);
  if (r.supports !== undefined && r.supports !== 'posts') {
    bad(`Roof supports must be posts: "${String(r.supports)}"`);
  }
  if (!angle(r.pitch)) bad('Roof pitch must be in (0, 90)');
  if (r.breakHeight !== undefined && !(finite(r.breakHeight) && r.breakHeight > 0)) {
    bad('Roof breakHeight must be finite and > 0');
  }
  if (r.upperPitch !== undefined && !angle(r.upperPitch)) bad('Roof upperPitch must be in (0, 90)');
  if ((r.breakHeight === undefined) !== (r.upperPitch === undefined)) {
    bad('Roof needs both breakHeight and upperPitch, or neither');
  }
  if (!finite(r.base)) bad('Roof base must be finite');
  for (const k of ['overhang', 'gableOverhang'] as const) {
    if (!finite(r[k]) || r[k] < 0) bad(`Roof ${k} must be finite and >= 0`);
  }
  if (!finite(r.thickness) || r.thickness <= 0) bad('Roof thickness must be finite and > 0');
  if (r.parapet !== undefined && !(finite(r.parapet) && r.parapet >= 0)) {
    bad('Roof parapet must be finite and >= 0');
  }
  for (const k of ['postSize', 'postSpacing'] as const) {
    if (r[k] !== undefined && !(finite(r[k]) && r[k] > 0)) bad(`Roof ${k} must be finite and > 0`);
  }
  for (const [wall, e] of Object.entries(r.wallEdges ?? {})) {
    const why = validEdge(e);
    if (why) bad(`Roof wallEdges "${wall}" ${why}`);
  }
  if (r.follow) {
    if (!Array.isArray(r.rooms)) bad('A follow roof needs rooms (may be empty)');
    return out;
  }
  const ring = (pts: Vec2[] | undefined): pts is Vec2[] =>
    Array.isArray(pts) && pts.length >= 3 && pts.every((p) => finite(p.x) && finite(p.y));
  if (!ring(r.points)) {
    bad('An independent roof needs at least 3 finite points');
  } else if (r.edges === undefined ? r.kind !== 'flat' : r.edges.length !== r.points.length) {
    bad('Roof edges must match points one to one');
  }
  for (const [i, e] of (r.edges ?? []).entries()) {
    const why = validEdge(e);
    if (why) bad(`Roof edge ${i} ${why}`);
  }
  for (const [i, h] of (r.holes ?? []).entries()) {
    if (!ring(h)) bad(`Roof hole ${i} needs at least 3 finite points`);
  }
  for (const [i, he] of (r.holeEdges ?? []).entries()) {
    const hole = r.holes?.[i];
    if (!hole) bad(`Roof holeEdges ${i} has no hole`);
    else if (he.length !== hole.length) bad(`Roof holeEdges ${i} must match its hole one to one`);
    for (const [j, e] of he.entries()) {
      const why = validEdge(e);
      if (why) bad(`Roof hole ${i} edge ${j} ${why}`);
    }
  }
  return out;
}

function check(r: Roof): void {
  const issues = validateRoofParams(r);
  if (issues.length > 0) throw new H3xValidationError(issues);
}

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(structuredClone(o)).filter(([, v]) => v !== undefined)) as T;

export type NewRoof = Partial<Omit<Roof, 'id'>> & { preset?: RoofPresetId };

/**
 * Adds a roof. Preset values are applied first, then the explicit input; `follow` defaults to
 * true unless `points` are given. A preset on an independent pitched roof fills `edges` from
 * `presetEdges`; on a follow roof it stores the preset's gable walls in `wallEdges`.
 */
export function addRoof(input: NewRoof): Created {
  const id = createId();
  return {
    label: 'addRoof',
    createdId: id,
    run: (ctx) => {
      assertFreeId(ctx, id);
      const explicit = defined(input);
      const presetId = explicit.preset;
      const preset = presetId !== undefined ? ROOF_PRESETS[presetId] : undefined;
      if (presetId !== undefined && !preset) {
        throw fail('invalid-roof', [id], `Unknown roof preset "${String(presetId)}"`);
      }
      const after = {
        kind: preset?.shape === 'flat' ? 'flat' : 'pitched',
        follow: input.points === undefined,
        pitch: 30,
        base: 0,
        overhang: 0.5,
        gableOverhang: 0.3,
        thickness: 0.1,
        material: 'tile',
        ...(preset
          ? defined({
              preset: presetId,
              pitch: preset.pitch,
              breakHeight: preset.breakHeight,
              upperPitch: preset.upperPitch,
              overhang: preset.overhang,
              thickness: preset.thickness,
              material: preset.material,
              parapet: preset.parapet,
              supports: preset.supports,
            })
          : {}),
        ...explicit,
        id,
      } as Roof;
      if (presetId && after.kind === 'pitched') {
        if (!after.follow && after.points && !explicit.edges) {
          after.edges = presetEdges(presetId, after.points);
        } else if (after.follow && Array.isArray(after.rooms) && !explicit.wallEdges) {
          const gables: Record<Id, RoofEdge> = {};
          for (const ring of floorOutline(ctx.floor, after.rooms)) {
            for (const [wall, e] of Object.entries(presetWallEdges(presetId, ring))) {
              if (e.kind === 'gable') gables[wall] = e;
            }
          }
          if (Object.keys(gables).length > 0) after.wallEdges = gables;
        }
      }
      check(after);
      return [{ kind: 'roof', id, before: null, after }];
    },
  };
}

const ROOF_KEYS = [
  'kind',
  'preset',
  'follow',
  'points',
  'holes',
  'edges',
  'holeEdges',
  'rooms',
  'wallEdges',
  'pitch',
  'breakHeight',
  'upperPitch',
  'base',
  'overhang',
  'gableOverhang',
  'thickness',
  'material',
  'parapet',
  'supports',
  'postSize',
  'postSpacing',
] as const satisfies readonly (keyof Roof)[];

function getRoof(floor: Readonly<Floor>, id: Id): Roof {
  const r = floor.roofs[id];
  if (!r) throw notFound('Roof', id);
  return r;
}

type OptionalRoofKey = {
  [K in keyof Roof]-?: undefined extends Roof[K] ? K : never;
}[keyof Roof];

/**
 * A patch for `updateRoof`: a value sets the field, `undefined` (or leaving it out) keeps it,
 * and `null` removes an optional field.
 */
export type RoofPatch = {
  [K in Exclude<keyof Roof, 'id'>]?: K extends OptionalRoofKey ? Roof[K] | null : Roof[K];
};

/**
 * Applies the given fields of `patch`: a value sets the field, `undefined` keeps it, `null`
 * removes an optional one (e.g. `{ supports: null }`, or `{ breakHeight: null, upperPitch: null }`
 * to drop a roof-wide break). Changing `follow` is rejected (`invalid-roof`): use `detachRoof` /
 * `fitRoofToWalls`, which convert the outline. No change returns [].
 */
export function updateRoof(id: Id, patch: RoofPatch): Command {
  return {
    label: 'updateRoof',
    run: (ctx) => {
      const r = getRoof(ctx.floor, id);
      if (patch.follow !== undefined && patch.follow !== r.follow) {
        throw fail(
          'invalid-roof',
          [id],
          'updateRoof cannot change follow: use detachRoof or fitRoofToWalls',
        );
      }
      const after = structuredClone(r);
      const rec = after as unknown as Record<string, unknown>;
      for (const k of ROOF_KEYS) {
        const v = patch[k];
        if (v === null) delete rec[k];
        else if (v !== undefined) rec[k] = structuredClone(v);
      }
      if (deepEqual(r, after)) return [];
      check(after);
      return [{ kind: 'roof', id, before: structuredClone(r), after }];
    },
  };
}
export const setRoofParams = updateRoof;

const defaultEdge = (r: Roof): RoofEdge => ({ kind: 'slope', pitch: r.pitch });
const defaultEdges = (n: number, r: Roof): RoofEdge[] =>
  Array.from({ length: n }, () => defaultEdge(r));

/** Sets one edge: an outline / hole edge of an independent roof, or a wall override of a follow roof. */
export function setRoofEdge(
  id: Id,
  ref: { index: number; hole?: number } | { wallId: Id },
  edge: RoofEdge,
): Command {
  return {
    label: 'setRoofEdge',
    run: (ctx) => {
      const r = getRoof(ctx.floor, id);
      const after = structuredClone(r);
      if ('wallId' in ref) {
        if (!r.follow) throw fail('invalid-roof', [id], 'wallId needs a follow roof');
        after.wallEdges = { ...after.wallEdges, [ref.wallId]: structuredClone(edge) };
      } else {
        if (r.follow || !r.points) {
          throw fail('invalid-roof', [id], 'index needs an independent roof');
        }
        if (ref.hole === undefined) {
          after.edges ??= defaultEdges(r.points.length, r);
          if (!after.edges[ref.index]) throw fail('invalid-roof', [id], `No edge ${ref.index}`);
          after.edges[ref.index] = structuredClone(edge);
        } else {
          const holes = r.holes ?? [];
          if (!holes[ref.hole]) throw fail('invalid-roof', [id], `No hole ${ref.hole}`);
          const lists = holes.map((h, i) => after.holeEdges?.[i] ?? defaultEdges(h.length, r));
          after.holeEdges = lists;
          const list = lists[ref.hole]!;
          if (!list[ref.index]) throw fail('invalid-roof', [id], `No edge ${ref.index} on hole`);
          list[ref.index] = structuredClone(edge);
        }
      }
      check(after);
      if (deepEqual(r, after)) return [];
      return [{ kind: 'roof', id, before: structuredClone(r), after }];
    },
  };
}

const sameAsDefault = (e: RoofEdge, r: Roof): boolean =>
  e.kind === 'slope' &&
  Math.abs(e.pitch - r.pitch) < 1e-9 &&
  (e.breakHeight === undefined || e.breakHeight === r.breakHeight) &&
  (e.upperPitch === undefined || e.upperPitch === r.upperPitch);

/**
 * Writes the follow outline into `points` / `holes` (edges from `wallEdges`, default slope at
 * `pitch`), sets follow=false and drops `rooms` / `wallEdges`. Several disjoint outer rings: the
 * first stays on `id`, each other becomes a new roof with the same parameters; holes go to the
 * outer ring containing them. An independent roof is left alone. `newIds` is filled by `run`.
 */
export function detachRoof(id: Id): Command & { newIds: Id[] } {
  const newIds: Id[] = [];
  return {
    label: 'detachRoof',
    newIds,
    run: (ctx) => {
      const r = getRoof(ctx.floor, id);
      if (!r.follow) return [];
      const rings = floorOutline(ctx.floor, r.rooms ?? []);
      const outers = rings.filter((x) => !x.hole);
      if (outers.length === 0) {
        throw fail('invalid-roof', [id], 'The roof has no outline to detach');
      }
      const holes = rings.filter((x) => x.hole);
      const edgesOf = (ring: OutlineRing): RoofEdge[] =>
        ring.walls.map((w) => structuredClone(r.wallEdges?.[w] ?? defaultEdge(r)));
      const build = (outer: OutlineRing, rid: Id): Roof => {
        const roof: Roof = { ...structuredClone(r), id: rid, follow: false };
        delete roof.rooms;
        delete roof.wallEdges;
        const mine = holes.filter((h) => pointInPolygon(h.points[0]!, outer.points));
        roof.points = structuredClone(outer.points);
        roof.edges = edgesOf(outer);
        if (mine.length > 0) {
          roof.holes = mine.map((h) => structuredClone(h.points));
          roof.holeEdges = mine.map(edgesOf);
        }
        return roof;
      };
      const out: EntityChange[] = [
        { kind: 'roof', id, before: structuredClone(r), after: build(outers[0]!, id) },
      ];
      outers.slice(1).forEach((outer, i) => {
        const nid = (newIds[i] ??= createId());
        assertFreeId(ctx, nid);
        out.push({ kind: 'roof', id: nid, before: null, after: build(outer, nid) });
      });
      newIds.length = outers.length - 1;
      for (const c of out) if (c.kind === 'roof' && c.after) check(c.after);
      return out;
    },
  };
}

function centroid(pts: Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) > 1e-9) {
    let cx = 0;
    let cy = 0;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      const w = p.x * q.y - q.x * p.y;
      cx += (p.x + q.x) * w;
      cy += (p.y + q.y) * w;
    });
    return { x: cx / (6 * a), y: cy / (6 * a) };
  }
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
}

/** Overlap (m) of segment p-q projected on a-b, or 0 when p or q is off a-b's line. */
function overlapOnLine(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l === 0) return 0;
  const off = (v: Vec2): number => Math.abs((v.x - a.x) * dy - (v.y - a.y) * dx) / l;
  if (off(p) > FIT_TOL || off(q) > FIT_TOL) return 0;
  const t = (v: Vec2): number => ((v.x - a.x) * dx + (v.y - a.y) * dy) / l;
  const lo = Math.max(Math.min(t(p), t(q)), 0);
  const hi = Math.min(Math.max(t(p), t(q)), l);
  return Math.max(hi - lo, 0);
}

/**
 * Makes the roof follow the walls again: follow=true, `rooms` (given, or the rooms whose centre
 * lies inside the independent outline), points / holes / edges dropped. Each edge lying on a
 * wall's outer-face line (within 1 cm, overlapping it) that differs from the default slope is
 * kept as `wallEdges[wall]`; other per-edge specs are lost.
 */
export function fitRoofToWalls(id: Id, rooms?: Id[]): Command {
  return {
    label: 'fitRoofToWalls',
    run: (ctx) => {
      const r = getRoof(ctx.floor, id);
      const floor = ctx.floor as Floor;
      const outer = r.points;
      const holes = r.holes ?? [];
      const inside = (room: Floor['rooms'][Id]): boolean => {
        if (!outer) return false;
        try {
          const c = centroid(roomPolygon(floor, room, 'center'));
          return pointInPolygon(c, outer) && !holes.some((h) => pointInPolygon(c, h));
        } catch (e) {
          if (e instanceof H3xValidationError) return false;
          throw e;
        }
      };
      const chosen =
        rooms ??
        (r.follow
          ? (r.rooms ?? [])
          : Object.values(floor.rooms)
              .filter(inside)
              .map((room) => room.id));
      const after = structuredClone(r);
      after.follow = true;
      after.rooms = [...new Set(chosen)];
      delete after.points;
      delete after.holes;
      delete after.edges;
      delete after.holeEdges;
      if (!r.follow && outer) {
        const rings = floorOutline(floor, after.rooms);
        const found = new Map<Id, { overlap: number; edge: RoofEdge }>();
        const consider = (pts: Vec2[], edges: RoofEdge[] | undefined): void => {
          pts.forEach((p, i) => {
            const q = pts[(i + 1) % pts.length]!;
            const edge = edges?.[i] ?? defaultEdge(r);
            for (const ring of rings) {
              ring.points.forEach((a, k) => {
                const wall = ring.walls[k];
                if (wall === undefined) return;
                const o = overlapOnLine(p, q, a, ring.points[(k + 1) % ring.points.length]!);
                if (o > 0 && o > (found.get(wall)?.overlap ?? 0)) {
                  found.set(wall, { overlap: o, edge });
                }
              });
            }
          });
        };
        consider(outer, r.edges);
        holes.forEach((h, i) => consider(h, r.holeEdges?.[i]));
        const wallEdges: Record<Id, RoofEdge> = {};
        for (const [wall, { edge }] of [...found].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
          if (!sameAsDefault(edge, r)) wallEdges[wall] = structuredClone(edge);
        }
        if (Object.keys(wallEdges).length > 0) after.wallEdges = wallEdges;
        else delete after.wallEdges;
      }
      if (deepEqual(r, after)) return [];
      check(after);
      return [{ kind: 'roof', id, before: structuredClone(r), after }];
    },
  };
}

export function removeRoof(id: Id): Command {
  return {
    label: 'removeRoof',
    run: (ctx) => {
      const r = getRoof(ctx.floor, id);
      return [{ kind: 'roof', id, before: structuredClone(r), after: null }];
    },
  };
}
