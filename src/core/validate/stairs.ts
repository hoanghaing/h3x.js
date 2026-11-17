import { polygonOverlapArea } from '../geometry/clip';
import { wallOutlines } from '../shapes';
import { layoutStair, stairOutline } from '../stairs/layout';
import type { Floor, Issue } from '../types';

/** Overlap area (m²) between a stair outline and a wall outline above which the wall is reported. */
const WALL_OVERLAP_AREA = 1e-4;

/** Rise from `floor` to `above` (`elevation(above) - elevation(floor)`); `NaN` without a floor above. */
export function stairRise(floor: Floor, above: Floor | undefined): number {
  return above ? above.elevation - floor.elevation : NaN;
}

/**
 * Non-blocking warnings for the stairs of `floor`: no floor above, flights that do not fit
 * the bay for the current rise, and stair outlines (`stairOutline`) overlapping a wall. `ids` is `[stairId]`, plus the
 * wall id for `stair-overlaps-wall`.
 */
export function validateStairs(floor: Floor, above: Floor | undefined): Issue[] {
  const out: Issue[] = [];
  const rise = stairRise(floor, above);
  const walls = Object.keys(floor.stairs).length > 0 ? wallOutlines(floor) : {};
  for (const s of Object.values(floor.stairs)) {
    if (!above) {
      out.push({
        code: 'stair-no-floor-above',
        ids: [s.id],
        message: `Stair ${s.id} has no floor above to reach`,
      });
    } else {
      const l = layoutStair(s, rise);
      if (!l.ok && l.reason === 'does-not-fit') {
        out.push({
          code: 'stair-does-not-fit',
          ids: [s.id],
          message: `Stair ${s.id} does not fit its bay for a rise of ${rise} m`,
        });
      }
    }
    const outline = stairOutline(s, rise);
    for (const w of Object.values(floor.walls)) {
      const wall = walls[w.id];
      if (wall && polygonOverlapArea(outline, wall) > WALL_OVERLAP_AREA) {
        out.push({
          code: 'stair-overlaps-wall',
          ids: [s.id, w.id],
          message: `Stair ${s.id} overlaps wall ${w.id}`,
        });
      }
    }
  }
  return out;
}
