import { Group, Mesh, type BufferGeometry } from 'three';
import type { ChangeEvent, H3xDocument, Id } from '../core';
import { buildFloorGeometry } from './floors';
import { MaterialLibrary, type FinishResolver } from './materials';
import { computeWallCorners } from './walls/joins';
import { buildWallGeometry } from './walls/wallGeometry';

const GEOMETRY_KINDS = new Set(['node', 'wall', 'opening', 'room']);

/** A three.js scene graph (walls + floors) kept in sync with an H3xDocument. */
export class H3xScene {
  readonly root = new Group();
  private readonly wallsGroup = new Group();
  private readonly floorsGroup = new Group();
  private readonly materials: MaterialLibrary;
  private readonly ownsMaterials: boolean;
  private readonly wallMeshes = new Map<Id, Mesh>();
  private readonly floorMeshes = new Map<Id, Mesh>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly doc: H3xDocument,
    opts: { materials?: MaterialLibrary; resolveFinish?: FinishResolver } = {},
  ) {
    this.ownsMaterials = !opts.materials;
    this.materials = opts.materials ?? new MaterialLibrary({ resolveFinish: opts.resolveFinish });
    this.root.name = 'h3x-root';
    this.wallsGroup.name = 'h3x-walls';
    this.floorsGroup.name = 'h3x-floors';
    this.root.add(this.wallsGroup, this.floorsGroup);
    this.rebuild();
    this.unsubscribe = doc.on('change', (e: ChangeEvent) => {
      if (e.changes.some((c) => GEOMETRY_KINDS.has(c.kind))) this.rebuild();
    });
  }

  getWallMesh(id: Id): Mesh | undefined {
    return this.wallMeshes.get(id);
  }

  getFloorMesh(roomId: Id): Mesh | undefined {
    return this.floorMeshes.get(roomId);
  }

  /** Subscribe to rebuilds. Returns an unsubscribe function. */
  onInvalidate(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  rebuild(): void {
    this.clear();
    const floor = this.doc.floor;
    const corners = computeWallCorners(floor);
    for (const wall of Object.values(floor.walls)) {
      const id = wall.id;
      const wallCorners = corners[id];
      if (!wallCorners) continue;
      const geom = buildWallGeometry(floor, id, wallCorners);
      const mesh = this.makeMesh(geom, [
        this.materials.wall(wall.finishLeft),
        this.materials.wall(wall.finishRight),
        this.materials.trim(),
      ]);
      mesh.userData = { h3xKind: 'wall', h3xId: id };
      this.wallsGroup.add(mesh);
      this.wallMeshes.set(id, mesh);
    }
    for (const room of Object.values(floor.rooms)) {
      const id = room.id;
      const geom = buildFloorGeometry(floor, room);
      if (!geom) continue;
      const mesh = this.makeMesh(geom, this.materials.floor(room.floorFinish));
      mesh.userData = { h3xKind: 'room', h3xId: id };
      this.floorsGroup.add(mesh);
      this.floorMeshes.set(id, mesh);
    }
    this.notify();
  }

  dispose(): void {
    this.unsubscribe();
    this.clear();
    this.listeners.clear();
    if (this.ownsMaterials) this.materials.dispose();
  }

  private makeMesh(geom: BufferGeometry, material: Mesh['material']): Mesh {
    const mesh = new Mesh(geom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private clear(): void {
    for (const mesh of [...this.wallMeshes.values(), ...this.floorMeshes.values()]) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.wallMeshes.clear();
    this.floorMeshes.clear();
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
