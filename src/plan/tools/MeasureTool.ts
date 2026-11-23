import type { Vec2 } from '../../core';
import { signedArea } from '../../core/geometry/polygon';
import { add, distance, scale } from '../../core/geometry/vec';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';

/** What the measure tool has measured so far. */
export interface Measurement {
  /** The clicked points (plan metres). */
  points: Vec2[];
  /** Sum of the segment lengths (m), the closing one included once closed. */
  length: number;
  /** Enclosed area (m²) once closed, else null. */
  area: number | null;
  closed: boolean;
}

export interface MeasureToolOptions {
  /** Called whenever the measurement changes (a click, Backspace, Esc). */
  onChange?: (m: Measurement) => void;
}

/** Reach (screen px) of the first point when closing. */
const CLOSE_PX = 8;

/**
 * Measures without editing: each click adds a point (drawing snaps: nodes, wall midpoints,
 * perpendiculars, extensions, alignment, grid; Shift keeps the segment horizontal / vertical, Alt
 * turns snapping off). The preview shows the segment under the pointer with its length and the
 * running total. A click on the first point (three or more points) closes the outline and shows
 * its area. Backspace removes the last point, Esc (or a click after closing) starts over.
 */
export class MeasureTool implements Tool {
  private ctx: ToolContext | null = null;
  private points: Vec2[] = [];
  private closed = false;
  private readonly onChange: ((m: Measurement) => void) | undefined;

  constructor(opts: MeasureToolOptions = {}) {
    this.onChange = opts.onChange;
  }

  /** The current measurement. */
  get measurement(): Measurement {
    const pts = this.points;
    const segs = pts.slice(1).map((p, i) => distance(pts[i]!, p));
    const closing = this.closed && pts.length > 2 ? distance(pts[pts.length - 1]!, pts[0]!) : 0;
    return {
      points: pts.map((p) => ({ ...p })),
      length: segs.reduce((s, x) => s + x, 0) + closing,
      area: this.closed ? Math.abs(signedArea(pts)) : null,
      closed: this.closed,
    };
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  deactivate(): void {
    this.reset(false);
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    const ctx = this.ctx;
    if (!ctx || e.native.button !== 0) return false;
    if (this.closed) this.reset(false);
    const p = this.snap(e).point;
    const first = this.points[0];
    const reach = CLOSE_PX / ctx.plan.view.scale;
    if (first && this.points.length >= 3 && distance(p, first) <= reach) {
      this.closed = true;
    } else {
      const last = this.points[this.points.length - 1];
      if (last && distance(last, p) < 1e-9) return true;
      this.points.push(p);
    }
    this.draw(null);
    this.emit();
    return true;
  }

  onPointerMove(e: PlanPointerEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = this.snap(e);
    ctx.showGuides(r.guides, r.marks);
    if (!this.closed) this.draw(r.point);
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') {
      if (this.points.length === 0) return false;
      this.reset(true);
      return true;
    }
    if (e.key === 'Backspace') {
      if (this.points.length === 0) return false;
      if (this.closed) this.closed = false;
      else this.points.pop();
      this.draw(null);
      this.emit();
      return true;
    }
    return false;
  }

  private snap(e: PlanPointerEvent) {
    const m = e.native as MouseEvent;
    return this.ctx!.snapDraw(e.plan, this.points[this.points.length - 1], m.altKey, this.points, {
      ortho: m.shiftKey,
    });
  }

  /** The outline so far, plus the segment to `pointer`; the label names the newest segment. */
  private draw(pointer: Vec2 | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const pts = pointer ? [...this.points, pointer] : [...this.points];
    if (this.closed && pts.length > 2) pts.push(pts[0]!);
    if (pts.length < 2) {
      ctx.plan.showPreview(null);
      return;
    }
    const segments = pts.slice(1).map((p, i) => [pts[i]!, p] as [Vec2, Vec2]);
    const m = this.measurement;
    if (this.closed) {
      const c = scale(
        this.points.reduce((s, p) => add(s, p), { x: 0, y: 0 }),
        1 / this.points.length,
      );
      ctx.plan.showPreview(segments, {
        at: c,
        text: `${m.area!.toFixed(2)} m² · ${m.length.toFixed(2)} m`,
      });
      return;
    }
    const [a, b] = segments[segments.length - 1]!;
    const seg = distance(a, b);
    const total = m.length + (pointer && this.points.length > 0 ? seg : 0);
    const text =
      segments.length > 1 ? `${seg.toFixed(2)} m (Σ ${total.toFixed(2)} m)` : `${seg.toFixed(2)} m`;
    ctx.plan.showPreview(segments, { at: scale(add(a, b), 0.5), text });
  }

  private reset(emit: boolean): void {
    this.points = [];
    this.closed = false;
    this.ctx?.plan.showPreview(null);
    this.ctx?.showGuides([]);
    if (emit) this.emit();
  }

  private emit(): void {
    this.onChange?.(this.measurement);
  }
}
