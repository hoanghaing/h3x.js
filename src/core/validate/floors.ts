import type { Floor, Issue } from '../types';

/** Max centre distance (m) for a column to count as supported from below. */
const SUPPORT_TOL = 0.01;

/**
 * Warns for each column of `floor` with no column in `below` whose centre is
 * within 0.01 m. Non-blocking; `[]` when there is no floor below.
 */
export function validateColumnSupport(floor: Floor, below: Floor | undefined): Issue[] {
  if (!below) return [];
  const lower = Object.values(below.columns);
  const out: Issue[] = [];
  for (const c of Object.values(floor.columns)) {
    const supported = lower.some((l) => Math.hypot(l.x - c.x, l.y - c.y) <= SUPPORT_TOL);
    if (!supported) {
      out.push({
        code: 'column-unsupported',
        ids: [c.id],
        message: `Column ${c.id} has no column below it`,
      });
    }
  }
  return out;
}
