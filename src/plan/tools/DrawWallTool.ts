import {
  addWall,
  moveNode,
  sequence,
  type ChangeEvent,
  type Command,
  type Id,
  type Vec2,
  type WallEnd,
} from '../../core';
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
  /**
   * The line the clicks draw: the wall's centre line (default), or its left / right face
   * (left / right of the drawing direction), the wall body lying on the other side.
   */
  reference?: WallReference;
}

export type WallReference = 'center' | 'left' | 'right';

/** Where offset lines a (through a0 along da) and b (through b0 along db) meet; b0 when parallel. */
function meet(a0: Vec2, da: Vec2, b0: Vec2, db: Vec2): Vec2 {
  const den = da.x * db.y - da.y * db.x;
  if (Math.abs(den) < 1e-9) return b0;
  const t = ((b0.x - a0.x) * db.y - (b0.y - a0.y) * db.x) / den;
  return tidyPt(add(a0, scale(da, t)));
}

const tidyPt = (p: Vec2): Vec2 => ({
  x: Math.round(p.x * 1e9) / 1e9,
  y: Math.round(p.y * 1e9) / 1e9,
});

/** One of the tool's own document calls; a commit collects what its change event created. */
type OwnCall = { kind: 'commit'; created: Set<Id>; changed: boolean } | { kind: 'undo' };

/**
 * Draws chains of walls: the first click sets the start point, every further click commits one
 * wall (`addWall`, one undo step) and continues from its end. Clicking the chain's start node or
 * an existing node / wall ends the chain; so do double-click and Enter. Esc drops the preview and
 * ends the chain (committed walls stay). Backspace undoes the chain's last click while the
 * newest history entry is that click. Alt disables snapping; Shift keeps the segment horizontal
 * or vertical.
 *
 * Whenever a new segment starts, the plan fires `segmentLengthRequest` (length 0, direction of
 * the last preview or zero) so a host can offer a length input; the live length is in the
 * preview label, and `plan.setPendingSegmentLength(len)` commits the segment.
 */
export class DrawWallTool implements Tool {
  private readonly thickness: number;
  private readonly height: number | undefined;
  private reference: WallReference;
  /** Face mode: the clicked face points of the chain (the chain's own points are wall nodes). */
  private faces: Vec2[] = [];
  private ctx: ToolContext | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly chain = new ClickChain();
  /**
   * Unit direction of the current preview segment (kept after a commit so typed lengths chain),
   * or null before the pointer moved in this chain.
   */
  private dir: Vec2 | null = null;
  /** Set while the tool's own document calls run. */
  private own: OwnCall | null = null;
  private rejecting = false;

  constructor(opts: DrawWallToolOptions = {}) {
    this.thickness = opts.thickness ?? 0.2;
    this.height = opts.height;
    this.reference = opts.reference ?? 'center';
  }

  /** The line the clicks draw (see `DrawWallToolOptions.reference`); ends the current chain. */
  setOptions(opts: { reference?: WallReference }): void {
    if (opts.reference && opts.reference !== this.reference) {
      this.endChain();
      this.reference = opts.reference;
    }
  }

  get options(): { reference: WallReference } {
    return { reference: this.reference };
  }

  private get faceMode(): boolean {
    return this.reference !== 'center';
  }

  /** The wall centre line offset for a face segment from p to q (half the thickness, to the wall's side). */
  private offset(p: Vec2, q: Vec2): Vec2 {
    const d = normalize(sub(q, p));
    // Right of the drawing direction is (d.y, -d.x): a left face has the wall on its right.
    const right = { x: d.y, y: -d.x };
    return scale(right, (this.reference === 'left' ? 1 : -1) * (this.thickness / 2));
  }

  /** The point drawn from: the last face point in face mode, else the last node. */
  private get anchor(): Vec2 | undefined {
    return this.faceMode ? this.faces[this.faces.length - 1] : this.chain.last?.at;
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
    ctx.showGuides(r.guides, r.marks);
    const from = this.anchor;
    if (!this.chain.last || !from) return;
    const len = distance(from, r.point);
    if (len > GEOM_TOL) this.dir = normalize(sub(r.point, from));
    const segments: Array<[Vec2, Vec2]> = [[from, r.point]];
    if (this.faceMode && len > GEOM_TOL) {
      // The face being drawn, and the centre line the wall will get.
      const o = this.offset(from, r.point);
      segments.push([add(from, o), add(r.point, o)]);
    }
    ctx.plan.showPreview(segments, {
      at: scale(add(from, r.point), 0.5),
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
      if (this.faceMode) this.faces.pop();
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
  setPendingSegmentLength(length: number, angle?: number): boolean {
    const last = this.anchor;
    if (!this.ctx || !last) return false;
    if (!(Number.isFinite(length) && length > 0)) return false;
    if (angle !== undefined) {
      if (!Number.isFinite(angle)) return false;
      const rad = (angle * Math.PI) / 180;
      this.dir = { x: Math.cos(rad), y: Math.sin(rad) };
    }
    if (!this.dir) return false;
    const to = add(last, scale(this.dir, length));
    return this.commit(
      { x: Math.round(to.x * 1e9) / 1e9, y: Math.round(to.y * 1e9) / 1e9 },
      { kind: 'free' },
    );
  }

  /** Alt: no snapping; Shift: horizontal / vertical from the last point. */
  private snap(e: PlanPointerEvent) {
    const m = e.native as MouseEvent;
    // Face points never join nodes or walls (a face is not a centre line); the chain's first face
    // point is an alignment point, so the outline can be closed on it.
    return this.ctx!.snapDraw(e.plan, this.anchor, m.altKey, this.faces.slice(0, 1), {
      ortho: m.shiftKey,
      ...(this.faceMode ? { structure: false } : {}),
    });
  }

  private click(point: Vec2, target: DrawSnapTarget): void {
    const last = this.chain.last;
    if (this.faceMode) target = { kind: 'free' };
    if (!last) {
      if (this.faceMode) this.faces = [point];
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
    if (distance(point, this.anchor!) < GEOM_TOL) return;
    this.commit(point, target);
  }

  /**
   * Face mode: the wall for the face segment from the last face point to `point`. The first one
   * is offset by half the thickness; later ones first move the shared node onto the meeting point
   * of the two offset lines. Closing on the first face point (three or more points) also moves
   * the start node and joins it. One command, one undo step.
   */
  private faceCommand(point: Vec2): {
    cmd: Command;
    add: ReturnType<typeof addWall>;
    closes: boolean;
  } {
    const ctx = this.ctx!;
    const faces = this.faces;
    const last = this.chain.last!;
    const start = this.chain.points[0]!;
    const p = faces[faces.length - 1]!;
    const reach = 8 / ctx.plan.view.scale;
    const closes = faces.length >= 3 && distance(point, faces[0]!) <= reach;
    const q = closes ? faces[0]! : point;
    const o = this.offset(p, q);
    const wall = {
      thickness: this.thickness,
      ...(this.height !== undefined ? { height: this.height } : {}),
    };
    if (faces.length === 1) {
      const add1 = addWall({ from: { at: add(p, o) }, to: { at: add(q, o) }, ...wall });
      return { cmd: add1, add: add1, closes: false };
    }
    const prev = faces[faces.length - 2]!;
    const po = this.offset(prev, p);
    const corner = meet(add(prev, po), sub(p, prev), add(p, o), sub(q, p));
    const steps: Array<() => Command> = [() => moveNode(last.node!, corner)];
    let addCmd: ReturnType<typeof addWall>;
    if (closes && start.node) {
      const f1 = faces[1]!;
      const so = this.offset(faces[0]!, f1);
      const startCorner = meet(add(p, o), sub(q, p), add(faces[0]!, so), sub(f1, faces[0]!));
      steps.push(() => moveNode(start.node!, startCorner));
      addCmd = addWall({ from: { node: last.node! }, to: { node: start.node }, ...wall });
    } else {
      addCmd = addWall({ from: { node: last.node! }, to: { at: add(q, o) }, ...wall });
    }
    steps.push(() => addCmd);
    return { cmd: sequence('drawWall', steps), add: addCmd, closes };
  }

  /** Adds the wall from the chain's last point to `point`; returns whether it was committed. */
  private commit(point: Vec2, target: DrawSnapTarget): boolean {
    const ctx = this.ctx!;
    const last = this.chain.last!;
    const start = this.chain.points[0]!;
    let ends =
      (target.kind === 'node' && target.id === start.node) ||
      ((target.kind === 'node' || target.kind === 'wall') && !last.created.has(target.id));
    let run: Command;
    let cmd: ReturnType<typeof addWall>;
    if (this.faceMode) {
      const f = this.faceCommand(point);
      run = f.cmd;
      cmd = f.add;
      ends = f.closes;
    } else {
      cmd = addWall({
        from: last.node ? { node: last.node } : { at: last.at },
        to: target.kind === 'node' ? { node: target.id } : { at: point },
        thickness: this.thickness,
        ...(this.height !== undefined ? { height: this.height } : {}),
      });
      run = cmd;
    }
    const before = this.chain.historyState;
    const own = { kind: 'commit' as const, created: new Set<Id>(), changed: false };
    const res = this.issue(own, () => ctx.doc.tryExecute(run));
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
    if (this.faceMode) this.faces.push(point);
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
      // Keep `dir`: a second typed length continues the same way until the pointer moves.
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
      from: { ...this.anchor! },
      direction: this.dir ? { ...this.dir } : { x: 0, y: 0 },
      length: 0,
    });
  }

  private endChain(): void {
    this.chain.reset();
    this.faces = [];
    this.dir = null;
    if (!this.ctx) return;
    this.ctx.plan.showPreview(null);
    this.ctx.showGuides([]);
  }
}
