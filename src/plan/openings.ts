import { pieceOutline, type OpeningGeometry } from '../core';
import { pointsAttr } from './render';

/**
 * The default symbol of an opening, in plan space: the gap polygon's points, a path of solid
 * strokes and a path of dashed ones (swing arcs, and the box above a rolling door). It only
 * chooses strokes: every coordinate comes from the geometry.
 */
export function paintOpening(g: OpeningGeometry): { gap: string; lines: string; arcs: string } {
  let lines = '';
  let arcs = '';
  for (const piece of g.plan) {
    const rect = piece.depth > 0;
    const points = rect ? pieceOutline(piece) : [piece.a, piece.b];
    const d = `M${points.map((p) => `${p.x},${p.y}`).join('L')}${rect ? 'Z' : ''}`;
    if (piece.role === 'box') arcs += d;
    else lines += d;
  }
  for (const { arc } of g.sweeps) {
    if (!arc) continue;
    const { from, to, r, ccw } = arc;
    arcs += `M${from.x},${from.y}A${r},${r} 0 0 ${ccw ? 1 : 0} ${to.x},${to.y}`;
  }
  return { gap: pointsAttr(g.cut), lines, arcs };
}
