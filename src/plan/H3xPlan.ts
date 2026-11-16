import type { ChangeEvent, H3xDocument, Id, Issue, PresetResolver, Vec2 } from '../core';
import { Emitter } from '../core/document/emitter';
import { setWallLength } from '../core';
import { pickAnchor } from './anchor';
import { computeJoins, type Joins } from '../shared/walls/joins';
import { PlanInput } from './input';
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
import { renderGuides, syncDimensions } from './overlay';
import { KINDS, LAYERS, entitiesOf, type LayerName, type PlanDom } from './kinds';
import { dirtyEntities, syncEntity, syncJoins } from './reconcile';
import { wallOutline } from './shapes';
import { DEFAULT_CSS } from './style';
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
  private readonly root: SVGGElement;
  private readonly dom: PlanDom;
  private readonly grid: { major: SVGPathElement; minor: SVGPathElement } | undefined;
  /** Which dimensions show; editing state is supplied here by later tools. */
  private readonly dimensionState: DimensionState = { selection: null, draggingNode: null };
  private joins: Joins = { corners: {}, junctions: {} };
  private _view: View;
  private readonly unsubscribe: () => void;
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
    };
    this.presets = opts.presets ?? doc.presets;
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

    this.standing = this.computeStanding();
    this.reconcileAll();
    container.appendChild(this.svg);
    this.unsubscribe = doc.on('change', (e) => this.onChange(e));

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
      snapDraw: (p, from, disabled, extra) => {
        if (disabled) return { point: p, guides: [], target: { kind: 'free' } };
        const radius = ALIGN_RADIUS_PX / this._view.scale;
        return snapDraw(p, doc.floor, {
          grid: this.snapOptions.grid,
          align: this.snapOptions.align,
          alignRadius: radius,
          reach: radius,
          ...(from ? { from } : {}),
          ...(extra ? { extra } : {}),
        });
      },
      showGuides: (g) => this.showGuides(g),
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
      dimensions: [...this.dom.dimensionRects].map(([wallId, rect]) => ({ wallId, rect })),
      presets: this.presets,
      site: this.doc.project.site,
    };
    return hitTest(scene, s);
  }

  private showGuides(guides: SnapResult['guides']): void {
    renderGuides(this.dom.layers.overlay, this._view, this.prefix, guides);
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
  on(
    type: 'selectionchange' | 'lengthEditRequest' | 'issues',
    fn: ((s: Selection | null) => void) &
      ((e: LengthEditRequest) => void) &
      ((e: PlanIssues) => void),
  ): () => void {
    if (type === 'selectionchange') return this.selectionEmitter.on(fn);
    if (type === 'lengthEditRequest') return this.lengthEmitter.on(fn);
    return this.issuesEmitter.on(fn);
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
      for (const kind of ['node', 'room'] as const) {
        for (const id of this.dom.elements[kind].keys()) this.syncEntity(kind, id);
      }
    }
    this.refreshDimensions();
  }

  // ---- document sync ----------------------------------------------------

  private onChange(e: ChangeEvent): void {
    if (this.disposed) return;
    this.refreshStanding();
    if (e.reason === 'load' || e.changes.length > FULL_RECONCILE_THRESHOLD) {
      this.reconcileAll();
      return;
    }
    this.joins = computeJoins(this.doc.floor);
    const dirty = dirtyEntities(this.doc.floor, e.changes);
    for (const kind of KINDS) for (const id of dirty[kind]) this.syncEntity(kind, id);
    this.syncJoins();
    this.refreshDimensions();
    this.refreshMarks();
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
    };
  }

  private refreshDimensions(): void {
    syncDimensions(this.doc.floor, this._view, this.dimensionState, this.dom);
  }
}
