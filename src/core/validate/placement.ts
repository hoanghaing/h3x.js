import type { EntityChange } from '../document/changes';
import type { H3xDocument, Validator } from '../document/H3xDocument';
import { GEOM_TOL } from '../constants';
import { H3xValidationError } from '../errors';
import { polygonOverlapArea } from '../geometry/clip';
import { polygonContainsPolygon, signedArea } from '../geometry/polygon';
import { openingGeometry } from '../openings/geometry';
import { validateOpeningParams, validateOpeningValues } from '../openings/params';
import { roomShape } from '../rooms/detect';
import {
  columnPolygon,
  convexOverlap,
  itemFootprint,
  openingSpan,
  spanOverlap,
  wallOutlines,
} from '../shapes';
import { COLUMN_OVERLAP_AREA, inRange, openingRange, wallUsableRange } from './layout';
import { validateSwings } from './swing';
import type { Floor, Issue, Item, Opening, PresetResolver, Vec2 } from '../types';

/**
 * The issues that block editing `o`: `invalid-opening`, `opening-out-of-wall` (see openingRange),
 * `opening-overlap`, `opening-too-tall` and `opening-hits-column`. `opening-swing-blocked` only
 * warns, so only `validatePlacements` reports it. `range` is `openingRange(floor, o)` when the
 * caller has it already.
 */
export function checkOpening(
  floor: Floor,
  o: Opening,
  range: { lo: number; hi: number } = openingRange(floor, o),
): Issue[] {
  const out = validateOpeningValues(o);
  const wall = floor.walls[o.wall];
  if (!wall) return out;
  if (!inRange(o.offset, range)) {
    out.push({
      code: 'opening-out-of-wall',
      ids: [o.id, o.wall],
      message: `Opening ${o.id} does not fit inside wall ${o.wall}`,
    });
  }
  for (const other of Object.values(floor.openings)) {
    if (other.id === o.id || other.wall !== o.wall) continue;
    if (spanOverlap(openingSpan(o), openingSpan(other)) > GEOM_TOL) {
      out.push({
        code: 'opening-overlap',
        ids: [o.id, other.id],
        message: `Opening ${o.id} overlaps opening ${other.id}`,
      });
    }
  }
  if (o.sill + o.height > wall.height + GEOM_TOL) {
    out.push({
      code: 'opening-too-tall',
      ids: [o.id, o.wall],
      message: `Opening ${o.id} (sill ${o.sill} + height ${o.height}) is taller than wall ${o.wall}`,
    });
  }
  out.push(...columnHits(floor, o));
  return out;
}

function columnHits(floor: Floor, o: Opening): Issue[] {
  const columns = Object.values(floor.columns);
  // A leaf count out of range cannot be laid out; invalid-opening reports it.
  if (columns.length === 0 || validateOpeningParams(o).length > 0) return [];
  const cut = openingGeometry(floor, o)?.cut;
  if (!cut) return [];
  return columns
    .filter((c) => polygonOverlapArea(cut, columnPolygon(c)) > COLUMN_OVERLAP_AREA)
    .map((c) => ({
      code: 'opening-hits-column',
      ids: [o.id, c.id],
      message: `Opening ${o.id} overlaps column ${c.id}`,
    }));
}

/** Overlap area (m²) of an item footprint and a room hole at or below which they only touch. */
const HOLE_OVERLAP_AREA = 1e-6;

/** Inside some room's drawn (inner) outline and clear of its holes. */
function insideSomeRoom(floor: Floor, fp: Vec2[]): boolean {
  for (const room of Object.values(floor.rooms)) {
    let shape: { outer: Vec2[]; holes: Vec2[][] };
    try {
      shape = roomShape(floor, room, 'inner');
    } catch (err) {
      if (err instanceof H3xValidationError) continue;
      throw err;
    }
    if (shape.outer.length < 3 || signedArea(shape.outer) <= 0) continue;
    if (!polygonContainsPolygon(shape.outer, fp)) continue;
    if (shape.holes.every((h) => polygonOverlapArea(fp, h) <= HOLE_OVERLAP_AREA)) return true;
  }
  return false;
}

export function checkItem(floor: Floor, item: Item, presets: PresetResolver): Issue[] {
  const info = presets(item.preset);
  if (!info) {
    return [
      {
        code: 'unknown-preset',
        ids: [item.id],
        message: `Item ${item.id} uses unknown preset ${item.preset}`,
      },
    ];
  }
  const { w, h } = info.footprint;
  const out: Issue[] = [];

  if (item.mount === 'wall') {
    const wall = floor.walls[item.wall];
    if (!wall) return out;
    if (
      !inRange(item.offset, wallUsableRange(floor, item.wall, { width: w })) ||
      item.elevation < -GEOM_TOL ||
      item.elevation > wall.height - h + GEOM_TOL
    ) {
      out.push({
        code: 'wall-item-out-of-range',
        ids: [item.id, item.wall],
        message: `Item ${item.id} does not fit on wall ${item.wall}`,
      });
    }
    for (const o of Object.values(floor.openings)) {
      if (o.wall !== item.wall) continue;
      const dx = spanOverlap(openingSpan({ offset: item.offset, width: w }), openingSpan(o));
      const dy = Math.min(item.elevation + h, o.sill + o.height) - Math.max(item.elevation, o.sill);
      if (dx > GEOM_TOL && dy > GEOM_TOL) {
        out.push({
          code: 'wall-item-on-opening',
          ids: [item.id, o.id],
          message: `Item ${item.id} covers opening ${o.id}`,
        });
      }
    }
    return out;
  }

  const fp = itemFootprint(item, floor, presets)!;
  if (!insideSomeRoom(floor, fp)) {
    out.push({
      code: 'outside-room',
      ids: [item.id],
      message: `Item ${item.id} is not fully inside a room`,
    });
  }
  if (item.mount === 'ceiling') return out;

  const outlines = wallOutlines(floor);
  for (const wall of Object.values(floor.walls)) {
    const outline = outlines[wall.id];
    if (outline && convexOverlap(fp, outline)) {
      out.push({
        code: 'hits-wall',
        ids: [item.id, wall.id],
        message: `Item ${item.id} overlaps wall ${wall.id}`,
      });
    }
  }
  for (const other of Object.values(floor.items)) {
    if (other.id === item.id || other.mount !== 'floor') continue;
    const oi = presets(other.preset);
    if (!oi || info.layer === 'covering' || oi.layer === 'covering') continue;
    const ofp = itemFootprint(other, floor, presets);
    if (ofp && convexOverlap(fp, ofp)) {
      out.push({
        code: 'hits-item',
        ids: [item.id, other.id],
        message: `Item ${item.id} overlaps item ${other.id}`,
      });
    }
  }
  return out;
}

/**
 * Every placement issue of `floor`, warnings included. `above` is the floor above, which gives
 * stairs their rise; without it a stair's whole bay can block a door's swing.
 */
export function validatePlacements(floor: Floor, presets: PresetResolver, above?: Floor): Issue[] {
  return [
    ...Object.values(floor.openings).flatMap((o) => checkOpening(floor, o)),
    ...validateSwings(floor, above),
    ...Object.values(floor.items).flatMap((i) => checkItem(floor, i, presets)),
  ];
}

const noPresets: PresetResolver = () => undefined;

/** The fields that place an opening; the others only choose what is in it and how it opens. */
const PLACING_KEYS = ['wall', 'preset', 'offset', 'width', 'height', 'sill'] as const;

/**
 * What blocks the edit from `before` to `o`. One that changes only type, hinge, swing, leaves or
 * split is blocked only by the issues it adds, so that a flagged opening stays editable.
 */
function editIssues(floor: Floor, before: Opening | null, o: Opening): Issue[] {
  const issues = checkOpening(floor, o);
  if (issues.length === 0 || !before || PLACING_KEYS.some((k) => before[k] !== o[k])) return issues;
  const key = (i: Issue): string => `${i.code}:${i.ids.join(',')}:${i.message}`;
  const standing = new Set(checkOpening(floor, before).map(key));
  return issues.filter((i) => !standing.has(key(i)));
}

/** Blocking issues for openings / items created or modified by the change set (spec 5.4, R3). */
export const placementValidator: Validator = (
  doc: H3xDocument,
  changes: EntityChange[],
): Issue[] => {
  const floor = doc.floor as Floor;
  const presets = doc.presets ?? noPresets;
  if (changes.some((c) => c.kind === 'node')) return []; // layout edits flag, never block (spec 5.4)
  const out: Issue[] = [];
  for (const c of changes) {
    if (c.after === null) continue;
    if (c.kind === 'opening') {
      const o = floor.openings[c.id];
      if (o) out.push(...editIssues(floor, c.before, o));
    } else if (c.kind === 'item') {
      const it = floor.items[c.id];
      if (it) out.push(...checkItem(floor, it, presets));
    }
  }
  return out;
};
