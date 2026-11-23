import {
  GEOM_TOL,
  dropNode,
  moveColumn,
  moveNode,
  moveWall,
  nextOrientation,
  openingSpan,
  pushPullWall,
  resizeOpening,
  splitWall,
  stairOutline,
  transformObjects,
  updateOpening,
  updateStair,
  type Command,
  type Hinge,
  type Id,
  type Issue,
  type ObjectSet,
  type Opening,
  type PlacementGuide,
  type Roof,
  type RoofEdge,
  type Stair,
  type Vec2,
} from '../../core';
import { add, dot, leftNormal, scale, sub, tidy } from '../../core/geometry/vec';
import type { HitTarget } from '../hit';
import {
  ROOF_EDGE_PX,
  ROOF_HANDLE_PX,
  detachAndMoveVertex,
  moveRoofVertex,
  nearestHandle,
  roofEdgeAt,
  roofHandles,
  translateRoof,
  type RoofEdgeRef,
  type RoofVertexRef,
} from '../roofEdit';
import { nearestFaceVertex, snapScalar, type SnapGuide } from '../snap';
import type { ScreenPoint } from '../types';
import {
  alongWall,
  invalidGhost,
  nudgeSign,
  openingMoveTarget,
  openingResizeWidth,
} from './openingEdit';
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
  /** Shift, Ctrl or Meta was held: a click adds / removes the target from the selection. */
  toggle: boolean;
  /** Shift + press on empty space: a drag draws a selection box. */
  box: boolean;
  moved: boolean;
  /** The press grabbed a vertex handle of the selected roof. */
  roofVertex?: RoofVertexRef;
  /** The press is near an edge of the selected roof (a click on it asks the host to edit it). */
  roofEdge?: { ref: RoofEdgeRef; current: RoofEdge };
  /** The gesture was ended (Esc, interruption): ignore the rest of this press. */
  dead: boolean;
}

/** Where a dragged node would be dropped on release (join on drop). */
type Drop = { node: Id; at: Vec2 } | { wall: Id; at: Vec2 };

interface Gesture {
  key: string;
  /** 'push' is a Shift + wall drag (push / pull). */
  kind:
    | 'node'
    | 'wall'
    | 'push'
    | 'column'
    | 'stair'
    | 'roof'
    | 'roofVertex'
    | 'opening'
    | 'openingResize'
    | 'group'
    | 'box';
  id: Id;
  /** Wall drags: unit left normal at gesture start. */
  normal: Vec2;
  /** Wall drags: node a's position; column drags: the column's center; both at gesture start. */
  start: Vec2;
  /** Push / pull: the distance currently applied in the open coalesce group. */
  applied: number;
  /** Node drags: the join target the pointer is snapped onto, if any. */
  drop: Drop | null;
  /** Roof drags: the roof at gesture start; vertex drags: the grabbed vertex. */
  roof?: Roof;
  vertex?: RoofVertexRef;
  /** Roof drags: the translation currently applied. */
  shift?: Vec2;
  /** Opening drags: the opening at gesture start. */
  opening?: Opening;
  /**
   * Opening drags: the pointer minus the centre (moves) or minus the dragged jamb (resizes),
   * along the wall, at the press.
   */
  grab?: number;
  /** Opening resizes: the jamb being dragged. */
  end?: Hinge;
  /** Opening moves: the host of the last step, kept against nearby walls. */
  host?: Id;
  /** Group drags: the selection being moved. */
  objects?: ObjectSet;
}

const SNAP_RADIUS_PX = 8;
/** Clicks closer than this on one distance label are one double click. */
const DOUBLE_CLICK_MS = 500;

const ARROWS: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

type Selectable = 'node' | 'wall' | 'column' | 'stair' | 'roof' | 'site' | 'opening' | 'item';
/** |normal component| above which a wall counts as moving along that axis (push / pull guides). */
const AXIS_PARALLEL = 1 - 1e-9;

const SELECTABLE: ReadonlySet<string> = new Set<Selectable>([
  'node',
  'wall',
  'column',
  'stair',
  'roof',
  'site',
  'opening',
  'item',
]);
const selectable = (kind: string): kind is Selectable => SELECTABLE.has(kind);

/**
 * Selects nodes, walls, columns, stairs, roofs, openings, items and the site; drags nodes, walls, columns, stairs
 * and independent roofs (one undo step per drag; a vertex handle of a selected roof moves that
 * vertex, detaching a follow roof first; a click on an edge of the selected roof asks the host to
 * edit it), nudges with arrow keys. Openings are dragged along and between walls (an invalid
 * spot keeps the last valid one and shows a red ghost), resized by their jamb handles, nudged
 * along their wall by the arrows and turned with Space; a click on a clear distance or a
 * double-click on an opening asks the host to edit it. Shift + wall drag pushes / pulls the
 * wall, a node dropped onto another node or a wall joins it, double-click on a wall inserts a
 * point, Delete / Backspace removes the selection. Node and wall drags compute each step from the start of the drag, so
 * dragging back puts openings back too.
 */
export class SelectEditTool implements Tool {
  private readonly threshold: number;
  private readonly nudge: number;
  private readonly nudgeLarge: number;
  private ctx: ToolContext | null = null;
  private unsubscribe: (() => void) | null = null;
  private press: Press | null = null;
  private lastDistanceAsk: { id: Id; end: Hinge; at: number } | null = null;
  private gesture: Gesture | null = null;
  private gestureCount = 0;
  /** True while the tool's own document calls run, so their change events are not interruptions. */
  private issuing = false;
  /** The tool's last drag step or nudge was rejected and is still flashed. */
  private rejecting = false;
  /** The pointer's last plan position over the plan (where Ctrl + V pastes). */
  private pointer: Vec2 | null = null;

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
    this.pointer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ctx = null;
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    this.press = null;
    if (!this.ctx || e.native.button !== 0) return false;
    const m = e.native as MouseEvent;
    this.press = {
      target: e.hit,
      screen: e.screen,
      plan: e.plan,
      shift: m.shiftKey,
      toggle: m.shiftKey || m.ctrlKey || m.metaKey,
      box: false,
      moved: false,
      dead: false,
    };
    this.grabRoofHandle(e);
    if (this.press.roofVertex || this.press.roofEdge) return true;
    const kind = e.hit?.kind;
    if (!kind && m.shiftKey) {
      this.press.box = true;
      return true;
    }
    return (
      kind === 'openingHandle' ||
      kind === 'openingDistance' ||
      kind === 'roof' ||
      kind === 'node' ||
      kind === 'wall' ||
      kind === 'column' ||
      kind === 'stair' ||
      kind === 'opening' ||
      kind === 'item' ||
      kind === 'dimension'
    );
  }

  onPointerMove(e: PlanPointerEvent): void {
    this.pointer = e.plan;
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
    if (press.roofEdge) {
      this.askRoofEdge(press.roofEdge, press.screen);
      return;
    }
    if (press.roofVertex) return;
    const t = press.target;
    if (t?.kind === 'openingDistance') {
      // The second click of a double click on the same label asks nothing new.
      const now = performance.now();
      const last = this.lastDistanceAsk;
      if (!last || last.id !== t.id || last.end !== t.end || now - last.at > DOUBLE_CLICK_MS) {
        this.ctx.plan.emitOpeningDistanceRequest(t.id, t.end);
      }
      this.lastDistanceAsk = { id: t.id, end: t.end, at: now };
      return;
    }
    const plan = this.ctx.plan;
    const pick = (sel: { kind: Selectable; id: Id }): void =>
      press.toggle ? plan.toggleSelection(sel) : plan.select(sel);
    if (t?.kind === 'openingHandle') pick({ kind: 'opening', id: t.id });
    else if (t && selectable(t.kind)) pick({ kind: t.kind, id: t.id });
    else if (t?.kind !== 'dimension' && !press.toggle) plan.select(null);
  }

  onDoubleClick(e: PlanPointerEvent): void {
    const ctx = this.ctx;
    if (!ctx || this.gesture) return;
    if (e.hit?.kind === 'dimension') {
      ctx.plan.emitLengthEditRequest(e.hit.id, e.plan);
    } else if (e.hit?.kind === 'opening' || e.hit?.kind === 'openingHandle') {
      ctx.plan.emitOpeningEditRequest(e.hit.id, e.screen);
    } else if (e.hit?.kind === 'wall') {
      // Insert point; the wall projects the point onto its center line.
      const cmd = splitWall(e.hit.id, e.plan);
      if (this.run(cmd)) ctx.plan.select({ kind: 'node', id: cmd.createdId });
    }
  }

  onKeyDown(e: KeyboardEvent): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !this.gesture) {
      const k = e.key.toLowerCase();
      if (k === 'c') return ctx.plan.copySelection() !== null;
      if (k === 'v' && ctx.plan.clipboard) {
        // Ctrl + V: centred on the pointer; Ctrl + Shift + V: in place (e.g. on another floor).
        ctx.plan.paste(e.shiftKey ? undefined : (this.pointer ?? undefined));
        return true;
      }
      if (k === 'd' && ctx.plan.selectionSet.length > 0) {
        ctx.plan.duplicateSelection();
        return true;
      }
    }
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
    if (e.key === ' ') {
      const o = sel?.kind === 'opening' ? ctx.doc.floor.openings[sel.id] : undefined;
      const next = o && nextOrientation(o);
      if (this.gesture || !o || !next || e.altKey || e.ctrlKey || e.metaKey) return false;
      // A held key turns it once, not at the key-repeat rate.
      if (!e.repeat) this.run(updateOpening(o.id, next));
      return true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.gesture || !sel || !selectable(sel.kind) || e.altKey || e.ctrlKey || e.metaKey) {
        return false;
      }
      ctx.plan.deleteSelection();
      return true;
    }
    const dir = ARROWS[e.key];
    if (!dir || this.gesture || e.altKey || e.ctrlKey || e.metaKey) return false;
    const d = scale(dir, e.shiftKey ? this.nudgeLarge : this.nudge);
    let cmd: Command;
    if (ctx.plan.selectionSet.length > 1) {
      cmd = transformObjects(ctx.plan.selectionObjects(), { kind: 'translate', delta: d });
    } else if (sel?.kind === 'wall') {
      cmd = moveWall(sel.id, d);
    } else if (sel?.kind === 'node') {
      const n = ctx.doc.floor.nodes[sel.id];
      if (!n) return false;
      cmd = moveNode(sel.id, add(n, d));
    } else if (sel?.kind === 'column') {
      const c = ctx.doc.floor.columns[sel.id];
      if (!c) return false;
      cmd = moveColumn(sel.id, add(c, d));
    } else if (sel?.kind === 'stair') {
      const st = ctx.doc.floor.stairs[sel.id];
      if (!st) return false;
      cmd = updateStair(sel.id, { x: st.x + d.x, y: st.y + d.y });
    } else if (sel?.kind === 'opening') {
      // Along the wall only: the arrow's direction picks the way, its step the distance.
      const o = ctx.doc.floor.openings[sel.id];
      const sign = o ? nudgeSign(ctx.doc.floor, o, dir) : 0;
      if (!o || sign === 0) return false;
      cmd = updateOpening(o.id, { offset: tidy(o.offset + sign * Math.hypot(d.x, d.y)) });
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
    let roof: Roof | undefined;
    let vertex: RoofVertexRef | undefined;
    let opening: Pick<Gesture, 'opening' | 'grab' | 'end'> | undefined;
    const sel = ctx.plan.selection;
    const set = ctx.plan.selectionSet;
    const inSet = !!t && set.some((s) => s.kind === t.kind && s.id === t.id);
    if (press.box) {
      this.gesture = { ...this.blankGesture('box', ''), start: press.plan };
      return;
    }
    if (inSet && set.length > 1 && !press.shift && !press.roofVertex) {
      this.gesture = { ...this.blankGesture('group', ''), objects: ctx.plan.selectionObjects() };
      return;
    }
    if (t?.kind === 'opening' || t?.kind === 'openingHandle') {
      const o = floor.openings[t.id];
      const x = o ? alongWall(floor, o, press.plan) : NaN;
      if (!o || !Number.isFinite(x)) return;
      const { lo, hi } = openingSpan(o);
      if (!('end' in t)) {
        kind = 'opening';
        opening = { opening: structuredClone(o), grab: x - o.offset };
      } else {
        kind = 'openingResize';
        opening = {
          opening: structuredClone(o),
          grab: x - (t.end === 'a' ? lo : hi),
          end: t.end,
        };
      }
    } else if (press.roofVertex && sel?.kind === 'roof') {
      roof = floor.roofs[sel.id];
      if (!roof) return;
      kind = 'roofVertex';
      vertex = press.roofVertex;
    } else if (t?.kind === 'roof') {
      // A follow roof cannot be moved as a whole.
      roof = floor.roofs[t.id];
      if (!roof || roof.follow || !roof.points) return;
      kind = 'roof';
    } else if (t?.kind === 'wall') {
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
    } else if (t?.kind === 'stair') {
      const st = floor.stairs[t.id];
      if (!st) return;
      kind = 'stair';
      start = { x: st.x, y: st.y };
    } else if (t?.kind === 'node') {
      if (!floor.nodes[t.id]) return;
      kind = 'node';
    } else {
      return;
    }
    const id = roof ? roof.id : t!.id;
    this.gesture = {
      key: `plan-drag-${++this.gestureCount}`,
      kind,
      id,
      normal,
      start,
      applied: 0,
      drop: null,
      ...(roof ? { roof: structuredClone(roof), shift: { x: 0, y: 0 } } : {}),
      ...(vertex ? { vertex } : {}),
      ...opening,
    };
    const selKind = roof ? 'roof' : opening ? 'opening' : (t!.kind as Selectable);
    ctx.plan.select({ kind: selKind, id });
    if (kind === 'node') ctx.setDragging(id);
  }

  /** A gesture with no target entity (box, group). */
  private blankGesture(kind: 'box' | 'group', id: Id): Gesture {
    return {
      key: `plan-drag-${++this.gestureCount}`,
      kind,
      id,
      normal: { x: 0, y: 0 },
      start: { x: 0, y: 0 },
      applied: 0,
      drop: null,
    };
  }

  /** Draws the selection box: left to right takes what is inside, right to left what it touches. */
  private stepBox(g: Gesture, p: Vec2): void {
    const a = g.start;
    this.ctx!.showGhost({
      outline: [a, { x: p.x, y: a.y }, p, { x: a.x, y: p.y }],
    });
    g.shift = p;
  }

  /** Moves the whole selection by the pointer travel, snapped to the grid unless Alt is held. */
  private stepGroup(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const grid = ctx.plan.snapOptions.grid;
    const d = sub(p, this.press!.plan);
    const delta = free ? d : { x: snapScalar(d.x, grid), y: snapScalar(d.y, grid) };
    if (g.shift && g.shift.x === delta.x && g.shift.y === delta.y) return;
    if (this.run(transformObjects(g.objects!, { kind: 'translate', delta }), g.key, true)) {
      g.shift = delta;
    }
  }

  private step(e: PlanPointerEvent): void {
    const g = this.gesture!;
    const free = (e.native as MouseEvent).altKey;
    if (g.kind === 'box') this.stepBox(g, e.plan);
    else if (g.kind === 'group') this.stepGroup(g, e.plan, free);
    else if (g.kind === 'node') this.stepNode(g, e.plan, free);
    else if (g.kind === 'column') this.stepColumn(g, e.plan, free);
    else if (g.kind === 'stair') this.stepStair(g, e.plan, free);
    else if (g.kind === 'roofVertex') this.stepRoofVertex(g, e.plan, free);
    else if (g.kind === 'roof') this.stepRoof(g, e.plan, free);
    else if (g.kind === 'push') this.stepPush(g, e.plan, free);
    else if (g.kind === 'opening') this.stepOpening(g, e.plan, free);
    else if (g.kind === 'openingResize') this.stepOpeningResize(g, e.plan, free);
    else this.stepWall(g, e.plan, free);
  }

  /**
   * Moves the dragged opening where the placement module puts it (along its wall or onto
   * another). Each step runs from the start of the drag. An invalid spot (or no wall in reach)
   * leaves the document at the last valid one and shows a red ghost there instead.
   */
  private stepOpening(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const floor = ctx.doc.floor;
    const cur = floor.openings[g.id];
    if (!cur || !g.opening) return;
    const target = openingMoveTarget(floor, g.opening, g.grab ?? 0, p, {
      pxPerM: ctx.plan.view.scale,
      grid: ctx.plan.snapOptions.grid,
      free,
      ...(g.host !== undefined ? { current: g.host } : {}),
    });
    if (!target) {
      this.clearRejection();
      ctx.showGhost({ at: p, width: g.opening.width }, true);
      return;
    }
    const { opening, placement } = target;
    g.host = placement.wall;
    if (placement.issues.length > 0) {
      this.showInvalidOpening(opening, placement.issues, placement.guides);
      return;
    }
    const { wall, offset, hinge, swing } = opening;
    const same =
      cur.wall === wall && cur.offset === offset && cur.hinge === hinge && cur.swing === swing;
    if (same) this.showValidOpening(placement.guides);
    else
      this.stepOpeningCommand(
        g,
        updateOpening(g.id, { wall, offset, hinge, swing }),
        opening,
        placement.guides,
      );
  }

  /** Moves the dragged jamb of an opening; the other stays. Invalid widths show a red ghost. */
  private stepOpeningResize(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const floor = ctx.doc.floor;
    const cur = floor.openings[g.id];
    const start = g.opening;
    if (!cur || !start || !g.end) return;
    const x = alongWall(floor, start, p) - (g.grab ?? 0);
    if (!Number.isFinite(x)) return;
    const width = openingResizeWidth(floor, start, g.end, x, {
      pxPerM: ctx.plan.view.scale,
      free,
    });
    const { lo, hi } = openingSpan(start);
    const offset = tidy(g.end === 'a' ? hi - width / 2 : lo + width / 2);
    if (cur.width === width && cur.offset === offset) {
      this.showValidOpening([]);
      return;
    }
    const cmd = resizeOpening(g.id, { end: g.end, width });
    this.stepOpeningCommand(g, cmd, { ...start, width, offset }, []);
  }

  /** Runs an opening drag step from the start of the drag; on rejection shows `candidate` red. */
  private stepOpeningCommand(
    g: Gesture,
    cmd: Command,
    candidate: Opening,
    guides: readonly PlacementGuide[],
  ): void {
    const ctx = this.ctx!;
    const res = this.issue(() => ctx.doc.tryExecute(cmd, { coalesceKey: g.key, restart: true }));
    if (res.ok) this.showValidOpening(guides);
    else this.showInvalidOpening(candidate, res.issues, guides);
  }

  private showValidOpening(guides: readonly PlacementGuide[]): void {
    this.clearRejection();
    this.ctx!.showGhost(null, false, guides);
  }

  /** The red ghost of where an opening may not go, and why (flashed). */
  private showInvalidOpening(
    candidate: Opening,
    issues: Issue[],
    guides: readonly PlacementGuide[],
  ): void {
    const ctx = this.ctx!;
    ctx.showGhost(invalidGhost(ctx.doc.floor, candidate), true, guides);
    this.reject(issues);
  }

  /**
   * Snaps onto other nodes and walls (not the node itself or its walls). On a join target the
   * node stays put and the target is marked. A neighbour (sharing a wall) is a target too:
   * dropping onto it merges the two nodes and collapses their wall.
   */
  private stepNode(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const r = ctx.snapDraw(p, undefined, free, undefined, { exclude: [g.id] });
    const t = r.target;
    let drop: Drop | null = null;
    if (t.kind === 'wall') drop = { wall: t.id, at: r.point };
    else if (t.kind === 'node') drop = { node: t.id, at: r.point };
    g.drop = drop;
    ctx.plan.showDropTarget(drop ? drop.at : null);
    if (drop) {
      ctx.showGuides(r.guides);
      this.clearRejection();
      return;
    }
    ctx.showGuides(this.run(moveNode(g.id, r.point), g.key, true) ? r.guides : []);
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

  private stepStair(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const s = ctx.doc.floor.stairs[g.id];
    if (!s) return;
    // The pointer delta snaps to the grid (so an off-grid stair keeps its offset); outline corners
    // that come near a room's wall faces snap onto them when alignment is on (the whole stair
    // moves by that delta).
    const grid = ctx.plan.snapOptions.grid;
    const d = sub(p, this.press!.plan);
    const raw = add(g.start, free ? d : { x: snapScalar(d.x, grid), y: snapScalar(d.y, grid) });
    const face = free || !ctx.plan.snapOptions.align ? null : this.faceDelta(s, raw);
    const r = { point: face ? add(raw, face) : raw, guides: [] as SnapGuide[] };
    const same = r.point.x === s.x && r.point.y === s.y;
    const ok = same || this.run(updateStair(g.id, { x: r.point.x, y: r.point.y }), g.key);
    ctx.showGuides(ok ? r.guides : []);
  }

  /** Moves the grabbed vertex of a roof to the snapped pointer; a follow roof is detached first. */
  private stepRoofVertex(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const roof = ctx.doc.floor.roofs[g.id];
    if (!roof || !g.vertex) return;
    const r = ctx.snapDraw(p, undefined, free);
    if (roof.follow) {
      const cmd = detachAndMoveVertex(g.id, g.vertex.index, r.point);
      const ok = this.run(cmd, g.key);
      if (ok) ctx.plan.emitRoofDetached({ roofId: g.id, newIds: [...cmd.newIds] });
      ctx.showGuides(ok ? r.guides : []);
      return;
    }
    const at = roofHandles(roof, ctx.doc.floor).find(
      (h) => h.index === g.vertex!.index && h.hole === g.vertex!.hole,
    )?.at;
    const same = at && at.x === r.point.x && at.y === r.point.y;
    const ok = same || this.run(moveRoofVertex(g.id, roof, g.vertex, r.point), g.key);
    ctx.showGuides(ok ? r.guides : []);
  }

  /** Moves an independent roof; the pointer delta snaps to the grid like a stair drag. */
  private stepRoof(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    if (!g.roof || !g.shift) return;
    const grid = ctx.plan.snapOptions.grid;
    const d = sub(p, this.press!.plan);
    const shift = free ? d : { x: snapScalar(d.x, grid), y: snapScalar(d.y, grid) };
    if (shift.x === g.shift.x && shift.y === g.shift.y) return;
    if (this.run(translateRoof(g.id, g.roof, shift), g.key)) g.shift = shift;
  }

  /** Records a vertex handle or edge of the selected roof under the press, if any. */
  private grabRoofHandle(e: PlanPointerEvent): void {
    const ctx = this.ctx!;
    const sel = ctx.plan.selection;
    const roof = sel?.kind === 'roof' ? ctx.doc.floor.roofs[sel.id] : undefined;
    if (!roof || !this.press) return;
    const scale = ctx.plan.view.scale;
    const hit = e.hit?.kind;
    // A handle wins over a wall (a follow roof's corners sit on the wall faces) and over a node it
    // is nearer to, but not over columns or stairs.
    const grabbable = !hit || hit === 'roof' || hit === 'wall' || hit === 'room' || hit === 'site';
    const handles = roofHandles(roof, ctx.doc.floor);
    let h = grabbable ? nearestHandle(handles, e.plan, ROOF_HANDLE_PX / scale) : null;
    if (!h && hit === 'node') {
      // A corner node sits just inside a follow roof's corner: the nearer of the two wins.
      const n = ctx.doc.floor.nodes[e.hit!.id];
      const dn = n ? Math.hypot(n.x - e.plan.x, n.y - e.plan.y) : 0;
      h = nearestHandle(handles, e.plan, Math.min(ROOF_HANDLE_PX / scale, dn - 1e-9));
    }
    if (h) {
      this.press.roofVertex = { index: h.index, ...(h.hole !== undefined ? { hole: h.hole } : {}) };
      return;
    }
    // Edge clicks never steal a click that landed on another entity.
    if (hit && hit !== 'roof') return;
    const edge = roofEdgeAt(roof, ctx.doc.floor, e.plan, ROOF_EDGE_PX / scale);
    if (edge) this.press.roofEdge = edge;
  }

  private askRoofEdge(edge: NonNullable<Press['roofEdge']>, screen: ScreenPoint): void {
    const sel = this.ctx!.plan.selection;
    if (sel?.kind !== 'roof') return;
    const { ref, current } = edge;
    this.ctx!.plan.emitRoofEdgeRequest({
      roofId: sel.id,
      index: ref.index,
      ...(ref.hole !== undefined ? { hole: ref.hole } : {}),
      ...(ref.wallId !== undefined ? { wallId: ref.wallId } : {}),
      current,
      at: screen,
    });
  }

  /** Move that puts the nearest corner of the stair's outline (at `centre`) on a wall-face vertex. */
  private faceDelta(s: Stair, centre: Vec2): Vec2 | null {
    const ctx = this.ctx!;
    const radius = SNAP_RADIUS_PX / ctx.plan.view.scale;
    const shift = sub(centre, s);
    let best: { d: number; delta: Vec2 } | null = null;
    for (const p of stairOutline(s, ctx.plan.stairRise())) {
      const corner = add(p, shift);
      const v = nearestFaceVertex(corner, ctx.doc.floor, radius);
      if (!v) continue;
      const d = Math.hypot(v.x - corner.x, v.y - corner.y);
      if (!best || d < best.d) best = { d, delta: sub(v, corner) };
    }
    return best?.delta ?? null;
  }

  private stepWall(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const floor = ctx.doc.floor;
    const a = floor.nodes[floor.walls[g.id]?.a ?? ''];
    if (!a) return;
    const wanted = this.gridOffset(g, p, free);
    // moveWall is relative: the total travel, run from the start of the drag.
    if (wanted !== dot(sub(a, g.start), g.normal)) {
      this.run(moveWall(g.id, scale(g.normal, wanted)), g.key, true);
    }
  }

  /**
   * Push / pull is relative and may add connector walls, so each step reverts the open group
   * and re-runs `pushPullWall` with the total distance against the original geometry: one undo
   * step, and Esc (`cancelCoalesce`) restores the start. A step that fails only with
   * `wall-too-short` (a connector below the minimum) goes back to the start (distance 0), is not
   * flashed and keeps the snap guides; any other failure is undone back to the last good distance.
   */
  private stepPush(g: Gesture, p: Vec2, free: boolean): void {
    const ctx = this.ctx!;
    const { d: wanted, guides } = this.pushOffset(g, p, free);
    if (wanted === g.applied) {
      ctx.showGuides(guides);
      return;
    }
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
      ctx.showGuides(guides);
      return;
    }
    const issues = res.issues.filter((i) => i.code !== 'wall-too-short');
    if (issues.length === 0) {
      // Only a connector below the minimum: back to the start, so releasing here is a no-op.
      exec(0);
      g.applied = 0;
    } else if (g.applied !== 0) exec(g.applied);
    this.reject(issues);
    ctx.showGuides(issues.length === 0 ? guides : []);
  }

  /** Signed pointer travel along the wall's original left normal; grid-snapped unless `free`. */
  private gridOffset(g: Gesture, p: Vec2, free: boolean): number {
    const d = dot(sub(p, this.press!.plan), g.normal);
    return free ? d : snapScalar(d, this.ctx!.plan.snapOptions.grid);
  }

  /**
   * Push / pull distance: the grabbed point, moved along the normal, aligns to other nodes on
   * the axis the wall moves along (axis-parallel walls only) with a guide; else grid offset.
   */
  private pushOffset(g: Gesture, p: Vec2, free: boolean): { d: number; guides: SnapGuide[] } {
    const ctx = this.ctx!;
    const d = this.gridOffset(g, p, free);
    const w = ctx.doc.floor.walls[g.id];
    if (free || !w) return { d, guides: [] };
    const origin = this.press!.plan;
    const raw = add(origin, scale(g.normal, dot(sub(p, origin), g.normal)));
    const r = ctx.snap(raw, [w.a, w.b], false);
    const guides = r.guides.filter((gd) => Math.abs(g.normal[gd.axis]) > AXIS_PARALLEL);
    if (guides.length === 0) return { d, guides: [] };
    return { d: dot(sub(r.point, origin), g.normal), guides };
  }

  /** Ends a released drag: a node over a join target is dropped there in the same undo step. */
  private finishGesture(): void {
    const ctx = this.ctx!;
    const g = this.gesture!;
    if (g.kind === 'box' && g.shift) {
      const end = g.shift;
      this.endGesture(true);
      ctx.plan.selectInRect(g.start, end, {
        mode: end.x >= g.start.x ? 'inside' : 'touching',
        add: true,
      });
      return;
    }
    if (g.kind === 'node' && g.drop) {
      const target =
        'node' in g.drop ? { node: g.drop.node } : { wall: g.drop.wall, at: g.drop.at };
      if (this.run(dropNode(g.id, target), g.key, true)) {
        const drop = g.drop;
        // A wall drop keeps the new junction node, found at the drop point.
        const kept =
          'node' in drop
            ? drop.node
            : Object.values(ctx.doc.floor.nodes).find(
                (n) => Math.hypot(n.x - drop.at.x, n.y - drop.at.y) < GEOM_TOL,
              )?.id;
        ctx.plan.select(kept ? { kind: 'node', id: kept } : null);
      }
    }
    this.endGesture(true);
  }

  /** Runs one of the tool's own commands; flashes a rejection, clears it after a success. */
  private run(cmd: Command, coalesceKey?: string, restart = false): boolean {
    const ctx = this.ctx!;
    const res = this.issue(() => ctx.doc.tryExecute(cmd, { coalesceKey, restart }));
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
    ctx.showGhost(null);
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
