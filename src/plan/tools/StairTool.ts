import { addStair, type Stair, type StairType, type Vec2 } from '../../core';
import { snapBayCorner } from '../snap';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';

/** Smallest bay side (m) a drag may produce. */
const MIN_SIDE = 0.6;
const ALIGN_RADIUS_PX = 8;

export interface StairToolOptions {
  type?: StairType;
  turn?: Stair['turn'];
  hand?: Stair['hand'];
  flightWidth?: number;
}

/**
 * Draws a stair bay: press sets one corner, drag previews the rectangle, release sets the
 * opposite corner and adds an axis-aligned stair (rotation 0) when both sides are at least
 * 0.6 m. Corners snap to room wall-face vertices, else the grid; Alt disables snapping. Esc
 * cancels the drag.
 */
export class StairTool implements Tool {
  private ctx: ToolContext | null = null;
  private start: Vec2 | null = null;

  constructor(private readonly opts: StairToolOptions = {}) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  deactivate(): void {
    this.cancel();
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    if (!this.ctx || e.native.button !== 0) return false;
    this.start = this.snap(e);
    return true;
  }

  onPointerMove(e: PlanPointerEvent): void {
    if (!this.ctx || !this.start) return;
    const p = this.snap(e);
    const s = this.start;
    this.ctx.plan.showPreview([
      [s, { x: p.x, y: s.y }],
      [{ x: p.x, y: s.y }, p],
      [p, { x: s.x, y: p.y }],
      [{ x: s.x, y: p.y }, s],
    ]);
  }

  onPointerUp(e: PlanPointerEvent): void {
    const ctx = this.ctx;
    const s = this.start;
    if (!ctx || !s) return;
    const p = this.snap(e);
    this.cancel();
    const width = Math.abs(p.x - s.x);
    const depth = Math.abs(p.y - s.y);
    if (width < MIN_SIDE || depth < MIN_SIDE) return;
    const cmd = addStair({
      x: (s.x + p.x) / 2,
      y: (s.y + p.y) / 2,
      width,
      depth,
      ...this.opts,
    });
    const res = ctx.doc.tryExecute(cmd);
    if (!res.ok) {
      ctx.plan.reportRejected(res.issues);
      return;
    }
    ctx.plan.reportRejected([]);
    ctx.plan.select({ kind: 'stair', id: cmd.createdId });
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key !== 'Escape' || !this.start) return false;
    this.cancel();
    return true;
  }

  private snap(e: PlanPointerEvent): Vec2 {
    const ctx = this.ctx!;
    if ((e.native as MouseEvent).altKey) return e.plan;
    return snapBayCorner(e.plan, ctx.doc.floor, {
      ...ctx.plan.snapOptions,
      alignRadius: ALIGN_RADIUS_PX / ctx.plan.view.scale,
    }).point;
  }

  private cancel(): void {
    this.start = null;
    this.ctx?.plan.showPreview(null);
  }
}
