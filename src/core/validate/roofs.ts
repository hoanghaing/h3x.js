import { buildRoof } from '../roofs/geometry';
import type { Floor, Issue } from '../types';

/**
 * Non-blocking roof warnings for `floor`: `roof-invalid-outline` (independent outline not
 * simple, holes outside / crossing), `roof-no-walls` (follow roof whose rooms give no outline),
 * `roof-build-failed` (the skeleton could not be computed; the roof is drawn flat). `ids` is
 * `[roofId]`.
 */
export function validateRoofs(floor: Readonly<Floor>): Issue[] {
  const out: Issue[] = [];
  for (const roof of Object.values(floor.roofs)) {
    const { issue } = buildRoof(roof, floor);
    if (issue) out.push({ code: issue.code, ids: [roof.id], message: issue.message });
  }
  return out;
}
