import type { EntityChange } from '../document/changes';
import type { H3xDocument, Validator } from '../document/H3xDocument';
import { GEOM_TOL } from '../constants';
import { H3xValidationError } from '../errors';
import { obbCorners, obbOverlap, wallOBB } from '../geometry/obb';
import type { OBB } from '../geometry/obb';
import { polygonContainsPolygon, signedArea } from '../geometry/polygon';
import { roomPolygon } from '../rooms/detect';
import { inRange, openingRange, wallUsableRange } from './layout';
import type { Floor, Issue, Item, Opening, PresetResolver, Vec2 } from '../types';


export function checkOpening(floor: Floor, o: Opening): Issue[] {
  const wall = floor.walls[o.wall];
  if (!wall) return [];
  const out: Issue[] = [];
  if (!inRange(o.offset, openingRange(floor, o))) {
    out.push({
      code: 'opening-out-of-wall',
      ids: [o.id, o.wall],
      message: `Opening ${o.id} does not fit inside wall ${o.wall}`,
    });
  }
  for (const other of Object.values(floor.openings)) {
    if (other.id === o.id || other.wall !== o.wall) continue;
    const overlap =
      Math.min(o.offset + o.width / 2, other.offset + other.width / 2) -
      Math.max(o.offset - o.width / 2, other.offset - other.width / 2);
    if (overlap > GEOM_TOL) {
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
  return out;
}

const footprintOBB = (
  at: { x: number; y: number; rotation: number },
  w: number,
  d: number,
): OBB => ({
  center: { x: at.x, y: at.y },
  halfW: w / 2,
  halfD: d / 2,
  rotation: at.rotation,
});

function insideSomeRoom(floor: Floor, obb: OBB): boolean {
  const corners = obbCorners(obb);
  for (const room of Object.values(floor.rooms)) {
    let poly: Vec2[];
    try {
      poly = roomPolygon(floor, room, 'inner');
    } catch (err) {
      if (err instanceof H3xValidationError) continue;
      throw err;
    }
    if (poly.length < 3 || signedArea(poly) <= 0) continue;
    if (polygonContainsPolygon(poly, corners)) return true;
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
  const { w, d, h } = info.footprint;
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
      const dx =
        Math.min(item.offset + w / 2, o.offset + o.width / 2) -
        Math.max(item.offset - w / 2, o.offset - o.width / 2);
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

  const obb = footprintOBB(item, w, d);
  if (!insideSomeRoom(floor, obb)) {
    out.push({
      code: 'outside-room',
      ids: [item.id],
      message: `Item ${item.id} is not fully inside a room`,
    });
  }
  if (item.mount === 'ceiling') return out;

  for (const wall of Object.values(floor.walls)) {
    const a = floor.nodes[wall.a];
    const b = floor.nodes[wall.b];
    if (!a || !b) continue;
    if (obbOverlap(obb, wallOBB(a, b, wall.thickness))) {
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
    if (obbOverlap(obb, footprintOBB(other, oi.footprint.w, oi.footprint.d))) {
      out.push({
        code: 'hits-item',
        ids: [item.id, other.id],
        message: `Item ${item.id} overlaps item ${other.id}`,
      });
    }
  }
  return out;
}

export function validatePlacements(floor: Floor, presets: PresetResolver): Issue[] {
  return [
    ...Object.values(floor.openings).flatMap((o) => checkOpening(floor, o)),
    ...Object.values(floor.items).flatMap((i) => checkItem(floor, i, presets)),
  ];
}

const noPresets: PresetResolver = () => undefined;

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
      if (o) out.push(...checkOpening(floor, o));
    } else if (c.kind === 'item') {
      const it = floor.items[c.id];
      if (it) out.push(...checkItem(floor, it, presets));
    }
  }
  return out;
};
