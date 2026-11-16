import { moveNode, moveWall, type Command, type Id, type Vec2 } from '../../core';
import { dot, leftNormal, scale, sub } from '../../core/geometry/vec';
import type { HitTarget } from '../hit';
import { snapScalar } from '../snap';
import type { ScreenPoint } from '../types';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';

export interface SelectEditToolOptions {
  /** Screen distance (px) a press must travel before it becomes a drag. Default 4. */
  dragThresholdPx?: number;
  /** Arrow-key step in meters. Default 0.01. */
  nudge?: number;
  /** Shift + arrow-key step in meters. Default 0.1. */
  nudgeLarge?: number;
}

interface Press {
  target: HitTarget;
  screen: ScreenPoint;
  plan: Vec2;
  moved: boolean;
  /** The gesture was ended (Esc, interruption): ignore the rest of this press. */
  dead: boolean;
}

interface Gesture {
  key: string;
  kind: 'node' | 'wall';
  id: Id;
  /** Wall drags: unit normal and node a's position at gesture start. */
  normal: Vec2;
  startA: Vec2;
}

const ARROWS: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

/** Selects nodes and walls, drags them (one undo step per drag), nudges with arrow keys. */
export class SelectEditTool implements Tool {
  private readonly threshold: number;
  private readonly nudge: number;
  private readonly nudgeLarge: number;
  private ctx: ToolContext | null = null;
  private unsubscribe: (() => void) | null = null;
  private press: Press | null = null;
  private gesture: Gesture | null = null;
  private gestureCount = 0;
  /** True while the tool's own document calls run, so their change events are not interruptions. */
  private issuing = false;
  /** The tool's last drag step or nudge was rejected and is still flashed. */
  private rejecting = false;

  constructor(opts: SelectEditToolOptions = {}) {
    this.threshold = opts.dragThresholdPx ?? 4;
    this.nudge = opts.nudge ?? 0.01;
    this.nudgeLarge = opts.nudgeLarge ?? 0.1;
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    // Known limitation: an external `doc.endCoalesce()` mid-drag emits no change event, so it
    // goes unnoticed; the drag's later steps then start a new undo step under the same key.
    this.unsubscribe = ctx.doc.on('change', () => {
      if (this.gesture && !this.issuing) this.endGesture(false);
    });
  }

  deactivate(): void {
    this.endGesture(true);
    this.press = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    this.press = null;
    if (!this.ctx || e.native.button !== 0) return false;
    this.press = { target: e.hit, screen: e.screen, plan: e.plan, moved: false, dead: false };
    const kind = e.hit?.kind;
    return kind === 'node' || kind === 'wall' || kind === 'dimension';
  }

  onPointerMove(e: PlanPointerEvent): void {
    const press = this.press;
    if (!this.ctx || !press || press.dead) return;
    if (!press.moved) {
      if (Math.hypot(e.screen.x - press.screen.x, e.screen.y - press.screen.y) <= this.threshold) {
        return;
      }
      press.moved = true;
      this.startGesture(press);
    }
    if (this.gesture) this.step(e);
  }

  onPointerUp(): void {
    const press = this.press;
    this.press = null;
    if (!this.ctx || !press || press.dead) return;
    if (this.gesture) {
      this.endGesture(true);
      return;
    }
    if (press.moved) return;
    const t = press.target;
    if (t?.kind === 'node' || t?.kind === 'wall') this.ctx.plan.select({ kind: t.kind, id: t.id });
    else if (t?.kind !== 'dimension') this.ctx.plan.select(null);
  }

  onDoubleClick(e: PlanPointerEvent): void {
    if (this.ctx && e.hit?.kind === 'dimension') {
      this.ctx.plan.emitLengthEditRequest(e.hit.id, e.plan);
    }
  }

  onKeyDown(e: KeyboardEvent): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if (e.key === 'Escape') {
      if (this.gesture) {
        const { key } = this.gesture;
        this.issue(() => ctx.doc.cancelCoalesce(key));
        this.endGesture(false);
        this.rejecting = false;
        ctx.plan.reportRejected([]);
        return true;
      }
      if (!ctx.plan.selection) return false;
      ctx.plan.select(null);
      return true;
    }
    const dir = ARROWS[e.key];
    const sel = ctx.plan.selection;
    if (!dir || this.gesture || e.altKey || e.ctrlKey || e.metaKey) return false;
    if (sel?.kind !== 'node' && sel?.kind !== 'wall') return false;
    const d = scale(dir, e.shiftKey ? this.nudgeLarge : this.nudge);
    let cmd: Command;
    if (sel.kind === 'wall') {
      cmd = moveWall(sel.id, d);
    } else {
      const n = ctx.doc.floor.nodes[sel.id];
      if (!n) return false;
      cmd = moveNode(sel.id, { x: n.x + d.x, y: n.y + d.y });
    }
    this.run(cmd);
    return true;
  }

  private startGesture(press: Press): void {
    const ctx = this.ctx!;
    const t = press.target;
    if (t?.kind !== 'node' && t?.kind !== 'wall') return;
    let normal: Vec2 = { x: 0, y: 0 };
    let startA: Vec2 = { x: 0, y: 0 };
    if (t.kind === 'wall') {
      const w = ctx.doc.floor.walls[t.id];
      const a = w && ctx.doc.floor.nodes[w.a];
      const b = w && ctx.doc.floor.nodes[w.b];
      if (!a || !b) return;
      normal = leftNormal(sub(b, a));
      startA = { x: a.x, y: a.y };
    } else if (!ctx.doc.floor.nodes[t.id]) {
      return;
    }
    this.gesture = {
      key: `plan-drag-${++this.gestureCount}`,
      kind: t.kind,
      id: t.id,
      normal,
      startA,
    };
    ctx.plan.select({ kind: t.kind, id: t.id });
    if (t.kind === 'node') ctx.setDragging(t.id);
  }

  private step(e: PlanPointerEvent): void {
    const ctx = this.ctx!;
    const g = this.gesture!;
    const free = (e.native as MouseEvent).altKey;
    if (g.kind === 'node') {
      const r = ctx.snap(e.plan, [g.id], free);
      ctx.showGuides(this.run(moveNode(g.id, r.point), g.key) ? r.guides : []);
      return;
    }
    const floor = ctx.doc.floor;
    const a = floor.nodes[floor.walls[g.id]?.a ?? ''];
    if (!a) return;
    let wanted = dot(sub(e.plan, this.press!.plan), g.normal);
    if (!free) wanted = snapScalar(wanted, ctx.plan.snapOptions.grid);
    // Against the wall's current offset (moveWall is relative), so errors do not accumulate.
    const delta = wanted - dot(sub(a, g.startA), g.normal);
    if (delta !== 0) this.run(moveWall(g.id, scale(g.normal, delta)), g.key);
  }

  /** Runs one of the tool's own commands; flashes a rejection, clears it after a success. */
  private run(cmd: Command, coalesceKey?: string): boolean {
    const ctx = this.ctx!;
    const res = this.issue(() => ctx.doc.tryExecute(cmd, { coalesceKey }));
    if (!res.ok) {
      this.rejecting = true;
      ctx.plan.reportRejected(res.issues);
      return false;
    }
    if (this.rejecting) {
      this.rejecting = false;
      ctx.plan.reportRejected([]);
    }
    return true;
  }

  /** Ends the gesture in progress; `seal` closes its coalesce group (it is still open). */
  private endGesture(seal: boolean): void {
    const ctx = this.ctx;
    if (!this.gesture || !ctx) return;
    this.gesture = null;
    if (this.press) this.press.dead = true;
    if (seal) ctx.doc.endCoalesce();
    ctx.showGuides([]);
    ctx.setDragging(null);
  }

  private issue<T>(fn: () => T): T {
    this.issuing = true;
    try {
      return fn();
    } finally {
      this.issuing = false;
    }
  }
}
