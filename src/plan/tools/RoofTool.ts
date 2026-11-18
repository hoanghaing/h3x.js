import { addRoof, applyRoofPreset, type Command, type Id, type Vec2 } from '../../core';
import { GEOM_TOL } from '../../core/constants';
import { signedArea } from '../../core/geometry/polygon';
import { distance } from '../../core/geometry/vec';
import type { RoofPresetId } from '../../core/roofs/presets';
import { roomAt } from '../hit';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';

/** Screen distance within which a click on the first vertex closes the polygon. */
const CLOSE_REACH_PX = 8;

export interface RoofToolOptions {
  /** Roof preset applied to new roofs. Default 'thai'. */
  preset?: RoofPresetId;
  /** 'follow' (default): click in a room. 'draw': draw an independent outline. */
  mode?: 'follow' | 'draw';
}

/**
 * Adds roofs. Follow mode: a click inside a room adds a roof that follows that room's outer wall
 * faces and selects it; a click on an existing roof (or in a room an existing follow roof covers)
 * replaces that roof's kind with the tool's preset (`applyRoofPreset`) instead of stacking a new
 * one, and selects it; a click outside every room is rejected (`roof-no-room`). Delete /
 * Backspace removes the selected roof. Draw mode: like
 * `DrawSiteTool`, every click adds a vertex (snapping to nodes, walls, the site, alignments, 45
 * degree locks and the grid); a click within 8 screen px of the first vertex (with at least 3),
 * Enter or a double-click closes the polygon and adds one independent roof (one undo step). Esc
 * cancels. Alt disables snapping.
 */
export class RoofTool implements Tool {
  private ctx: ToolContext | null = null;
  private points: Vec2[] = [];
  private preset: RoofPresetId;
  private mode: 'follow' | 'draw';

  constructor(opts: RoofToolOptions = {}) {
    this.preset = opts.preset ?? 'thai';
    this.mode = opts.mode ?? 'follow';
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
  }

  /** Changes the preset for the next roofs (and replacements) and / or the mode; a drawing in progress is cancelled when the mode changes. */
  setOptions(opts: RoofToolOptions): void {
    if (opts.preset !== undefined) this.preset = opts.preset;
    if (opts.mode !== undefined && opts.mode !== this.mode) {
      this.cancel();
      this.mode = opts.mode;
    }
  }

  deactivate(): void {
    this.cancel();
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    const ctx = this.ctx;
    if (!ctx || e.native.button !== 0) return false;
    if (this.mode === 'follow') {
      this.addFollow(e);
      return true;
    }
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
    if (!ctx || this.mode !== 'draw') return;
    const r = this.snap(e);
    ctx.showGuides(r.guides);
    this.refresh(r.point);
  }

  onDoubleClick(): void {
    if (this.mode === 'draw') this.close();
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (this.points.length === 0) return this.deleteSelected(e);
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

  /** Delete / Backspace with a roof selected removes it. */
  private deleteSelected(e: KeyboardEvent): boolean {
    const ctx = this.ctx;
    const sel = ctx?.plan.selection;
    if (!ctx || sel?.kind !== 'roof' || (e.key !== 'Delete' && e.key !== 'Backspace')) return false;
    ctx.plan.deleteSelection();
    return true;
  }

  private addFollow(e: PlanPointerEvent): void {
    const ctx = this.ctx!;
    const floor = ctx.doc.floor;
    const room = roomAt(floor, e.plan);
    const existing: Id | undefined =
      e.hit?.kind === 'roof'
        ? e.hit.id
        : room
          ? Object.values(floor.roofs).find((r) => r.follow && r.rooms?.includes(room.id))?.id
          : undefined;
    if (existing) {
      this.replace(existing);
      return;
    }
    if (!room) {
      ctx.plan.reportRejected([
        { code: 'roof-no-room', ids: [], message: 'Click inside a room to add a roof' },
      ]);
      return;
    }
    // A preset's gable walls are stored by `addRoof` itself (wallEdges of a follow roof).
    this.commit(addRoof({ preset: this.preset, follow: true, rooms: [room.id] }));
  }

  /** Gives an existing roof the tool's preset (no-op when it already has it) and selects it. */
  private replace(id: Id): void {
    const ctx = this.ctx!;
    const cmd: Command = applyRoofPreset(id, this.preset);
    const res = ctx.doc.tryExecute(cmd);
    if (!res.ok) {
      ctx.plan.reportRejected(res.issues);
      return;
    }
    ctx.plan.reportRejected([]);
    ctx.plan.select({ kind: 'roof', id });
  }

  private commit(cmd: ReturnType<typeof addRoof>): boolean {
    const ctx = this.ctx!;
    const res = ctx.doc.tryExecute(cmd);
    if (!res.ok) {
      ctx.plan.reportRejected(res.issues);
      return false;
    }
    ctx.plan.reportRejected([]);
    ctx.plan.select({ kind: 'roof', id: cmd.createdId });
    return true;
  }

  private snap(e: PlanPointerEvent) {
    return this.ctx!.snapDraw(
      e.plan,
      this.points[this.points.length - 1],
      (e.native as MouseEvent).altKey,
      this.points,
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
    // Roof outlines are counter-clockwise.
    const points = signedArea(this.points) < 0 ? [...this.points].reverse() : [...this.points];
    if (this.commit(addRoof({ preset: this.preset, points }))) this.cancel();
  }

  private cancel(): void {
    this.points = [];
    if (!this.ctx) return;
    this.ctx.plan.showPreview(null);
    this.ctx.showGuides([]);
  }
}
