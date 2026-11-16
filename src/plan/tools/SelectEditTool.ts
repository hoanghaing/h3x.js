import {
  GEOM_TOL,
  dropNode,
  moveColumn,
  moveNode,
  moveWall,
  pushPullWall,
  removeColumn,
  removeNode,
  removeWall,
  setSite,
  splitWall,
  type Command,
  type Id,
  type Issue,
  type Vec2,
} from '../../core';
import { add, dot, leftNormal, scale, sub } from '../../core/geometry/vec';
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
  shift: boolean;
  moved: boolean;
  /** The gesture was ended (Esc, interruption): ignore the rest of this press. */
  dead: boolean;
}

/** Where a dragged node would be dropped on release (join on drop). */
type Drop = { node: Id; at: Vec2 } | { wall: Id; at: Vec2 };

interface Gesture {
  key: string;
  /** 'push' is a Shift + wall drag (push / pull). */
  kind: 'node' | 'wall' | 'push' | 'column';
  id: Id;
  /** Wall drags: unit left normal at gesture start. */
  normal: Vec2;
  /** Wall drags: node a's position; column drags: the column's center; both at gesture start. */
  start: Vec2;
  /** Push / pull: the distance currently applied in the open coalesce group. */
  applied: number;
  /** Node drags: the join target the pointer is snapped onto, if any. */
  drop: Drop | null;
}

const ARROWS: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

type Selectable = 'node' | 'wall' | 'column' | 'site';
const SELECTABLE: ReadonlySet<string> = new Set<Selectable>(['node', 'wall', 'column', 'site']);
const selectable = (kind: string): kind is Selectable => SELECTABLE.has(kind);

/**
 * Selects nodes, walls, columns and the site; drags nodes, walls and columns (one undo step per
 * drag), nudges with arrow keys. Shift + wall drag pushes / pulls the wall, a node dropped onto
 * another node or a wall joins it, double-click on a wall inserts a point, Delete / Backspace
 * removes the selection.
 */
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
    this.press = {
      target: e.hit,
      screen: e.screen,
      plan: e.plan,
      shift: (e.native as MouseEvent).shiftKey,
      moved: false,
      dead: false,
    };
    const kind = e.hit?.kind;
    return kind === 'node' || kind === 'wall' || kind === 'column' || kind === 'dimension';
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
      this.finishGesture();
      return;
    }
    if (press.moved) return;
    const t = press.target;
    if (t && selectable(t.kind)) this.ctx.plan.select({ kind: t.kind, id: t.id });
    else if (t?.kind !== 'dimension') this.ctx.plan.select(null);
  }

  onDoubleClick(e: PlanPointerEvent): void {
    const ctx = this.ctx;
    if (!ctx || this.gesture) return;
    if (e.hit?.kind === 'dimension') {
      ctx.plan.emitLengthEditRequest(e.hit.id, e.plan);
    } else if (e.hit?.kind === 'wall') {
      // Insert point; the wall projects the point onto its center line.
      const cmd = splitWall(e.hit.id, e.plan);
      if (this.run(cmd)) ctx.plan.select({ kind: 'node', id: cmd.createdId });
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
    const sel = ctx.plan.selection;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.gesture || !sel) return false;
      const cmd =
        sel.kind === 'node'
          ? removeNode(sel.id)
          : sel.kind === 'wall'
            ? removeWall(sel.id)
            : sel.kind === 'column'
              ? removeColumn(sel.id)
              : sel.kind === 'site'
                ? setSite(null)
                : null;
      if (!cmd) return false;
      if (this.run(cmd)) ctx.plan.select(null);
      return true;
    }
    const dir = ARROWS[e.key];
    if (!dir || this.gesture || e.altKey || e.ctrlKey || e.metaKey) return false;
    const d = scale(dir, e.shiftKey ? this.nudgeLarge : this.nudge);
    let cmd: Command;
    if (sel?.kind === 'wall') {
      cmd = moveWall(sel.id, d);
    } else if (sel?.kind === 'node') {
      const n = ctx.doc.floor.nodes[sel.id];
      if (!n) return false;
      cmd = moveNode(sel.id, add(n, d));
    } else if (sel?.kind === 'column') {
      const c = ctx.doc.floor.columns[sel.id];
      if (!c) return false;
      cmd = moveColumn(sel.id, add(c, d));
    } else {
      return false;
    }
    this.run(cmd);
    return true;
  }

  private startGesture(press: Press): void {
    const ctx = this.ctx!;
    const t = press.target;
    const floor = ctx.doc.floor;
    let kind: Gesture['kind'];
    let normal: Vec2 = { x: 0, y: 0 };
    let start: Vec2 = { x: 0, y: 0 };
    if (t?.kind === 'wall') {
      const w = floor.walls[t.id];
      const a = w && floor.nodes[w.a];
      const b = w && floor.nodes[w.b];
      if (!a || !b) return;
      kind = press.shift ? 'push' : 'wall';
      normal = leftNormal(sub(b, a));
      start = { x: a.x, y: a.y };
    } else if (t?.kind === 'column') {
      const c = floor.columns[t.id];
      if (!c) return;
      kind = 'column';
      start = { x: c.x, y: c.y };
    } else if (t?.kind === 'node') {
      if (!floor.nodes[t.id]) return;
      kind = 'node';
    } else {
      return;
    }
    this.gesture = {
      key: `plan-drag-${++this.gestureCount}`,
      kind,
      id: t.id,
      normal,
      start,
      applied: 0,
      drop: null,
    };
    ctx.plan.select({ kind: t.kind, id: t.id });
    if (kind === 'node') ctx.setDragging(t.id);
  }

  private step(e: PlanPointerEvent): void {
    const g = this.gesture!;
    const free = (e.native as MouseEvent).altKey;
    if (g.kind === 'node') this.stepNode(g, e.plan, free);
    else if (g.kind === 'column') this.stepColumn(g, e.plan, free);
    else if (g.kind === 'push') this.stepPush(g, e.plan, free);
    else this.stepWall(g, e.plan, free);
  }

  /**
   * Snaps onto other nodes and walls (not the node itself or its walls). On a join target the
   * node stays put and the target is marked; a neighbour (sharing a wall) is no join target,
   * since joining it would collapse that wall, so the move there is tried (and rejected).
   */
  private stepNode(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const r = ctx.snapDraw(p, undefined, free, undefined, { exclude: [g.id] });
    const t = r.target;
    let drop: Drop | null = null;
    if (t.kind === 'wall') drop = { wall: t.id, at: r.point };
    else if (t.kind === 'node' && !this.neighbours(g.id, t.id)) drop = { node: t.id, at: r.point };
    g.drop = drop;
    ctx.plan.showDropTarget(drop ? drop.at : null);
    if (drop) {
      ctx.showGuides(r.guides);
      this.clearRejection();
      return;
    }
    ctx.showGuides(this.run(moveNode(g.id, r.point), g.key) ? r.guides : []);
  }

  private stepColumn(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const c = ctx.doc.floor.columns[g.id];
    if (!c) return;
    const r = ctx.snapDraw(add(g.start, sub(p, this.press!.plan)), undefined, free);
    const same = r.point.x === c.x && r.point.y === c.y;
    const ok = same || this.run(moveColumn(g.id, { x: r.point.x, y: r.point.y }), g.key);
    ctx.showGuides(ok ? r.guides : []);
  }

  private stepWall(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const floor = ctx.doc.floor;
    const a = floor.nodes[floor.walls[g.id]?.a ?? ''];
    if (!a) return;
    const wanted = this.wantedOffset(g, p, free);
    // Against the wall's current offset (moveWall is relative), so errors do not accumulate.
    const delta = wanted - dot(sub(a, g.start), g.normal);
    if (delta !== 0) this.run(moveWall(g.id, scale(g.normal, delta)), g.key);
  }

  /**
   * Push / pull is relative and may add connector walls, so each step reverts the open group
   * and re-runs `pushPullWall` with the total distance against the original geometry: one undo
   * step, and Esc (`cancelCoalesce`) restores the start. A step that fails is undone back to
   * the last good distance; `wall-too-short` (a connector below the minimum) is not flashed.
   */
  private stepPush(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const wanted = this.wantedOffset(g, p, free);
    if (wanted === g.applied) return;
    const exec = (d: number) =>
      this.issue(() => {
        ctx.doc.cancelCoalesce(g.key);
        return d === 0
          ? ({ ok: true } as const)
          : ctx.doc.tryExecute(pushPullWall(g.id, d), { coalesceKey: g.key });
      });
    const res = exec(wanted);
    if (res.ok) {
      g.applied = wanted;
      this.clearRejection();
      return;
    }
    if (g.applied !== 0) exec(g.applied);
    this.reject(res.issues.filter((i) => i.code !== 'wall-too-short'));
  }

  /** Signed pointer travel along the wall's original left normal; grid-snapped unless `free`. */
  private wantedOffset(g: Gesture, p: Vec2, free: boolean): number {
    const d = dot(sub(p, this.press!.plan), g.normal);
    return free ? d : snapScalar(d, this.ctx!.plan.snapOptions.grid);
  }

  /** Ends a released drag: a node over a join target is dropped there in the same undo step. */
  private finishGesture(): void {
    const ctx = this.ctx!;
    const g = this.gesture!;
    if (g.kind === 'node' && g.drop) {
      const target =
        'node' in g.drop ? { node: g.drop.node } : { wall: g.drop.wall, at: g.drop.at };
      if (this.run(dropNode(g.id, target), g.key)) {
        const at = g.drop.at;
        const kept = Object.values(ctx.doc.floor.nodes).find(
          (n) => Math.hypot(n.x - at.x, n.y - at.y) < GEOM_TOL,
        );
        ctx.plan.select(kept ? { kind: 'node', id: kept.id } : null);
      }
    }
    this.endGesture(true);
  }

  private neighbours(a: Id, b: Id): boolean {
    return Object.values(this.ctx!.doc.floor.walls).some(
      (w) => (w.a === a && w.b === b) || (w.a === b && w.b === a),
    );
  }

  /** Runs one of the tool's own commands; flashes a rejection, clears it after a success. */
  private run(cmd: Command, coalesceKey?: string): boolean {
    const ctx = this.ctx!;
    const res = this.issue(() => ctx.doc.tryExecute(cmd, { coalesceKey }));
    if (!res.ok) {
      this.reject(res.issues);
      return false;
    }
    this.clearRejection();
    return true;
  }

  /** Flashes `issues`; an empty list only clears an earlier flash. */
  private reject(issues: Issue[]): void {
    if (issues.length === 0) {
      this.clearRejection();
      return;
    }
    this.rejecting = true;
    this.ctx!.plan.reportRejected(issues);
  }

  private clearRejection(): void {
    if (!this.rejecting) return;
    this.rejecting = false;
    this.ctx!.plan.reportRejected([]);
  }

  /** Ends the gesture in progress; `seal` closes its coalesce group (it is still open). */
  private endGesture(seal: boolean): void {
    const ctx = this.ctx;
    if (!this.gesture || !ctx) return;
    this.gesture = null;
    if (this.press) this.press.dead = true;
    if (seal) ctx.doc.endCoalesce();
    ctx.showGuides([]);
    ctx.plan.showDropTarget(null);
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
