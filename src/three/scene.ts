import { Group, Mesh, type BufferGeometry } from 'three';
import type { ChangeEvent, H3xDocument, Id } from '../core';
import { buildFloorGeometry } from './floors';
import { MaterialLibrary, type FinishResolver } from './materials';
import { buildJoinGeometry } from './walls/joinGeometry';
import { computeJoins } from './walls/joins';
import { buildWallGeometry } from './walls/wallGeometry';

const GEOMETRY_KINDS = new Set(['node', 'wall', 'opening', 'room']);

/** userData.h3xKind of the meshes an H3xScene creates. */
export type H3xKind = 'wall' | 'room' | 'join';

interface Built {
  geom: BufferGeometry;
  material: Mesh['material'];
}

/** A three.js scene graph (walls + floors) kept in sync with an H3xDocument. */
export class H3xScene {
  readonly root = new Group();
  private readonly wallsGroup = new Group();
  private readonly floorsGroup = new Group();
  private readonly joinsGroup = new Group();
  private readonly materials: MaterialLibrary;
  private readonly ownsMaterials: boolean;
  private readonly wallMeshes = new Map<Id, Mesh>();
  private readonly floorMeshes = new Map<Id, Mesh>();
  private readonly joinMeshes = new Map<Id, Mesh>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(
    private readonly doc: H3xDocument,
    opts: { materials?: MaterialLibrary; resolveFinish?: FinishResolver } = {},
  ) {
    this.ownsMaterials = !opts.materials;
    this.materials = opts.materials ?? new MaterialLibrary({ resolveFinish: opts.resolveFinish });
    this.root.name = 'h3x-root';
    this.wallsGroup.name = 'h3x-walls';
    this.floorsGroup.name = 'h3x-floors';
    this.joinsGroup.name = 'h3x-joins';
    this.root.add(this.wallsGroup, this.floorsGroup, this.joinsGroup);
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

  /**
   * Rebuilds all geometry from the document. Meshes keep their identity per id:
   * geometry is swapped (old one disposed) and materials are updated in place;
   * meshes are only created or removed when ids appear or disappear.
   * A no-op after dispose().
   */
  rebuild(): void {
    if (this.disposed) return;
    const floor = this.doc.floor;
    const { corners, junctions } = computeJoins(floor);

    const walls = new Map<Id, Built>();
    for (const wall of Object.values(floor.walls)) {
      const wallCorners = corners[wall.id];
      if (!wallCorners) continue;
      walls.set(wall.id, {
        geom: buildWallGeometry(floor, wall.id, wallCorners),
        material: [
          this.materials.wall(wall.finishLeft),
          this.materials.wall(wall.finishRight),
          this.materials.trim(),
        ],
      });
    }
    const floors = new Map<Id, Built>();
    for (const room of Object.values(floor.rooms)) {
      const geom = buildFloorGeometry(floor, room);
      if (geom) floors.set(room.id, { geom, material: this.materials.floor(room.floorFinish) });
    }
    const joins = new Map<Id, Built>();
    for (const [nodeId, junction] of Object.entries(junctions)) {
      joins.set(nodeId, {
        geom: buildJoinGeometry(junction, floor.elevation),
        material: this.materials.trim(),
      });
    }

    this.sync(this.wallMeshes, this.wallsGroup, 'wall', walls);
    this.sync(this.floorMeshes, this.floorsGroup, 'room', floors);
    this.sync(this.joinMeshes, this.joinsGroup, 'join', joins);
    this.notify();
  }

  /** Idempotent. Does not dispose a MaterialLibrary passed in through the options. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.clear();
    this.listeners.clear();
    if (this.ownsMaterials) this.materials.dispose();
  }

  private sync(meshes: Map<Id, Mesh>, group: Group, kind: H3xKind, built: Map<Id, Built>): void {
    for (const [id, mesh] of meshes) {
      if (built.has(id)) continue;
      mesh.geometry.dispose();
      mesh.removeFromParent();
      meshes.delete(id);
    }
    for (const [id, { geom, material }] of built) {
      const mesh = meshes.get(id);
      if (mesh) {
        const old = mesh.geometry;
        mesh.geometry = geom;
        mesh.material = material;
        old.dispose();
        continue;
      }
      const created = new Mesh(geom, material);
      created.castShadow = true;
      created.receiveShadow = true;
      created.userData = { h3xKind: kind, h3xId: id };
      group.add(created);
      meshes.set(id, created);
    }
  }

  private clear(): void {
    for (const mesh of [
      ...this.wallMeshes.values(),
      ...this.floorMeshes.values(),
      ...this.joinMeshes.values(),
    ]) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.wallMeshes.clear();
    this.floorMeshes.clear();
    this.joinMeshes.clear();
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
