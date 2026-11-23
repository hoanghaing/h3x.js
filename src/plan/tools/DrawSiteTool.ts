import { setSite, type Vec2 } from '../../core';
import { GEOM_TOL } from '../../core/constants';
import { distance } from '../../core/geometry/vec';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';

/** Screen distance within which a click on the first vertex closes the polygon. */
const CLOSE_REACH_PX = 8;

/**
 * Draws the site outline: every click adds a vertex; clicking within 8 screen px of the first
 * vertex (with at least 3 vertices) closes the polygon, as do Enter and double-click. Nothing is
 * committed until then: closing runs one `setSite` (one undo step). Esc cancels the whole polygon.
 * Closing with fewer than 3 vertices does nothing. Snapping uses grid, alignment, 45-degree locks
 * and the polygon's own vertices; walls and nodes are not snap targets. Alt disables snapping.
 */
export class DrawSiteTool implements Tool {
  private ctx: ToolContext | null = null;
  private points: Vec2[] = [];

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  deactivate(): void {
    this.cancel();
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    const ctx = this.ctx;
    if (!ctx || e.native.button !== 0) return false;
    const first = this.points[0];
    if (first && this.points.length >= 3 && this.nearFirst(e, first)) {
      this.close();
      return true;
    }
    const { point } = this.snap(e);
    const last = this.points[this.points.length - 1];
    // The second click of a double-click, or a click on the first vertex of a short polygon.
    if (last && distance(point, last) < GEOM_TOL) return true;
    if (first && distance(point, first) < GEOM_TOL) return true;
    this.points.push(point);
    this.refresh(point);
    return true;
  }

  onPointerMove(e: PlanPointerEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = this.snap(e);
    ctx.showGuides(r.guides, r.marks);
    this.refresh(r.point);
  }

  onDoubleClick(): void {
    this.close();
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (this.points.length === 0) return false;
    if (e.key === 'Escape') {
      this.cancel();
      return true;
    }
    if (e.key === 'Enter') {
      this.close();
      return true;
    }
    return false;
  }

  private snap(e: PlanPointerEvent) {
    return this.ctx!.snapDraw(
      e.plan,
      this.points[this.points.length - 1],
      (e.native as MouseEvent).altKey,
      this.points,
      { structure: false, site: false, ortho: (e.native as MouseEvent).shiftKey },
    );
  }

  private nearFirst(e: PlanPointerEvent, first: Vec2): boolean {
    const s = this.ctx!.plan.planToScreen(first);
    return Math.hypot(s.x - e.screen.x, s.y - e.screen.y) <= CLOSE_REACH_PX;
  }

  /** The polygon so far plus the rubber-band segment to `cursor`. */
  private refresh(cursor: Vec2): void {
    const pts = this.points;
    if (pts.length === 0) return;
    const segs: [Vec2, Vec2][] = [];
    for (let i = 1; i < pts.length; i++) segs.push([pts[i - 1]!, pts[i]!]);
    segs.push([pts[pts.length - 1]!, cursor]);
    this.ctx!.plan.showPreview(segs);
  }

  private close(): void {
    const ctx = this.ctx;
    if (!ctx || this.points.length < 3) return;
    const res = ctx.doc.tryExecute(setSite(this.points));
    if (!res.ok) {
      ctx.plan.reportRejected(res.issues);
      return;
    }
    ctx.plan.reportRejected([]);
    this.cancel();
  }

  private cancel(): void {
    this.points = [];
    if (!this.ctx) return;
    this.ctx.plan.showPreview(null);
    this.ctx.showGuides([]);
  }
}
