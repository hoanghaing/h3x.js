import type {
  ChangeEvent,
  EntityChange,
  H3xDocument,
  Id,
  Issue,
  PresetResolver,
  RoofEdge,
  RoofGeometry,
  Vec2,
} from '../core';
import { Emitter } from '../core/document/emitter';
import {
  removeColumn,
  removeItem,
  removeNode,
  removeOpening,
  removeRoof,
  removeStair,
  removeWall,
  setSite,
  setWallLength,
  stairRise,
} from '../core';
import { pickAnchor } from './anchor';
import { computeJoins, type Joins } from '../shared/walls/joins';
import { PlanInput } from './input';
import { roofHandles } from './roofEdit';
import { hitTest, type HitScene, type HitTarget } from './hit';
import { snapDraw, snapPoint, type SnapResult } from './snap';
import type { Tool, ToolContext } from './tools/Tool';
import { SelectEditTool } from './tools/SelectEditTool';
import {
  NON_SCALING,
  gridPaths,
  rootTransform,
  setAttr,
  svgEl,
  type RenderContext,
} from './render';
import type { DimensionState } from './dimensions';
import {
  renderDropTarget,
  renderGhost,
  renderGuides,
  renderPreview,
  renderRoofHandles,
  syncDimensions,
  type PreviewState,
} from './overlay';
import { KINDS, LAYERS, entitiesOf, type LayerName, type PlanDom } from './kinds';
import { dirtyEntities, syncEntity, syncJoins } from './reconcile';
import { wallOutline } from './shapes';
import { DEFAULT_CSS } from './style';
import { createUnderlayLayer, renderUnderlay } from './underlay';
import { DEFAULT_STAIR_LABELS, type StairLabels } from './stairs';
import type { PlanIssues, PlanKind, Rect, ScreenPoint, Selection } from './types';
import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  fitBounds,
  planToScreen,
  screenToPlan,
  type View,
} from './view';

export interface H3xPlanOptions {
  /** Draw the background grid. Default true. */
  grid?: boolean;
  /** Snapping used by editing tools. Default `{ grid: 0.05, align: true }`. */
  snap?: { grid?: number; align?: boolean };
  /** Prefix of every class name the plan sets. Default 'h3x-plan'. */
  classPrefix?: string;
  /** Resolves item presets (footprints). Default `doc.presets`. */
  presets?: PresetResolver;
  /** Editing tool. Default `new SelectEditTool()`; `null` means no tool (the plan only pans and zooms). */
  tool?: Tool | null;
  /** Stair label texts (walking up on the stair's floor, down on the floor above). Default `{ up: 'UP', down: 'DN' }`. */
  stairLabels?: StairLabels;
}

/** A change touching more ids than this re-reconciles every entity. */
const FULL_RECONCILE_THRESHOLD = 50;
/** Default padding (px) of fitToContent. */
const FIT_PADDING_PX = 40;
/** fitToContent frames at least this many meters on each axis. */
const MIN_FIT_EXTENT = 1;

/** Alignment reach of tool snapping, in screen px. */
const ALIGN_RADIUS_PX = 8;

/** How long a rejected edit stays flashed. */
const REJECTED_FLASH_MS = 600;

export interface LengthEditRequest {
  wallId: Id;
  length: number;
  anchor: 'a' | 'b';
  /** Screen rect (px) of the wall's dimension label. */
  anchorRect: Rect;
}

/** Asks the host to edit one roof edge (an outline edge of an independent roof, or a follow roof's wall). */
export interface RoofEdgeRequest {
  roofId: Id;
  /**
   * Index of the edge in its ring. For follow roofs `wallId` is authoritative and `index` is
   * within the first body's outer ring (the ring the vertex handles cover).
   */
  index: number;
  /** Set when the edge belongs to a hole of the roof. */
  hole?: number;
  /** Set for follow roofs: the wall the edge stands on. */
  wallId?: Id;
  current: RoofEdge;
  /** Where the edge was clicked, in viewport pixels. */
  at: ScreenPoint;
}

/** Fired when a follow roof was turned independent by editing; `newIds` are roofs split off it. */
export interface RoofDetached {
  roofId: Id;
  newIds: Id[];
}

/** Asks the host for the length of the wall segment being drawn. */
export interface SegmentLengthRequest {
  /** Start of the segment. */
  from: Vec2;
  /** Unit direction of the current preview, or zero when the pointer has not moved yet. */
  direction: Vec2;
  /** Current length (0 when the segment starts). */
  length: number;
}

/** The floor a change is on; undefined for the (project-level) site. */
const floorOf = (c: EntityChange): Id | undefined => (c.kind === 'site' ? undefined : c.floorId);

const issueKey = (list: Issue[]): string =>
  list.map((i) => `${i.code}:${[...i.ids].join(',')}`).join('|');

/** An SVG 2D plan of an H3xDocument's floor, kept in sync as retained elements. */
export class H3xPlan {
  readonly svg: SVGSVGElement;
  readonly doc: H3xDocument;
  /** @internal Snapping options for editing tools. */
  readonly snapOptions: { grid: number; align: boolean };
  private readonly prefix: string;
  private readonly presets: PresetResolver | undefined;
  private readonly stairLabels: StairLabels;
  private _roofsVisible = true;
  private readonly root: SVGGElement;
  private readonly dom: PlanDom;
  private readonly grid: { major: SVGPathElement; minor: SVGPathElement } | undefined;
  /** Faded walls and columns of the floor below the active one. */
  private readonly underlay: SVGGElement;
  /** Which dimensions show; editing state is supplied here by later tools. */
  private readonly dimensionState: DimensionState = { selection: null, draggingNode: null };
  private joins: Joins = { corners: {}, junctions: {}, risers: {} };
  private _view: View;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeActive: () => void;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly onWindowResize = (): void => this.resize();
  private disposed = false;
  private readonly input: PlanInput;
  private _tool: Tool | null = null;
  private readonly toolContext: ToolContext;
  private _selection: Selection | null = null;
  private standing: Issue[] = [];
  private rejected: Issue[] = [];
  private rejectedTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly selectionEmitter = new Emitter<Selection | null>();
  private readonly lengthEmitter = new Emitter<LengthEditRequest>();
  private readonly issuesEmitter = new Emitter<PlanIssues>();
  private readonly segmentEmitter = new Emitter<SegmentLengthRequest>();
  private readonly roofEdgeEmitter = new Emitter<RoofEdgeRequest>();
  private readonly roofDetachedEmitter = new Emitter<RoofDetached>();
  private preview: PreviewState | null = null;
  private dropTarget: Vec2 | null = null;

  constructor(
    private readonly container: HTMLElement,
    doc: H3xDocument,
    opts: H3xPlanOptions = {},
  ) {
    this.doc = doc;
    this.prefix = opts.classPrefix ?? 'h3x-plan';
    this.dom = {
      layers: {} as Record<LayerName, SVGGElement>,
      prefix: this.prefix,
      elements: Object.fromEntries(KINDS.map((k) => [k, new Map()])) as PlanDom['elements'],
      joins: new Map(),
      dimensions: new Map(),
      dimensionRects: new Map(),
      roofGeometry: new Map(),
    };
    this.presets = opts.presets ?? doc.presets;
    this.stairLabels = { ...DEFAULT_STAIR_LABELS, ...opts.stairLabels };
    this.snapOptions = { grid: opts.snap?.grid ?? 0.05, align: opts.snap?.align ?? true };
    this._view = {
      cx: 0,
      cy: 0,
      scale: DEFAULT_SCALE,
      width: container.clientWidth,
      height: container.clientHeight,
    };

    this.svg = svgEl('svg', { class: this.prefix });
    this.svg.style.display = 'block';
    const style = svgEl('style');
    style.textContent = DEFAULT_CSS(this.prefix);
    this.root = svgEl('g');
    this.svg.append(style, this.root);
    for (const name of LAYERS) {
      const layer = svgEl('g', { class: `${this.prefix}-layer-${name}` });
      this.dom.layers[name] = layer;
      this.root.appendChild(layer);
    }
    if (opts.grid ?? true) {
      this.grid = {
        minor: svgEl('path', { class: `${this.prefix}-grid-minor`, ...NON_SCALING }),
        major: svgEl('path', { class: `${this.prefix}-grid-major`, ...NON_SCALING }),
      };
      this.dom.layers.grid.append(this.grid.minor, this.grid.major);
    }
    this.underlay = createUnderlayLayer(this.prefix);
    this.dom.layers.grid.after(this.underlay);

    this.standing = this.computeStanding();
    this.reconcileAll();
    this.refreshUnderlay();
    container.appendChild(this.svg);
    this.unsubscribe = doc.on('change', (e) => this.onChange(e));
    this.unsubscribeActive = doc.on('activefloor', () => this.onActiveFloor());

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onWindowResize);
    }

    this.svg.setAttribute('tabindex', '0');
    this.toolContext = {
      plan: this,
      doc,
      hit: (s) => this.hitAt(s),
      snap: (p, exclude, disabled) => {
        if (disabled) return { point: p, guides: [] };
        const skip = new Set(exclude);
        const others = Object.values(doc.floor.nodes).filter((n) => !skip.has(n.id));
        return snapPoint(p, others, {
          grid: this.snapOptions.grid,
          align: this.snapOptions.align,
          alignRadius: ALIGN_RADIUS_PX / this._view.scale,
        });
      },
      snapDraw: (p, from, disabled, extra, o) => {
        if (disabled) return { point: p, guides: [], target: { kind: 'free' } };
        const radius = ALIGN_RADIUS_PX / this._view.scale;
        return snapDraw(p, doc.floor, {
          grid: this.snapOptions.grid,
          align: this.snapOptions.align,
          alignRadius: radius,
          reach: radius,
          ...(from ? { from } : {}),
          ...(extra ? { extra } : {}),
          ...(o?.structure === false ? { structure: false } : {}),
          ...(o?.exclude ? { exclude: o.exclude } : {}),
          ...(doc.project.site && o?.site !== false ? { site: doc.project.site.points } : {}),
        });
      },
      showGuides: (g) => this.showGuides(g),
      showGhost: (g, invalid = false, guides = []) => {
        if (this.disposed) return;
        renderGhost(this.dom.layers.overlay, this.prefix, g && { shape: g, invalid, guides });
      },
      setDragging: (id) => {
        this.dimensionState.draggingNode = id;
        this.refreshDimensions();
      },
    };
    this.input = new PlanInput(this);
    this.setTool(opts.tool === undefined ? new SelectEditTool() : opts.tool);

    this.fitToContent();
  }

  /** The active tool, or null. */
  get tool(): Tool | null {
    return this._tool;
  }

  /** Swaps the editing tool; the old one is deactivated first. */
  setTool(tool: Tool | null): void {
    if (this.disposed) return;
    this._tool?.deactivate();
    this.input.cancelGesture();
    this._tool = tool;
    tool?.activate(this.toolContext);
  }

  /** @internal What is under a screen point. */
  hitAt(s: ScreenPoint): HitTarget {
    const scene: HitScene = {
      floor: this.doc.floor,
      view: this._view,
      corners: this.joins.corners,
      junctions: this.joins.junctions,
      dimensions: [...this.dom.dimensionRects].map(([wallId, rect]) => ({ wallId, rect })),
      presets: this.presets,
      site: this.doc.project.site,
      stairRise: this.stairRise(),
      roofsVisible: this._roofsVisible,
      roofGeometry: this.dom.roofGeometry,
    };
    return hitTest(scene, s);
  }

  private showGuides(guides: SnapResult['guides']): void {
    renderGuides(this.dom.layers.overlay, this._view, this.prefix, guides);
  }

  /** @internal Draws a drawing tool's preview segments and label in the overlay; `null` clears. */
  showPreview(segments: Array<[Vec2, Vec2]> | null, label?: { at: Vec2; text: string }): void {
    if (this.disposed) return;
    this.preview = segments ? { segments, ...(label ? { label } : {}) } : null;
    renderPreview(this.dom.layers.overlay, this._view, this.prefix, this.preview);
  }

  /** @internal Marks where a dragged node would be dropped (join on drop); `null` clears. */
  showDropTarget(at: Vec2 | null): void {
    if (this.disposed) return;
    this.dropTarget = at ? { x: at.x, y: at.y } : null;
    renderDropTarget(this.dom.layers.overlay, this._view, this.prefix, this.dropTarget);
  }

  /** Shows or hides the roofs layer; hidden roofs are not hit. Default shown. */
  setRoofsVisible(visible: boolean): void {
    if (this.disposed) return;
    this._roofsVisible = visible;
    setAttr(this.dom.layers.roofs, 'display', visible ? 'inline' : 'none');
  }

  /** The current view (a copy). */
  get view(): View {
    return { ...this._view };
  }

  setView(v: Partial<Pick<View, 'cx' | 'cy' | 'scale'>>): void {
    const next = { ...this._view, ...v };
    next.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next.scale));
    this.applyView(next);
  }

  /** Frames every wall (or every node when there are no walls) with `paddingPx` around it. */
  fitToContent(paddingPx = FIT_PADDING_PX): void {
    const pts: Vec2[] = Object.values(this.joins.corners).flatMap(wallOutline);
    if (pts.length === 0) pts.push(...Object.values(this.doc.floor.nodes));
    if (pts.length === 0) {
      this.applyView(this._view);
      return;
    }
    const min = { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) };
    const max = { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) };
    for (const axis of ['x', 'y'] as const) {
      const grow = Math.max(0, MIN_FIT_EXTENT - (max[axis] - min[axis])) / 2;
      min[axis] -= grow;
      max[axis] += grow;
    }
    this.applyView(fitBounds(this._view, min, max, paddingPx));
  }

  planToScreen(p: Vec2): ScreenPoint {
    return planToScreen(this._view, p);
  }

  screenToPlan(s: ScreenPoint): Vec2 {
    return screenToPlan(this._view, s);
  }

  getElement(kind: PlanKind, id: Id): SVGGElement | undefined {
    return this.dom.elements[kind].get(id);
  }

  /** @internal Screen rects (px) of the visible dimension labels, keyed by wall id. */
  dimensionRects(): ReadonlyMap<Id, Rect> {
    return this.dom.dimensionRects;
  }

  get selection(): Selection | null {
    return this._selection;
  }

  /** Selects an entity; an unknown id selects nothing. Fires only when the selection changes. */
  select(sel: Selection | null): void {
    const next =
      sel && this.dom.elements[sel.kind].has(sel.id) ? { kind: sel.kind, id: sel.id } : null;
    const prev = this._selection;
    if (prev?.kind === next?.kind && prev?.id === next?.id) return;
    this._selection = next;
    this.dimensionState.selection = next;
    this.refreshDimensions();
    this.refreshMarks();
    this.selectionEmitter.emit(next);
  }

  /**
   * Deletes the selected node, wall, column, stair, roof, opening, item or site (one undo step) and clears the
   * selection. Returns false when nothing deletable is selected or the edit is rejected (the
   * rejection is reported as for any edit). Tools call it for Delete / Backspace; editors can
   * call it from a button.
   */
  deleteSelection(): boolean {
    const sel = this._selection;
    if (!sel) return false;
    const cmd =
      sel.kind === 'node'
        ? removeNode(sel.id)
        : sel.kind === 'wall'
          ? removeWall(sel.id)
          : sel.kind === 'column'
            ? removeColumn(sel.id)
            : sel.kind === 'stair'
              ? removeStair(sel.id)
              : sel.kind === 'roof'
                ? removeRoof(sel.id)
                : sel.kind === 'opening'
                  ? removeOpening(sel.id)
                  : sel.kind === 'item'
                    ? removeItem(sel.id)
                    : sel.kind === 'site'
                      ? setSite(null)
                      : null;
    if (!cmd) return false;
    const res = this.doc.tryExecute(cmd);
    if (!res.ok) {
      this.reportRejected(res.issues);
      return false;
    }
    this.reportRejected([]);
    this.select(null);
    return true;
  }

  get issues(): PlanIssues {
    return { rejected: [...this.rejected], standing: [...this.standing] };
  }

  /** Flashes the entities of rejected edits for a moment; `[]` clears. */
  reportRejected(issues: Issue[]): void {
    if (this.disposed) return;
    clearTimeout(this.rejectedTimer);
    this.rejectedTimer = undefined;
    const before = this.rejected;
    this.rejected = [...issues];
    this.refreshMarks();
    if (issues.length > 0) {
      this.rejectedTimer = setTimeout(() => this.reportRejected([]), REJECTED_FLASH_MS);
    }
    if (before.length > 0 || issues.length > 0) this.issuesEmitter.emit(this.issues);
  }

  /** Sets a wall's length, keeping one end fixed; rejected edits are flashed. */
  setWallLength(
    wallId: Id,
    length: number,
    opts: { anchor?: 'a' | 'b' } = {},
  ): { ok: true } | { ok: false; issues: Issue[] } {
    const anchor = opts.anchor ?? pickAnchor(this.doc.floor, wallId);
    const res = this.doc.tryExecute(setWallLength(wallId, length, { anchor }));
    if (!res.ok) this.reportRejected(res.issues);
    return res;
  }

  on(type: 'selectionchange', fn: (s: Selection | null) => void): () => void;
  on(type: 'lengthEditRequest', fn: (e: LengthEditRequest) => void): () => void;
  on(type: 'issues', fn: (e: PlanIssues) => void): () => void;
  /** Fires when the user clicks an edge of the selected roof; answer with `setRoofEdge`. */
  on(type: 'roofEdgeRequest', fn: (e: RoofEdgeRequest) => void): () => void;
  /** Fires when dragging a vertex of a follow roof detached it from the walls. */
  on(type: 'roofdetached', fn: (e: RoofDetached) => void): () => void;
  /** Fires when a drawing tool starts a new segment; answer with `setPendingSegmentLength`. */
  on(type: 'segmentLengthRequest', fn: (e: SegmentLengthRequest) => void): () => void;
  on(
    type:
      | 'selectionchange'
      | 'lengthEditRequest'
      | 'issues'
      | 'segmentLengthRequest'
      | 'roofEdgeRequest'
      | 'roofdetached',
    fn: ((s: Selection | null) => void) &
      ((e: LengthEditRequest) => void) &
      ((e: PlanIssues) => void) &
      ((e: SegmentLengthRequest) => void) &
      ((e: RoofEdgeRequest) => void) &
      ((e: RoofDetached) => void),
  ): () => void {
    if (type === 'roofEdgeRequest') return this.roofEdgeEmitter.on(fn);
    if (type === 'roofdetached') return this.roofDetachedEmitter.on(fn);
    if (type === 'selectionchange') return this.selectionEmitter.on(fn);
    if (type === 'lengthEditRequest') return this.lengthEmitter.on(fn);
    if (type === 'segmentLengthRequest') return this.segmentEmitter.on(fn);
    return this.issuesEmitter.on(fn);
  }

  /**
   * Commits the segment the active drawing tool is drawing at `length` (meters) along the
   * current preview direction. False when no segment is being drawn, `length` is not a finite
   * positive number, or it was rejected.
   */
  setPendingSegmentLength(length: number): boolean {
    if (this.disposed) return false;
    return this._tool?.setPendingSegmentLength?.(length) ?? false;
  }

  /** @internal Asks the host for a segment length (used by drawing tools). */
  emitSegmentLengthRequest(e: SegmentLengthRequest): void {
    this.segmentEmitter.emit(e);
  }

  /** @internal Asks the host to edit a roof edge (used by tools). */
  emitRoofEdgeRequest(e: RoofEdgeRequest): void {
    this.roofEdgeEmitter.emit(e);
  }

  /** @internal Tells the host a follow roof was detached (used by tools). */
  emitRoofDetached(e: RoofDetached): void {
    this.roofDetachedEmitter.emit(e);
  }

  /** @internal The geometry cached when a roof was last drawn, if any. */
  cachedRoofGeometry(id: Id): RoofGeometry | undefined {
    return this.dom.roofGeometry.get(id);
  }

  /** @internal Asks the host to open a length editor for a wall (used by tools). */
  emitLengthEditRequest(wallId: Id, near?: Vec2): void {
    const wall = this.doc.floor.walls[wallId];
    const a = wall && this.doc.floor.nodes[wall.a];
    const b = wall && this.doc.floor.nodes[wall.b];
    if (!wall || !a || !b) return;
    const at = planToScreen(this._view, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    this.lengthEmitter.emit({
      wallId,
      length: Math.hypot(b.x - a.x, b.y - a.y),
      anchor: pickAnchor(this.doc.floor, wallId, near),
      anchorRect: this.dom.dimensionRects.get(wallId) ?? { x: at.x, y: at.y, width: 0, height: 0 },
    });
  }

  /** Idempotent: drops the document subscription, resize listeners and the SVG. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
    this._tool?.deactivate();
    this._tool = null;
    this.unsubscribe();
    this.unsubscribeActive();
    clearTimeout(this.rejectedTimer);
    this.resizeObserver?.disconnect();
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.onWindowResize);
    this.svg.remove();
  }

  // ---- view -------------------------------------------------------------

  private resize(): void {
    if (this.disposed) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === this._view.width && height === this._view.height) return;
    this.applyView({ ...this._view, width, height });
  }

  private applyView(next: View): void {
    const scaleChanged = next.scale !== this._view.scale;
    this._view = next;
    setAttr(this.svg, 'width', String(next.width));
    setAttr(this.svg, 'height', String(next.height));
    setAttr(this.root, 'transform', rootTransform(next));
    if (this.grid) {
      const { major, minor } = gridPaths(next);
      setAttr(this.grid.major, 'd', major);
      setAttr(this.grid.minor, 'd', minor);
    }
    if (scaleChanged) {
      // Screen-space children (labels, handles) are counter-scaled.
      for (const kind of ['node', 'room', 'stair', 'roof'] as const) {
        for (const id of this.dom.elements[kind].keys()) this.syncEntity(kind, id);
      }
      this.refreshUnderlay(); // stair labels below
    }
    this.refreshDimensions();
    this.refreshRoofHandles();
    if (this.preview) renderPreview(this.dom.layers.overlay, next, this.prefix, this.preview);
    if (this.dropTarget)
      renderDropTarget(this.dom.layers.overlay, next, this.prefix, this.dropTarget);
  }

  // ---- document sync ----------------------------------------------------

  private onChange(e: ChangeEvent): void {
    if (this.disposed) return;
    this.refreshStanding(); // issues may depend on other floors (column support)
    const active = this.doc.activeFloorId;
    // The change removed the active floor: 'activefloor' follows and rebuilds.
    if (!this.doc.floorById(active)) return;
    const below = this.doc.floorBelow(active)?.id;
    const own = e.changes.filter((c) => c.kind === 'site' || floorOf(c) === active);
    if (e.reason === 'load' || own.length > FULL_RECONCILE_THRESHOLD) {
      this.reconcileAll();
      this.refreshUnderlay();
      return;
    }
    const heights = e.changes.some((c) => c.kind === 'floor');
    if (heights || (below && e.changes.some((c) => floorOf(c) === below))) this.refreshUnderlay();
    // Storey heights set the rise of the active floor's stairs.
    if (heights) {
      for (const id of this.dom.elements.stair.keys()) this.syncEntity('stair', id);
      for (const id of this.dom.elements.roof.keys()) this.syncEntity('roof', id);
    }
    if (own.length === 0) {
      this.refreshMarks();
      return;
    }
    this.joins = computeJoins(this.doc.floor);
    const dirty = dirtyEntities(this.doc.floor, own);
    for (const kind of KINDS) for (const id of dirty[kind]) this.syncEntity(kind, id);
    this.syncJoins();
    this.refreshDimensions();
    this.refreshMarks();
  }

  /** Another floor became active: drop the selection and any gesture, then rebuild. */
  private onActiveFloor(): void {
    if (this.disposed) return;
    this.setTool(this._tool); // re-activating cancels the tool's gesture
    this.select(null);
    this.refreshStanding();
    this.reconcileAll();
    this.refreshUnderlay();
  }

  private refreshUnderlay(): void {
    const below = this.doc.floorBelow(this.doc.activeFloorId);
    const corners = below ? computeJoins(below).corners : {};
    const rise = below ? stairRise(below, this.doc.floorAbove(below.id)) : NaN;
    renderUnderlay(below, this.underlay, {
      view: this._view,
      corners,
      stairs: { rise, labels: this.stairLabels, prefix: this.prefix },
    });
  }

  private reconcileAll(): void {
    this.joins = computeJoins(this.doc.floor);
    const floor = this.doc.floor;
    for (const kind of KINDS) {
      const coll = entitiesOf(kind, floor, this.doc.project.site);
      for (const id of [...this.dom.elements[kind].keys()])
        if (!coll[id]) this.syncEntity(kind, id);
      for (const id of Object.keys(coll)) this.syncEntity(kind, id);
    }
    this.syncJoins();
    this.refreshDimensions();
    this.refreshMarks();
  }

  private computeStanding(): Issue[] {
    return [...this.doc.validateLayout(), ...this.doc.validatePlacements()];
  }

  /** Recomputes standing problems and fires `issues` when their content changed. */
  private refreshStanding(): void {
    const before = issueKey(this.standing);
    this.standing = this.computeStanding();
    if (issueKey(this.standing) !== before) this.issuesEmitter.emit(this.issues);
  }

  /** Toggles selected / invalid / rejected classes on every entity element. */
  private refreshMarks(): void {
    const invalid = new Set(this.standing.flatMap((i) => i.ids));
    const rejected = new Set(this.rejected.flatMap((i) => i.ids));
    const sel = this._selection;
    if (sel && !this.dom.elements[sel.kind].has(sel.id)) {
      this.select(null); // the selected entity was removed
      return;
    }
    for (const kind of KINDS) {
      for (const [id, g] of this.dom.elements[kind]) {
        g.classList.toggle(`${this.prefix}-selected`, sel?.kind === kind && sel.id === id);
        g.classList.toggle(`${this.prefix}-invalid`, invalid.has(id));
        g.classList.toggle(`${this.prefix}-rejected`, rejected.has(id));
      }
    }
    this.refreshRoofHandles();
  }

  /** Vertex handles of the selected roof, in the overlay. */
  private refreshRoofHandles(): void {
    const sel = this._selection;
    const roof = sel?.kind === 'roof' ? this.doc.floor.roofs[sel.id] : undefined;
    const points = roof ? roofHandles(roof, this.doc.floor).map((h) => h.at) : [];
    renderRoofHandles(this.dom.layers.overlay, this._view, this.prefix, points);
  }

  private syncEntity(kind: PlanKind, id: Id): void {
    syncEntity(kind, id, this.dom, this.renderContext());
  }

  private syncJoins(): void {
    syncJoins(this.joins, this.dom);
  }

  private renderContext(): RenderContext {
    return {
      floor: this.doc.floor,
      view: this._view,
      corners: this.joins.corners,
      presets: this.presets,
      site: this.doc.project.site,
      prefix: this.prefix,
      roofGeometry: this.dom.roofGeometry,
      stairs: {
        rise: this.stairRise(),
        labels: this.stairLabels,
        prefix: this.prefix,
      },
    };
  }

  /** @internal Rise of the active floor's stairs to the floor above (NaN on the top floor). */
  stairRise(): number {
    return stairRise(this.doc.floor, this.doc.floorAbove(this.doc.activeFloorId));
  }

  private refreshDimensions(): void {
    syncDimensions(this.doc.floor, this._view, this.dimensionState, this.dom);
  }
}
