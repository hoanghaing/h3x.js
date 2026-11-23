import {
  type BufferGeometry,
  DoubleSide,
  Group,
  type Intersection,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';
import {
  addOpening,
  openingGeometry,
  presetOpening,
  removeOpening,
  resolvePlacement,
  updateOpening,
  type Floor,
  type Id,
  type Issue,
  type Opening,
  type Placement,
  type Vec2,
} from '../core';
import { buildOpeningParts } from './openingParts';
import type { H3xScene } from './scene';

/** What the viewer has selected. */
export interface ViewerSelection {
  kind: 'opening';
  id: Id;
}

/** What a press on a wall places, or null to select and drag instead. */
export interface ViewerPlacement {
  /** Opening preset, e.g. 'door-single-01'. */
  preset: string;
}

/** What the editing layer needs from the viewer. Internal to H3xViewer. */
export interface InteractionHost {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  controls: { enabled: boolean };
  scene: H3xScene;
  /** Where the ghost and the selection mark go: outside the scene root, so never picked. */
  overlay: Group;
  camera(): PerspectiveCamera | OrthographicCamera;
  size(): { w: number; h: number };
  requestRender(): void;
  emitSelection(sel: ViewerSelection | null): void;
  emitIssues(issues: Issue[]): void;
}

/** How far (screen px) the pointer moves before a press on an opening becomes a drag. */
const DRAG_THRESHOLD_PX = 4;
/** How far (screen px) from a snap an opening's centre may be to take it. */
const SNAP_PX = 8;
/** Grid (m) of an opening's centre while it is placed or dragged. */
const GRID = 0.05;

interface Hit {
  kind: string;
  id: Id;
  floorId: Id;
  point: Vector3;
  distance: number;
}

/** A press on the canvas. `consumed` presses are the viewer's; orbit never saw them. */
interface Press {
  pointerId: number;
  x: number;
  y: number;
  consumed: boolean;
  moved: boolean;
  /** The rest of the press is ignored (cancelled, interrupted). */
  dead: boolean;
  /** A press on an opening: it, its state at the press and the grab along its wall. */
  drag?: { id: Id; start: Opening; grab: number };
}

interface Gesture {
  key: string;
  id: Id;
  start: Opening;
  grab: number;
  /** The host of the last step; the ray meets its plane when it hits no wall. */
  host: Id;
}

/** Plan point of a world point. */
const planOf = (p: Vector3): Vec2 => ({ x: p.x, y: -p.z });

/** Every ancestor up to the root is shown. */
function shown(o: Object3D | null): boolean {
  for (let x = o; x; x = x.parent) if (!x.visible) return false;
  return true;
}

/** Distance from wall `id`'s node a to `p`, along it; NaN when the wall cannot be read. */
function along(floor: Readonly<Floor>, id: Id, p: Vec2): number {
  const w = floor.walls[id];
  const a = w && floor.nodes[w.a];
  const b = w && floor.nodes[w.b];
  if (!a || !b) return NaN;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-12) return NaN;
  return ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len;
}

/**
 * Selecting, placing and dragging openings in the 3D view, with the same placement module as
 * the plan. Pointer listeners sit on the container in the capture phase, so a press the viewer
 * takes turns orbit off before OrbitControls sees it; orbit comes back when the press ends.
 */
export class OpeningInteraction {
  private sel: ViewerSelection | null = null;
  private placement: ViewerPlacement | null = null;
  private press: Press | null = null;
  private gesture: Gesture | null = null;
  private gestureCount = 0;
  private orbitWas: boolean | null = null;
  private rejected: Issue[] = [];
  /** True while the viewer's own document calls run, so their change events are not interruptions. */
  private issuing = false;
  private disposed = false;
  private readonly raycaster = new Raycaster();
  private readonly ghost: Mesh;
  private readonly mark: Mesh;
  private readonly ghostOk = new MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly ghostBad = new MeshBasicMaterial({
    color: 0xdc2626,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: DoubleSide,
  });
  private readonly markMaterial = new MeshBasicMaterial({
    color: 0x2563eb,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  private readonly offChange: () => void;
  private readonly offActive: () => void;
  private readonly listeners: Array<[string, EventListener, boolean]> = [];
  private readonly hadTabIndex: boolean;

  constructor(private readonly host: InteractionHost) {
    this.ghost = new Mesh(undefined, this.ghostOk);
    this.ghost.name = 'h3x-opening-ghost';
    this.ghost.visible = false;
    this.mark = new Mesh(undefined, this.markMaterial);
    this.mark.name = 'h3x-selection';
    this.mark.visible = false;
    this.mark.renderOrder = 1;
    this.ghost.renderOrder = 2;
    host.overlay.add(this.ghost, this.mark);

    const doc = host.scene.document;
    this.offChange = doc.on('change', () => this.onChange());
    this.offActive = doc.on('activefloor', () => this.onActiveFloor());

    this.hadTabIndex = host.canvas.hasAttribute('tabindex');
    if (!this.hadTabIndex) host.canvas.tabIndex = 0;
    this.listen('pointerdown', (e) => this.onDown(e as PointerEvent), true);
    this.listen('pointermove', (e) => this.onMove(e as PointerEvent), true);
    this.listen('pointerup', (e) => this.onUp(e as PointerEvent), true);
    this.listen('pointercancel', (e) => this.onUp(e as PointerEvent), true);
    this.listen('pointerleave', () => this.onLeave(), false);
    this.listen('keydown', (e) => this.onKey(e as KeyboardEvent), false);
  }

  get selection(): ViewerSelection | null {
    return this.sel ? { ...this.sel } : null;
  }

  /** Selects an opening of the active floor; anything else clears. */
  select(sel: ViewerSelection | null): void {
    if (this.disposed) return;
    const floor = this.host.scene.document.floor;
    const next =
      sel && sel.kind === 'opening' && floor.openings[sel.id]
        ? { kind: 'opening' as const, id: sel.id }
        : null;
    if (this.sel?.id === next?.id) return;
    this.sel = next;
    this.refresh();
    this.host.emitSelection(next ? { ...next } : null);
  }

  /** Turns placing on (a press on a wall adds the preset) or off. */
  setPlacement(p: ViewerPlacement | null): void {
    if (this.disposed) return;
    this.placement = p ? { preset: p.preset } : null;
    this.hideGhost();
    if (!this.gesture) this.report([]);
  }

  /** Follows the scene after a rebuild: the selection mark takes the new geometry. */
  refresh(): void {
    const id = this.sel?.id;
    const pick = id === undefined ? undefined : this.host.scene.getOpeningMeshes(id).at(-1);
    if (pick && pick.userData.h3xKind === 'opening' && pick.name.endsWith('-pick')) {
      this.mark.geometry = pick.geometry;
      this.mark.visible = true;
    } else {
      this.mark.visible = false;
    }
    this.host.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    if (this.gesture) this.host.scene.document.endCoalesce();
    this.gesture = null;
    this.press = null;
    this.restoreOrbit();
    this.disposed = true;
    this.offChange();
    this.offActive();
    for (const [type, fn, capture] of this.listeners) {
      this.host.container.removeEventListener(type, fn, capture);
    }
    this.listeners.length = 0;
    if (!this.hadTabIndex) this.host.canvas.removeAttribute('tabindex');
    this.disposeGhostGeometry();
    this.ghost.removeFromParent();
    this.mark.removeFromParent();
    this.ghostOk.dispose();
    this.ghostBad.dispose();
    this.markMaterial.dispose();
  }

  private listen(type: string, fn: EventListener, capture: boolean): void {
    this.host.container.addEventListener(type, fn, capture);
    this.listeners.push([type, fn, capture]);
  }

  // --- pointer ---------------------------------------------------------------------------

  private onDown(e: PointerEvent): void {
    if (this.disposed || e.target !== this.host.canvas || e.button !== 0) return;
    // A second pointer is ignored while the viewer holds a press; a press left to orbit (whose
    // release may never reach the container) is simply replaced.
    if (this.press?.consumed) return;
    this.host.canvas.focus?.({ preventScroll: true });
    const press: Press = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      consumed: false,
      moved: false,
      dead: false,
    };
    this.press = press;
    if (this.placement) {
      if (this.placeAt(e)) this.consume(press, e);
      return;
    }
    const hit = this.firstHit(e);
    const floor = this.host.scene.document.floor;
    const o = hit && this.isActiveOpening(hit) ? floor.openings[hit.id] : undefined;
    if (!hit || !o) return;
    this.consume(press, e);
    this.select({ kind: 'opening', id: o.id });
    const x = along(floor, o.wall, planOf(hit.point));
    if (Number.isFinite(x))
      press.drag = { id: o.id, start: structuredClone(o), grab: x - o.offset };
  }

  private onMove(e: PointerEvent): void {
    if (this.disposed) return;
    const press = this.press;
    if (!press) {
      if (this.placement && e.target === this.host.canvas) this.hover(e);
      return;
    }
    if (e.pointerId !== press.pointerId || press.dead) return;
    if (!press.moved) {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= DRAG_THRESHOLD_PX) return;
      press.moved = true;
      if (press.drag) this.startGesture(press.drag);
    }
    if (this.gesture) this.step(e);
  }

  private onUp(e: PointerEvent): void {
    if (this.disposed) return;
    const press = this.press;
    if (!press || e.pointerId !== press.pointerId) return;
    this.press = null;
    if (press.consumed) {
      try {
        this.host.canvas.releasePointerCapture?.(e.pointerId);
      } catch {
        /* the pointer may already be gone */
      }
    }
    if (this.gesture) this.endGesture(true);
    this.restoreOrbit();
    if (!press.consumed && !press.moved && !press.dead && !this.placement) this.select(null);
  }

  private onLeave(): void {
    if (!this.press) this.hideGhost();
  }

  /** The press is the viewer's: orbit is off until it ends. */
  private consume(press: Press, e: PointerEvent): void {
    press.consumed = true;
    if (this.orbitWas === null) {
      this.orbitWas = this.host.controls.enabled;
      this.host.controls.enabled = false;
    }
    try {
      this.host.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer may already be gone */
    }
  }

  private restoreOrbit(): void {
    if (this.orbitWas === null) return;
    this.host.controls.enabled = this.orbitWas;
    this.orbitWas = null;
  }

  // --- keys ------------------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    // Keys typed into the host's own inputs inside the container are not the viewer's.
    if (this.disposed || e.target !== this.host.canvas || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    if (e.key === 'Escape') {
      if (this.gesture) {
        const { key } = this.gesture;
        this.issue(() => this.host.scene.document.cancelCoalesce(key));
        this.endGesture(false);
        if (this.press) this.press.dead = true;
        this.restoreOrbit();
        this.report([]);
      } else if (this.ghost.visible) {
        this.hideGhost();
      } else if (this.sel) {
        this.select(null);
      } else {
        return;
      }
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = this.sel;
      if (this.gesture || !sel) return;
      e.preventDefault();
      const res = this.issue(() => this.host.scene.document.tryExecute(removeOpening(sel.id)));
      if (!res.ok) {
        this.report(res.issues);
        return;
      }
      this.report([]);
      this.select(null);
    }
  }

  // --- document --------------------------------------------------------------------------

  private onChange(): void {
    if (this.disposed || this.issuing) return;
    if (this.gesture) {
      this.endGesture(false);
      if (this.press) this.press.dead = true;
      this.restoreOrbit();
    }
    this.hideGhost();
    if (this.sel && !this.host.scene.document.floor.openings[this.sel.id]) this.select(null);
  }

  private onActiveFloor(): void {
    if (this.disposed) return;
    // The document already closed the gesture's undo step.
    if (this.gesture) this.endGesture(false);
    if (this.press) this.press.dead = true;
    this.restoreOrbit();
    this.hideGhost();
    this.report([]);
    this.select(null);
  }

  // --- drag ------------------------------------------------------------------------------

  private startGesture(drag: NonNullable<Press['drag']>): void {
    this.gesture = {
      key: `view-drag-${++this.gestureCount}`,
      id: drag.id,
      start: drag.start,
      grab: drag.grab,
      host: drag.start.wall,
    };
  }

  /**
   * Moves the dragged opening where the placement module puts it for the ray. Each step runs
   * from the start of the drag; an invalid spot leaves the document at the last valid one and
   * shows a red ghost with the reason in 'issues'.
   */
  private step(e: PointerEvent): void {
    const g = this.gesture!;
    const doc = this.host.scene.document;
    const floor = doc.floor;
    const cur = floor.openings[g.id];
    if (!cur) return;
    const target = this.dragHost(e, g, cur);
    if (!target) return;
    const placement = resolvePlacement(floor, {
      subject: { mount: 'opening', opening: g.start },
      point: target.point,
      reach: target.snapReach,
      snapReach: target.snapReach,
      grid: GRID,
      free: e.altKey,
      from: { wall: g.start.wall, grab: g.grab },
      wall: target.wall,
    });
    if (!placement) return;
    g.host = placement.wall;
    const { wall, offset, hinge, swing } = placement;
    const candidate: Opening = { ...g.start, wall, offset, hinge, swing };
    if (placement.issues.length > 0) {
      this.showGhost(candidate, true);
      this.report(placement.issues);
      return;
    }
    if (cur.wall === wall && cur.offset === offset && cur.hinge === hinge && cur.swing === swing) {
      this.hideGhost();
      this.report([]);
      return;
    }
    const res = this.issue(() =>
      doc.tryExecute(updateOpening(g.id, { wall, offset, hinge, swing }), {
        coalesceKey: g.key,
        restart: true,
      }),
    );
    if (res.ok) {
      this.hideGhost();
      this.report([]);
    } else {
      this.showGhost(candidate, true);
      this.report(res.issues);
    }
  }

  /**
   * The host and plan point for a drag step. The dragged opening's own meshes are left out of
   * the ray, but the pointer over it counts as its wall (its hole would let the ray through). A
   * wall hit (or another opening's) is the host; otherwise the ray meets the current host's plane.
   */
  private dragHost(
    e: PointerEvent,
    g: Gesture,
    cur: Opening,
  ): { wall: Id; point: Vec2; snapReach: number } | null {
    const ray = this.rayAt(e);
    const hits = this.hits(ray);
    const active = this.host.scene.document.activeFloorId;
    const floor = this.host.scene.document.floor;
    const own = (h: Hit): boolean => h.kind === 'opening' && h.id === g.id && h.floorId === active;
    const dragged = hits.find(own);
    const other = hits.find((h) => !own(h));
    if (dragged && (!other || dragged.distance <= other.distance)) {
      return this.target(cur.wall, dragged.point);
    }
    const wall = other ? this.hostWall(other) : undefined;
    if (other && wall !== undefined) return this.target(wall, other.point);
    const w = floor.walls[g.host] ? g.host : cur.wall;
    const p = this.onWallPlane(floor, w, ray);
    return p ? this.target(w, p) : null;
  }

  private target(wall: Id, p: Vector3): { wall: Id; point: Vec2; snapReach: number } {
    return { wall, point: planOf(p), snapReach: SNAP_PX * this.metresPerPixel(p) };
  }

  /** Where the ray meets the vertical plane through wall `id`'s centre line. */
  private onWallPlane(floor: Readonly<Floor>, id: Id, ray: Raycaster): Vector3 | null {
    const w = floor.walls[id];
    const a = w && floor.nodes[w.a];
    const b = w && floor.nodes[w.b];
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (Math.hypot(dx, dy) < 1e-12) return null;
    // Plan left normal (-dy, dx) is world (-dy, 0, -dx).
    const plane = new Plane().setFromNormalAndCoplanarPoint(
      new Vector3(-dy, 0, -dx).normalize(),
      new Vector3(a.x, floor.elevation, -a.y),
    );
    return ray.ray.intersectPlane(plane, new Vector3());
  }

  private endGesture(seal: boolean): void {
    if (!this.gesture) return;
    this.gesture = null;
    if (seal) this.host.scene.document.endCoalesce();
    this.hideGhost();
    this.report([]);
  }

  // --- placing ---------------------------------------------------------------------------

  /** The preset where the ray hits a wall of the active floor; null when it hits none. */
  private candidateAt(e: PointerEvent): { opening: Opening; placement: Placement } | null {
    const p = this.placement;
    const doc = this.host.scene.document;
    const info = p ? doc.presets(p.preset) : undefined;
    if (!p || info?.mount !== 'opening') return null;
    const hit = this.firstHit(e);
    const wall = hit ? this.hostWall(hit) : undefined;
    if (!hit || wall === undefined) return null;
    const subject = presetOpening(info, {
      id: '',
      wall: '',
      preset: p.preset,
      offset: 0,
      hinge: 'a',
      swing: 'left',
    });
    const t = this.target(wall, hit.point);
    const placement = resolvePlacement(doc.floor, {
      subject: { mount: 'opening', opening: subject },
      point: t.point,
      reach: t.snapReach,
      snapReach: t.snapReach,
      grid: GRID,
      free: e.altKey,
      wall,
    });
    if (!placement) return null;
    const { offset, hinge, swing } = placement;
    return { opening: { ...subject, wall, offset, hinge, swing }, placement };
  }

  private hover(e: PointerEvent): void {
    const c = this.candidateAt(e);
    const invalid = !!c && c.placement.issues.length > 0;
    if (c) this.showGhost(c.opening, invalid);
    else this.hideGhost();
    // A refusal stops applying once the pointer finds a valid spot or leaves the walls.
    if (!invalid) this.report([]);
  }

  /** Adds the preset where the press hit; false when it hit no wall (the press is orbit's). */
  private placeAt(e: PointerEvent): boolean {
    const p = this.placement!;
    const doc = this.host.scene.document;
    if (doc.presets(p.preset)?.mount !== 'opening') {
      this.report([
        { code: 'unknown-preset', ids: [], message: `Preset ${p.preset} is not an opening preset` },
      ]);
      return false;
    }
    const c = this.candidateAt(e);
    if (!c) return false;
    if (c.placement.issues.length > 0) {
      this.showGhost(c.opening, true);
      this.report(c.placement.issues);
      return true;
    }
    const { wall, offset, hinge, swing } = c.opening;
    const cmd = addOpening({ wall, preset: p.preset, offset, hinge, swing });
    const res = this.issue(() => doc.tryExecute(cmd));
    if (!res.ok) {
      this.report(res.issues);
      return true;
    }
    this.report([]);
    this.hideGhost();
    this.select({ kind: 'opening', id: cmd.createdId });
    return true;
  }

  // --- rays ------------------------------------------------------------------------------

  private rayAt(e: MouseEvent): Raycaster {
    const r = this.host.canvas.getBoundingClientRect();
    const size = this.host.size();
    const w = r.width || size.w;
    const h = r.height || size.h;
    const ndc = new Vector2(((e.clientX - r.left) / w) * 2 - 1, -((e.clientY - r.top) / h) * 2 + 1);
    const cam = this.host.camera();
    cam.updateMatrixWorld();
    this.raycaster.setFromCamera(ndc, cam);
    return this.raycaster;
  }

  /** Every shown mesh of the scene along the ray, nearest first. */
  private hits(ray: Raycaster): Hit[] {
    const root = this.host.scene.root;
    root.updateMatrixWorld();
    const found: Intersection[] = ray.intersectObject(root, true);
    const out: Hit[] = [];
    for (const i of found) {
      const o = i.object;
      const data = o.userData as { h3xKind?: string; h3xId?: Id; h3xFloorId?: Id };
      if (!(o instanceof Mesh) || data.h3xKind === undefined || !shown(o)) continue;
      out.push({
        kind: data.h3xKind,
        id: data.h3xId ?? '',
        floorId: data.h3xFloorId ?? '',
        point: i.point.clone(),
        distance: i.distance,
      });
    }
    return out;
  }

  /** The nearest shown thing under the pointer: what a press is on. */
  private firstHit(e: MouseEvent): Hit | undefined {
    return this.hits(this.rayAt(e))[0];
  }

  private isActiveOpening(h: Hit): boolean {
    return h.kind === 'opening' && h.floorId === this.host.scene.document.activeFloorId;
  }

  /** The wall a hit stands for: a wall of the active floor, or the wall of its opening. */
  private hostWall(h: Hit): Id | undefined {
    const doc = this.host.scene.document;
    if (h.floorId !== doc.activeFloorId) return undefined;
    const floor = doc.floor;
    if (h.kind === 'wall') return floor.walls[h.id] ? h.id : undefined;
    if (h.kind === 'opening') return floor.openings[h.id]?.wall;
    return undefined;
  }

  /** Metres one screen pixel spans at world point `p`. */
  private metresPerPixel(p: Vector3): number {
    const cam = this.host.camera();
    const r = this.host.canvas.getBoundingClientRect();
    const h = r.height || this.host.size().h;
    if ((cam as OrthographicCamera).isOrthographicCamera) {
      const o = cam as OrthographicCamera;
      return (o.top - o.bottom) / o.zoom / h;
    }
    const persp = cam as PerspectiveCamera;
    const depth = Math.max(-p.clone().applyMatrix4(persp.matrixWorldInverse).z, persp.near);
    return (2 * depth * Math.tan(MathUtils.degToRad(persp.fov / 2))) / persp.zoom / h;
  }

  // --- feedback --------------------------------------------------------------------------

  /** The cut volume of `o`: blue where it may go, red where it may not. */
  private showGhost(o: Opening, invalid: boolean): void {
    const floor = this.host.scene.document.floor;
    const g = openingGeometry(floor, o);
    if (!g) {
      this.hideGhost();
      return;
    }
    const parts = buildOpeningParts(floor, g);
    for (const geom of [parts.frame, parts.leaf, parts.glass]) geom?.dispose();
    this.disposeGhostGeometry();
    this.ghost.geometry = parts.pick;
    this.ghost.material = invalid ? this.ghostBad : this.ghostOk;
    this.ghost.visible = true;
    this.host.requestRender();
  }

  private hideGhost(): void {
    if (!this.ghost.visible) return;
    this.ghost.visible = false;
    this.disposeGhostGeometry();
    this.host.requestRender();
  }

  private disposeGhostGeometry(): void {
    const geom = this.ghost.geometry as BufferGeometry | undefined;
    geom?.dispose();
  }

  /** The issues of the last refused edit; `[]` clears (emitted only when something changes). */
  private report(issues: Issue[]): void {
    if (this.rejected.length === 0 && issues.length === 0) return;
    this.rejected = [...issues];
    this.host.emitIssues([...issues]);
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
