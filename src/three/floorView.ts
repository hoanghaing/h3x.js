import { Group, Mesh, type BufferGeometry } from 'three';
import { layoutStair, stairRise, type Floor, type Id, type Vec2 } from '../core';
import { buildColumnGeometry } from './columns';
import { buildFloorGeometry } from './floors';
import type { MaterialLibrary } from './materials';
import { buildSlabGeometry } from './slab';
import { buildHandrailGeometry, buildStairGeometry } from './stairs';
import { buildJoinGeometry } from './walls/joinGeometry';
import { computeJoins } from './walls/joins';
import { buildWallGeometry } from './walls/wallGeometry';

/**
 * userData.h3xKind of the meshes an H3xScene creates. Every mesh also carries
 * `userData.h3xId` (entity id, unique only within its floor) and `userData.h3xFloorId`.
 */
export type H3xKind = 'wall' | 'room' | 'join' | 'column' | 'slab' | 'stair';

/** What a floor's geometry needs from its neighbours. */
export interface FloorContext {
  /** The floor above (stairs climb to it; none: stairs are not drawn). */
  above?: Readonly<Floor>;
  /** Plan polygons cut out of the slab and room floors (the stair bays of the floor below). */
  openings?: Vec2[][];
}

interface Built {
  geom: BufferGeometry;
  material: Mesh['material'];
}

/**
 * The meshes of one floor, under one Group (`h3x-floor-<id>`, at the origin: geometry
 * already bakes in the floor elevation). Internal to H3xScene.
 */
export class FloorView {
  readonly group = new Group();
  private readonly wallsGroup = new Group();
  private readonly floorsGroup = new Group();
  private readonly joinsGroup = new Group();
  private readonly columnsGroup = new Group();
  private readonly stairsGroup = new Group();
  readonly wallMeshes = new Map<Id, Mesh>();
  readonly floorMeshes = new Map<Id, Mesh>();
  private readonly joinMeshes = new Map<Id, Mesh>();
  readonly columnMeshes = new Map<Id, Mesh>();
  private readonly slabMeshes = new Map<Id, Mesh>();
  /** Main stair mass per stair id; the handrail is a separate mesh (same userData). */
  readonly stairMeshes = new Map<Id, Mesh>();
  private readonly railMeshes = new Map<Id, Mesh>();

  constructor(
    readonly floorId: Id,
    private readonly materials: MaterialLibrary,
  ) {
    this.group.name = 'h3x-floor-' + floorId;
    this.group.userData = { h3xFloorId: floorId };
    this.wallsGroup.name = 'h3x-walls';
    this.floorsGroup.name = 'h3x-floors';
    this.joinsGroup.name = 'h3x-joins';
    this.columnsGroup.name = 'h3x-columns';
    this.stairsGroup.name = 'h3x-stairs';
    this.group.add(
      this.wallsGroup,
      this.floorsGroup,
      this.joinsGroup,
      this.columnsGroup,
      this.stairsGroup,
    );
  }

  get slabMesh(): Mesh | undefined {
    return this.slabMeshes.get(this.floorId);
  }

  /**
   * Rebuilds this floor's geometry. Meshes keep their identity per id: geometry is
   * swapped (old one disposed) and materials are updated in place; meshes are only
   * created or removed when ids appear or disappear.
   */
  rebuild(floor: Readonly<Floor>, ctx: FloorContext = {}): void {
    const f = floor as Floor;
    const openings = ctx.openings ?? [];
    const { corners, junctions } = computeJoins(f);

    const walls = new Map<Id, Built>();
    for (const wall of Object.values(f.walls)) {
      const wallCorners = corners[wall.id];
      if (!wallCorners) continue;
      walls.set(wall.id, {
        geom: buildWallGeometry(f, wall.id, wallCorners),
        material: [
          this.materials.wall(wall.finishLeft),
          this.materials.wall(wall.finishRight),
          this.materials.trim(),
        ],
      });
    }
    const floors = new Map<Id, Built>();
    for (const room of Object.values(f.rooms)) {
      const geom = buildFloorGeometry(f, room, openings);
      if (geom) floors.set(room.id, { geom, material: this.materials.floor(room.floorFinish) });
    }
    const joins = new Map<Id, Built>();
    for (const [nodeId, junction] of Object.entries(junctions)) {
      joins.set(nodeId, {
        geom: buildJoinGeometry(junction, f.elevation),
        material: this.materials.trim(),
      });
    }
    const columns = new Map<Id, Built>();
    for (const column of Object.values(f.columns)) {
      columns.set(column.id, {
        geom: buildColumnGeometry(f, column),
        material: this.materials.wall(),
      });
    }
    const slabs = new Map<Id, Built>();
    const slab = buildSlabGeometry(f, openings);
    if (slab) slabs.set(this.floorId, { geom: slab, material: this.materials.trim() });
    const stairs = new Map<Id, Built>();
    const rails = new Map<Id, Built>();
    const rise = stairRise(f, ctx.above as Floor | undefined);
    for (const stair of Object.values(f.stairs)) {
      const layout = layoutStair(stair, rise);
      if (!layout.ok) continue; // no floor above / does not fit: no stair mesh
      stairs.set(stair.id, {
        geom: buildStairGeometry(layout, f),
        material: this.materials.wall(),
      });
      const rail = buildHandrailGeometry(layout, f);
      if (rail) rails.set(stair.id, { geom: rail, material: this.materials.trim() });
    }

    sync(this.wallMeshes, this.wallsGroup, 'wall', this.floorId, walls);
    sync(this.floorMeshes, this.floorsGroup, 'room', this.floorId, floors);
    sync(this.joinMeshes, this.joinsGroup, 'join', this.floorId, joins);
    sync(this.columnMeshes, this.columnsGroup, 'column', this.floorId, columns);
    sync(this.slabMeshes, this.group, 'slab', this.floorId, slabs);
    sync(this.stairMeshes, this.stairsGroup, 'stair', this.floorId, stairs);
    sync(this.railMeshes, this.stairsGroup, 'stair', this.floorId, rails);
    if (this.slabMesh) this.slabMesh.name = 'h3x-slab';
    for (const m of this.stairMeshes.values()) m.name = 'h3x-stair';
    for (const m of this.railMeshes.values()) m.name = 'h3x-handrail';
  }

  /** Disposes every geometry and detaches the group. Materials belong to the library. */
  dispose(): void {
    for (const meshes of [
      this.wallMeshes,
      this.floorMeshes,
      this.joinMeshes,
      this.columnMeshes,
      this.slabMeshes,
      this.stairMeshes,
      this.railMeshes,
    ]) {
      for (const mesh of meshes.values()) {
        mesh.geometry.dispose();
        mesh.removeFromParent();
      }
      meshes.clear();
    }
    this.group.removeFromParent();
  }
}

function sync(
  meshes: Map<Id, Mesh>,
  group: Group,
  kind: H3xKind,
  floorId: Id,
  built: Map<Id, Built>,
): void {
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
    created.userData = { h3xKind: kind, h3xId: id, h3xFloorId: floorId };
    group.add(created);
    meshes.set(id, created);
  }
}
