import { addColumn } from '../../core';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';

export interface ColumnToolOptions {
  /** Default 'square'. */
  shape?: 'round' | 'square';
  /** Diameter (round) or side (square) in meters. Default 0.3. */
  width?: number;
  /** Square only; defaults to width. */
  depth?: number;
}

/**
 * Places a column per click (`addColumn`, one undo step) at the snapped point (node, wall line,
 * alignment or grid) and selects it. Alt disables snapping.
 */
export class ColumnTool implements Tool {
  private readonly shape: 'round' | 'square';
  private readonly width: number;
  private readonly depth: number | undefined;
  private ctx: ToolContext | null = null;

  constructor(opts: ColumnToolOptions = {}) {
    this.shape = opts.shape ?? 'square';
    this.width = opts.width ?? 0.3;
    this.depth = opts.depth;
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  deactivate(): void {
    this.ctx?.showGuides([]);
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    const ctx = this.ctx;
    if (!ctx || e.native.button !== 0) return false;
    const { point } = ctx.snapDraw(e.plan, undefined, (e.native as MouseEvent).altKey);
    const cmd = addColumn({
      x: point.x,
      y: point.y,
      shape: this.shape,
      width: this.width,
      ...(this.shape === 'square' && this.depth !== undefined ? { depth: this.depth } : {}),
    });
    const res = ctx.doc.tryExecute(cmd);
    if (!res.ok) {
      ctx.plan.reportRejected(res.issues);
      return true;
    }
    ctx.plan.reportRejected([]);
    ctx.plan.select({ kind: 'column', id: cmd.createdId });
    return true;
  }

  onPointerMove(e: PlanPointerEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.showGuides(ctx.snapDraw(e.plan, undefined, (e.native as MouseEvent).altKey).guides);
  }
}
