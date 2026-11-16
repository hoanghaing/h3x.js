import type { ChangeEvent, Floor, H3xDocument, Id, PresetResolver, Vec2 } from '../core';
import { computeJoins, type Joins } from '../shared/walls/joins';
import { dimensionLabel, wallsShowingDimensions } from './dimensions';
import {
  NON_SCALING,
  createDimensionElement,
  createEntityElement,
  createJoinElement,
  gridPaths,
  labelRect,
  pointsAttr,
  rootTransform,
  setAttr,
  svgEl,
  updateDimensionElement,
  updateEntityElement,
  type KindEntity,
  type RenderContext,
} from './render';
import { junctionPolygons, wallOutline } from './shapes';
import { DEFAULT_CSS, DIMENSION_FONT_PX } from './style';
import type { PlanKind, Rect, ScreenPoint, Selection } from './types';
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
}

const LAYERS = [
  'grid',
  'rooms',
  'walls',
  'joins',
  'openings',
  'items',
  'dimensions',
  'nodes',
  'overlay',
] as const;
type LayerName = (typeof LAYERS)[number];

const KINDS: readonly PlanKind[] = ['node', 'wall', 'room', 'opening', 'item'];
const LAYER_OF: Record<PlanKind, LayerName> = {
  node: 'nodes',
  wall: 'walls',
  room: 'rooms',
  opening: 'openings',
  item: 'items',
};
const COLLECTION = {
  node: 'nodes',
  wall: 'walls',
  room: 'rooms',
  opening: 'openings',
  item: 'items',
} as const satisfies Record<PlanKind, keyof Floor>;

/** A change touching more ids than this re-reconciles every entity. */
const FULL_RECONCILE_THRESHOLD = 50;
/** Default padding (px) of fitToContent. */
const FIT_PADDING_PX = 40;
/** fitToContent frames at least this many meters on each axis. */
const MIN_FIT_EXTENT = 1;

/** An SVG 2D plan of an H3xDocument's floor, kept in sync as retained elements. */
export class H3xPlan {
  readonly svg: SVGSVGElement;
  readonly doc: H3xDocument;
  /** @internal Snapping options for editing tools. */
  readonly snapOptions: { grid: number; align: boolean };
  private readonly prefix: string;
  private readonly presets: PresetResolver | undefined;
  private readonly root: SVGGElement;
  private readonly layers = {} as Record<LayerName, SVGGElement>;
  private readonly elements: Record<PlanKind, Map<Id, SVGGElement>> = {
    node: new Map(),
    wall: new Map(),
    room: new Map(),
    opening: new Map(),
    item: new Map(),
  };
  private readonly joinEls = new Map<Id, SVGGElement>();
  private readonly dimensionEls = new Map<Id, SVGGElement>();
  private readonly dimensionRectsById = new Map<Id, Rect>();
  private readonly grid: { major: SVGPathElement; minor: SVGPathElement } | undefined;
  /** Which dimensions show; editing state is supplied here by later tools. */
  private readonly dimensionState: { selection: Selection | null; draggingNode: Id | null } = {
    selection: null,
    draggingNode: null,
  };
  private joins: Joins = { corners: {}, junctions: {} };
  private _view: View;
  private readonly unsubscribe: () => void;
  private readonly resizeObserver: ResizeObserver | undefined;
  private readonly onWindowResize = (): void => this.resize();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    doc: H3xDocument,
    opts: H3xPlanOptions = {},
  ) {
    this.doc = doc;
    this.prefix = opts.classPrefix ?? 'h3x-plan';
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
      this.layers[name] = layer;
      this.root.appendChild(layer);
    }
    if (opts.grid ?? true) {
      this.grid = {
        minor: svgEl('path', { class: `${this.prefix}-grid-minor`, ...NON_SCALING }),
        major: svgEl('path', { class: `${this.prefix}-grid-major`, ...NON_SCALING }),
      };
      this.layers.grid.append(this.grid.minor, this.grid.major);
    }

    this.reconcileAll();
    container.appendChild(this.svg);
    this.unsubscribe = doc.on('change', (e) => this.onChange(e));

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(container);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onWindowResize);
    }

    this.fitToContent();
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
    return this.elements[kind].get(id);
  }

  /** @internal Screen rects (px) of the visible dimension labels, keyed by wall id. */
  dimensionRects(): ReadonlyMap<Id, Rect> {
    return this.dimensionRectsById;
  }

  /** Idempotent: drops the document subscription, resize listeners and the SVG. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
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
        for (const id of this.elements[kind].keys()) this.syncEntity(kind, id);
      }
    }
    this.refreshDimensions();
  }

  // ---- document sync ----------------------------------------------------

  private onChange(e: ChangeEvent): void {
    if (this.disposed) return;
    if (e.reason === 'load' || e.changes.length > FULL_RECONCILE_THRESHOLD) {
      this.reconcileAll();
      return;
    }
    this.joins = computeJoins(this.doc.floor);
    const floor = this.doc.floor;
    const changed: Record<PlanKind, Set<Id>> = {
      node: new Set(),
      wall: new Set(),
      room: new Set(),
      opening: new Set(),
      item: new Set(),
    };
    for (const c of e.changes) changed[c.kind].add(c.id);

    // Corners depend on neighbouring walls' directions: take the walls touching any moved
    // node or changed wall, then every wall sharing a node with those.
    const wallsAt = new Map<Id, Id[]>();
    for (const w of Object.values(floor.walls)) {
      for (const n of [w.a, w.b]) {
        const list = wallsAt.get(n);
        if (list) list.push(w.id);
        else wallsAt.set(n, [w.id]);
      }
    }
    const seeds = new Set(changed.node);
    for (const c of e.changes) {
      if (c.kind !== 'wall') continue;
      for (const w of [c.before, c.after]) if (w) seeds.add(w.a).add(w.b);
    }
    const nodes = new Set(seeds);
    for (const n of seeds) {
      for (const id of wallsAt.get(n) ?? []) {
        const w = floor.walls[id]!;
        nodes.add(w.a).add(w.b);
      }
    }
    const dirtyWalls = new Set(changed.wall);
    for (const n of nodes) for (const id of wallsAt.get(n) ?? []) dirtyWalls.add(id);

    const dirty = { ...changed, wall: dirtyWalls };
    for (const o of Object.values(floor.openings)) {
      if (dirtyWalls.has(o.wall)) dirty.opening.add(o.id);
    }
    for (const r of Object.values(floor.rooms)) {
      if (r.walls.some((id) => dirtyWalls.has(id))) dirty.room.add(r.id);
    }
    for (const it of Object.values(floor.items)) {
      if (it.mount === 'wall' && dirtyWalls.has(it.wall)) dirty.item.add(it.id);
    }

    for (const kind of KINDS) for (const id of dirty[kind]) this.syncEntity(kind, id);
    this.syncJoins();
    this.refreshDimensions();
  }

  private reconcileAll(): void {
    this.joins = computeJoins(this.doc.floor);
    const floor = this.doc.floor;
    for (const kind of KINDS) {
      const coll = floor[COLLECTION[kind]] as Record<Id, unknown>;
      for (const id of [...this.elements[kind].keys()]) if (!coll[id]) this.syncEntity(kind, id);
      for (const id of Object.keys(coll)) this.syncEntity(kind, id);
    }
    this.syncJoins();
    this.refreshDimensions();
  }

  /** Creates, updates or removes the element of one entity to match the document. */
  private syncEntity(kind: PlanKind, id: Id): void {
    const entity = (this.doc.floor[COLLECTION[kind]] as Record<Id, unknown>)[id];
    const els = this.elements[kind];
    let g = els.get(id);
    if (!entity) {
      g?.remove();
      els.delete(id);
      return;
    }
    if (!g) {
      g = createEntityElement(kind, id, this.prefix);
      els.set(id, g);
      this.layers[LAYER_OF[kind]].appendChild(g);
    }
    updateEntityElement(g, { kind, entity } as KindEntity, this.renderContext());
  }

  private renderContext(): RenderContext {
    return {
      floor: this.doc.floor,
      view: this._view,
      corners: this.joins.corners,
      presets: this.presets,
    };
  }

  /** Junction fills, keyed by node id; recomputed every change (they are cheap). */
  private syncJoins(): void {
    const polys = junctionPolygons(this.joins);
    for (const [id, g] of this.joinEls) {
      if (polys[id]) continue;
      g.remove();
      this.joinEls.delete(id);
    }
    for (const [id, pts] of Object.entries(polys)) {
      let g = this.joinEls.get(id);
      if (!g) {
        g = createJoinElement(id, this.prefix);
        this.joinEls.set(id, g);
        this.layers.joins.appendChild(g);
      }
      setAttr(g.firstElementChild!, 'points', pointsAttr(pts));
    }
  }

  /** Re-derives which walls show a length label, their geometry and screen rects. */
  private refreshDimensions(): void {
    const floor = this.doc.floor;
    const ids = new Set(wallsShowingDimensions(floor, this.dimensionState));
    for (const [id, g] of this.dimensionEls) {
      if (ids.has(id)) continue;
      g.remove();
      this.dimensionEls.delete(id);
      this.dimensionRectsById.delete(id);
    }
    for (const id of ids) {
      let g = this.dimensionEls.get(id);
      if (!g) {
        g = createDimensionElement(id, this.prefix);
        this.dimensionEls.set(id, g);
        this.layers.dimensions.appendChild(g);
      }
      const label = dimensionLabel(floor, id, this._view);
      updateDimensionElement(g, label, this._view);
      this.dimensionRectsById.set(
        id,
        labelRect(this._view, label.at, label.angle, label.text, DIMENSION_FONT_PX),
      );
    }
  }
}
