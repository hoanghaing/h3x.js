import { addWall, type ChangeEvent, type Id, type Vec2, type WallEnd } from '../../core';
import { GEOM_TOL } from '../../core/constants';
import { add, distance, normalize, scale, sub } from '../../core/geometry/vec';
import type { DrawSnapTarget } from '../snap';
import { ClickChain } from './chain';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';

export interface DrawWallToolOptions {
  /** Thickness of new walls in meters. Default 0.2. */
  thickness?: number;
  /** Height of new walls in meters. Default: the floor's wall height. */
  height?: number;
}

/** One of the tool's own document calls; a commit collects what its change event created. */
type OwnCall = { kind: 'commit'; created: Set<Id>; changed: boolean } | { kind: 'undo' };

/**
 * Draws chains of walls: the first click sets the start point, every further click commits one
 * wall (`addWall`, one undo step) and continues from its end. Clicking the chain's start node or
 * an existing node / wall ends the chain; so do double-click and Enter. Esc drops the preview and
 * ends the chain (committed walls stay). Backspace undoes the chain's last click while the
 * newest history entry is that click. Alt disables snapping.
 *
 * Whenever a new segment starts, the plan fires `segmentLengthRequest` (length 0, direction of
 * the last preview or zero) so a host can offer a length input; the live length is in the
 * preview label, and `plan.setPendingSegmentLength(len)` commits the segment.
 */
export class DrawWallTool implements Tool {
  private readonly thickness: number;
  private readonly height: number | undefined;
  private ctx: ToolContext | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly chain = new ClickChain();
  /** Unit direction of the current preview segment, or null before the pointer moved. */
  private dir: Vec2 | null = null;
  /** Set while the tool's own document calls run. */
  private own: OwnCall | null = null;
  private rejecting = false;

  constructor(opts: DrawWallToolOptions = {}) {
    this.thickness = opts.thickness ?? 0.2;
    this.height = opts.height;
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.unsubscribe = ctx.doc.on('change', (e) => this.onChange(e));
  }

  deactivate(): void {
    this.endChain();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    if (!this.ctx || e.native.button !== 0) return false;
    const r = this.snap(e);
    this.click(r.point, r.target);
    return true;
  }

  onPointerMove(e: PlanPointerEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const r = this.snap(e);
    ctx.showGuides(r.guides);
    const last = this.chain.last;
    if (!last) return;
    const len = distance(last.at, r.point);
    if (len > GEOM_TOL) this.dir = normalize(sub(r.point, last.at));
    ctx.plan.showPreview([[last.at, r.point]], {
      at: scale(add(last.at, r.point), 0.5),
      text: `${len.toFixed(2)} m`,
    });
  }

  onDoubleClick(): void {
    this.endChain();
  }

  onKeyDown(e: KeyboardEvent): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (!this.chain.last) return false;
      this.endChain();
      return true;
    }
    if (e.key === 'Backspace') {
      if (!this.chain.canStepBack(ctx.doc.canUndo)) return false;
      this.issue({ kind: 'undo' }, () => ctx.doc.undo());
      this.chain.stepBack();
      this.dir = null;
      ctx.plan.showPreview(null);
      this.startSegment();
      return true;
    }
    return false;
  }

  /**
   * Commits the current segment at `length` along the preview direction; false without one or
   * when `length` is not a finite positive number.
   */
  setPendingSegmentLength(length: number): boolean {
    const last = this.chain.last;
    if (!this.ctx || !last || !this.dir) return false;
    if (!(Number.isFinite(length) && length > 0)) return false;
    return this.commit(add(last.at, scale(this.dir, length)), { kind: 'free' });
  }

  private snap(e: PlanPointerEvent) {
    return this.ctx!.snapDraw(e.plan, this.chain.last?.at, (e.native as MouseEvent).altKey);
  }

  private click(point: Vec2, target: DrawSnapTarget): void {
    const last = this.chain.last;
    if (!last) {
      const end: WallEnd = target.kind === 'node' ? { node: target.id } : { at: point };
      this.chain.points.push({
        at: point,
        node: target.kind === 'node' ? target.id : null,
        end,
        mark: null,
        before: this.chain.historyState,
        created: new Set(),
      });
      this.startSegment();
      return;
    }
    // The second click of a double-click lands on the point just committed.
    if (target.kind === 'node' && target.id === last.node) return;
    if (distance(point, last.at) < GEOM_TOL) return;
    this.commit(point, target);
  }

  /** Adds the wall from the chain's last point to `point`; returns whether it was committed. */
  private commit(point: Vec2, target: DrawSnapTarget): boolean {
    const ctx = this.ctx!;
    const last = this.chain.last!;
    const start = this.chain.points[0]!;
    const ends =
      (target.kind === 'node' && target.id === start.node) ||
      (target.kind !== 'free' && !last.created.has(target.id));
    const cmd = addWall({
      from: last.node ? { node: last.node } : { at: last.at },
      to: target.kind === 'node' ? { node: target.id } : { at: point },
      thickness: this.thickness,
      ...(this.height !== undefined ? { height: this.height } : {}),
    });
    const before = this.chain.historyState;
    const own = { kind: 'commit' as const, created: new Set<Id>(), changed: false };
    const res = this.issue(own, () => ctx.doc.tryExecute(cmd));
    if (!res.ok) {
      this.rejecting = true;
      ctx.plan.reportRejected(res.issues);
      return false;
    }
    if (this.rejecting) {
      this.rejecting = false;
      ctx.plan.reportRejected([]);
    }
    const floor = ctx.doc.floor;
    if (start.node === null && this.chain.points.length === 1) {
      const w = floor.walls[cmd.createdId];
      const a = w && floor.nodes[w.a];
      const b = w && floor.nodes[w.b];
      if (a && b) start.node = distance(a, start.at) <= distance(b, start.at) ? a.id : b.id;
    }
    const endNode = floor.nodes[cmd.endNodeId];
    this.chain.points.push({
      at: endNode ? { x: endNode.x, y: endNode.y } : point,
      node: cmd.endNodeId,
      end: { node: cmd.endNodeId },
      mark: own.changed ? this.chain.historyState : null,
      before,
      created: own.created,
    });
    if (ends) {
      this.endChain();
    } else {
      this.dir = null;
      ctx.plan.showPreview(null);
      this.startSegment();
    }
    return true;
  }

  private onChange(e: ChangeEvent): void {
    const own = this.own;
    if (own?.kind === 'undo') return; // the chain restores its history state itself
    this.chain.noteChange();
    if (own?.kind === 'commit') {
      own.changed = true;
      for (const c of e.changes) if (c.before === null) own.created.add(c.id);
      return;
    }
    // A foreign change: the chain cannot continue from a node that is gone.
    const node = this.chain.last?.node;
    if (node && !this.ctx?.doc.floor.nodes[node]) this.endChain();
  }

  /** Runs one of the tool's own document calls, so its change events are told apart. */
  private issue<T>(own: OwnCall, fn: () => T): T {
    this.own = own;
    try {
      return fn();
    } finally {
      this.own = null;
    }
  }

  private startSegment(): void {
    const last = this.chain.last;
    if (!last || !this.ctx) return;
    this.ctx.plan.emitSegmentLengthRequest({
      from: { ...last.at },
      direction: this.dir ? { ...this.dir } : { x: 0, y: 0 },
      length: 0,
    });
  }

  private endChain(): void {
    this.chain.reset();
    this.dir = null;
    if (!this.ctx) return;
    this.ctx.plan.showPreview(null);
    this.ctx.showGuides([]);
  }
}
