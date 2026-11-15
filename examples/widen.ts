import { moveNode, type H3xDocument, type Issue } from '../src/core';

const KEY = 'widen-house';

/** Moves every node on the right-hand exterior side by `dx` as one undo step. */
export function widenHouse(
  doc: H3xDocument,
  dx: number,
): { ok: true } | { ok: false; issues: Issue[] } {
  const nodes = Object.values(doc.floor.nodes);
  const right = Math.max(...nodes.map((n) => n.x));
  let result: { ok: true } | { ok: false; issues: Issue[] } = { ok: true };
  for (const n of nodes) {
    if (Math.abs(n.x - right) > 1e-6) continue;
    result = doc.tryExecute(moveNode(n.id, { x: n.x + dx, y: n.y }), { coalesceKey: KEY });
    if (!result.ok) break;
  }
  doc.endCoalesce();
  return result;
}
