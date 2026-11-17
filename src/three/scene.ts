import { Group, type LineLoop, type Mesh } from 'three';
import type { ChangeEvent, H3xDocument, Id } from '../core';
import { FloorView } from './floorView';
import { MaterialLibrary, type FinishResolver } from './materials';
import { buildSiteLine } from './site';

export type { H3xKind } from './floorView';

const FLOOR_GEOMETRY_KINDS = new Set(['node', 'wall', 'opening', 'room', 'column', 'floor']);

/**
 * Which floors are visible: `'active'` only the active floor, `'cutaway'` the active floor
 * and every floor below it, `'all'` the whole house.
 */
export type H3xViewMode = 'active' | 'cutaway' | 'all';

/**
 * A three.js scene graph kept in sync with an H3xDocument: one Group per floor
 * (`h3x-floor-<id>`, lowest first) holding its walls, room floors, joins, columns and slab,
 * plus the site line on the root.
 */
export class H3xScene {
  readonly root = new Group();
  private siteLine: LineLoop | undefined;
  private readonly materials: MaterialLibrary;
  private readonly ownsMaterials: boolean;
  private readonly views = new Map<Id, FloorView>();
  private mode: H3xViewMode = 'all';
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeActive: () => void;
  private disposed = false;

  constructor(
    private readonly doc: H3xDocument,
    opts: { materials?: MaterialLibrary; resolveFinish?: FinishResolver } = {},
  ) {
    this.ownsMaterials = !opts.materials;
    this.materials = opts.materials ?? new MaterialLibrary({ resolveFinish: opts.resolveFinish });
    this.root.name = 'h3x-root';
    this.rebuild();
    this.unsubscribe = doc.on('change', (e: ChangeEvent) => this.onChange(e));
    this.unsubscribeActive = doc.on('activefloor', () => {
      if (this.disposed) return;
      this.applyVisibility();
      this.notify();
    });
  }

  get viewMode(): H3xViewMode {
    return this.mode;
  }

  /** Changes which floors are visible. No geometry is rebuilt; fires onInvalidate. */
  setViewMode(mode: H3xViewMode): void {
    this.mode = mode;
    if (this.disposed) return;
    this.applyVisibility();
    this.notify();
  }

  getWallMesh(id: Id, floorId?: Id): Mesh | undefined {
    return this.view(floorId)?.wallMeshes.get(id);
  }

  getColumnMesh(id: Id, floorId?: Id): Mesh | undefined {
    return this.view(floorId)?.columnMeshes.get(id);
  }

  getFloorMesh(roomId: Id, floorId?: Id): Mesh | undefined {
    return this.view(floorId)?.floorMeshes.get(roomId);
  }

  getSlabMesh(floorId?: Id): Mesh | undefined {
    return this.view(floorId)?.slabMesh;
  }

  /** Subscribe to rebuilds and visibility changes. Returns an unsubscribe function. */
  onInvalidate(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Rebuilds every floor from the document. A no-op after dispose(). */
  rebuild(): void {
    if (this.disposed) return;
    this.syncFloors(null);
    this.syncSite();
    this.notify();
  }

  /** Idempotent. Does not dispose a MaterialLibrary passed in through the options. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.unsubscribeActive();
    this.removeSite();
    for (const view of this.views.values()) view.dispose();
    this.views.clear();
    this.listeners.clear();
    if (this.ownsMaterials) this.materials.dispose();
  }

  private view(floorId: Id = this.doc.activeFloorId): FloorView | undefined {
    return this.views.get(floorId);
  }

  private onChange(e: ChangeEvent): void {
    const touched = new Set<Id>();
    let site = false;
    for (const c of e.changes) {
      if (c.kind === 'site') site = true;
      else if (FLOOR_GEOMETRY_KINDS.has(c.kind) && c.floorId !== undefined) touched.add(c.floorId);
    }
    if (touched.size === 0 && !site) return;
    // The active floor was removed: the 'activefloor' event that follows sets visibility
    // and notifies, so no frame is drawn with every floor hidden.
    const activeGone = !this.doc.floorById(this.doc.activeFloorId);
    if (touched.size > 0) this.syncFloors(e.reason === 'load' ? null : touched, !activeGone);
    if (site) this.syncSite();
    if (!activeGone) this.notify();
  }

  /**
   * Adds / removes floor views to match the document, rebuilds the touched floors
   * (all when `touched` is null) plus any new ones, and restores level order and visibility.
   */
  private syncFloors(touched: Set<Id> | null, visibility = true): void {
    const floors = this.doc.project.floors;
    const ids = new Set(floors.map((f) => f.id));
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      view.dispose();
      this.views.delete(id);
    }
    for (const floor of floors) {
      let view = this.views.get(floor.id);
      const fresh = !view;
      if (!view) {
        view = new FloorView(floor.id, this.materials);
        this.views.set(floor.id, view);
      }
      if (fresh || !touched || touched.has(floor.id)) view.rebuild(floor);
    }
    // Re-add in level order, keeping foreign objects (and the site line) after the floors.
    const groups = floors.map((f) => this.views.get(f.id)!.group);
    const others = this.root.children.filter((c) => !groups.includes(c as Group));
    for (const g of groups) g.removeFromParent();
    for (const o of others) o.removeFromParent();
    this.root.add(...groups, ...others);
    if (visibility) this.applyVisibility();
  }

  private applyVisibility(): void {
    const floors = this.doc.project.floors;
    const active = floors.findIndex((f) => f.id === this.doc.activeFloorId);
    floors.forEach((floor, i) => {
      const view = this.views.get(floor.id);
      if (!view) return;
      view.group.visible =
        this.mode === 'all' || (this.mode === 'active' ? i === active : i <= active);
    });
  }

  private syncSite(): void {
    this.removeSite();
    const site = this.doc.project.site;
    if (!site) return;
    this.siteLine = buildSiteLine(site);
    this.root.add(this.siteLine);
  }

  private removeSite(): void {
    if (!this.siteLine) return;
    this.siteLine.geometry.dispose();
    (this.siteLine.material as { dispose(): void }).dispose();
    this.siteLine.removeFromParent();
    this.siteLine = undefined;
  }

  /** Runs every listener, then rethrows the first error (mirrors the document emitter). */
  private notify(): void {
    let error: unknown;
    let failed = false;
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    }
    if (failed) throw error;
  }
}
