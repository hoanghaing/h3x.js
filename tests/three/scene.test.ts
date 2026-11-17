import {
  Box3,
  BufferGeometry,
  Group,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  H3xDocument,
  moveNode,
  removeFloor,
  setFloorHeight,
  setWallFinish,
  type Floor,
  type Project,
} from '../../src/core';
import { H3xScene, MaterialLibrary, type H3xViewMode } from '../../src/three';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';

function makeDoc(floor = oneRoomFloor()): H3xDocument {
  const project = { name: 'p', floors: [floor] } as unknown as Project;
  return H3xDocument.fromProject(project);
}

const floorGroup = (scene: H3xScene, id = 'f1'): Object3D =>
  scene.root.getObjectByName('h3x-floor-' + id)!;
const sub = (scene: H3xScene, name: string, id = 'f1'): Object3D =>
  floorGroup(scene, id).getObjectByName(name)!;

afterEach(() => vi.restoreAllMocks());

describe('H3xScene', () => {
  it('builds wall and floor meshes with userData', () => {
    const scene = new H3xScene(makeDoc());
    expect(scene.root.name).toBe('h3x-root');
    expect(scene.root.children.map((c) => c.name)).toEqual(['h3x-floor-f1']);
    expect(floorGroup(scene).children.map((c) => c.name)).toEqual([
      'h3x-walls',
      'h3x-floors',
      'h3x-joins',
      'h3x-columns',
      'h3x-stairs',
      'h3x-slab',
    ]);
    for (const id of ['w1', 'w2', 'w3', 'w4']) {
      const m = scene.getWallMesh(id)!;
      expect(m.userData).toEqual({ h3xKind: 'wall', h3xId: id, h3xFloorId: 'f1' });
      expect(m.castShadow && m.receiveShadow).toBe(true);
      expect(m.material).toHaveLength(3);
    }
    const f = scene.getFloorMesh('r1')!;
    expect(f.userData).toEqual({ h3xKind: 'room', h3xId: 'r1', h3xFloorId: 'f1' });
    expect(sub(scene, 'h3x-walls').children).toHaveLength(4);
    expect(sub(scene, 'h3x-floors').children).toHaveLength(1);
  });

  it('rebuilds once on moveNode and updates geometry', () => {
    const doc = makeDoc();
    const scene = new H3xScene(doc);
    const fn = vi.fn();
    scene.onInvalidate(fn);
    doc.execute(moveNode('n3', { x: 5, y: 4 }));
    expect(fn).toHaveBeenCalledTimes(1);
    const box = new Box3().setFromObject(scene.getWallMesh('w2')!);
    // mitered outer corner of the skewed w2/w3 join lies a little beyond x = 5.1
    expect(box.max.x).toBeGreaterThan(5.1);
    expect(box.max.x).toBeLessThan(5.2);
  });

  it('applies wall finish colours', () => {
    const doc = makeDoc();
    const scene = new H3xScene(doc);
    doc.execute(setWallFinish('w1', 'left', '#ff0000'));
    const mats = scene.getWallMesh('w1')!.material as Material[];
    expect((mats[0] as MeshStandardMaterial).color.getHexString()).toBe('ff0000');
  });

  it('rebuild disposes old geometries', () => {
    const doc = makeDoc();
    new H3xScene(doc);
    const spy = vi.spyOn(BufferGeometry.prototype, 'dispose');
    doc.execute(moveNode('n3', { x: 5, y: 4 }));
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(5);
  });

  it('survives a degenerate room', () => {
    const floor = oneRoomFloor();
    // bow-tie outline (zero signed area); fromProject only normalizes orientation
    floor.nodes.n3 = { id: 'n3', x: 0, y: 4 };
    floor.nodes.n4 = { id: 'n4', x: 4, y: 4 };
    let scene!: H3xScene;
    expect(() => (scene = new H3xScene(makeDoc(floor)))).not.toThrow();
    expect(sub(scene, 'h3x-walls').children).toHaveLength(4);
    expect(sub(scene, 'h3x-floors').children).toHaveLength(0);
  });

  it('dispose unsubscribes and empties the root', () => {
    const doc = makeDoc();
    const scene = new H3xScene(doc);
    const fn = vi.fn();
    scene.onInvalidate(fn);
    scene.dispose();
    doc.execute(moveNode('n3', { x: 5, y: 4 }));
    expect(fn).not.toHaveBeenCalled();
    expect(scene.getWallMesh('w1')).toBeUndefined();
    expect(scene.root.children).toHaveLength(0);
  });

  it('runs all listeners then rethrows a listener error', () => {
    const scene = new H3xScene(makeDoc());
    const second = vi.fn();
    scene.onInvalidate(() => {
      throw new Error('boom');
    });
    scene.onInvalidate(second);
    expect(() => scene.rebuild()).toThrow('boom');
    expect(second).toHaveBeenCalled();
  });

  it('keeps mesh identity across rebuilds', () => {
    const doc = makeDoc(twoRoomFloor());
    const scene = new H3xScene(doc);
    const wall = scene.getWallMesh('w2')!;
    const floor = scene.getFloorMesh('r2')!;
    const join = sub(scene, 'h3x-joins').children[0]!;
    const oldGeom = wall.geometry;
    const spy = vi.spyOn(oldGeom, 'dispose');
    doc.execute(moveNode('n3', { x: 9, y: 0 }));
    expect(scene.getWallMesh('w2')).toBe(wall);
    expect(scene.getFloorMesh('r2')).toBe(floor);
    expect(sub(scene, 'h3x-joins').children[0]).toBe(join);
    expect(wall.geometry).not.toBe(oldGeom);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(sub(scene, 'h3x-walls').children).toHaveLength(7);
  });

  it('updates materials in place on a finish change', () => {
    const doc = makeDoc();
    const scene = new H3xScene(doc);
    const mesh = scene.getWallMesh('w1')!;
    doc.execute(setWallFinish('w1', 'left', '#00ff00'));
    expect(scene.getWallMesh('w1')).toBe(mesh);
    const mats = mesh.material as Material[];
    expect((mats[0] as MeshStandardMaterial).color.getHexString()).toBe('00ff00');
  });

  it('removes meshes whose ids disappear', () => {
    const doc = makeDoc(twoRoomFloor());
    const scene = new H3xScene(doc);
    const w1 = scene.getWallMesh('w1');
    // Simulate a topology change by editing the live floor, then rebuild.
    const floor = doc.floor as Floor;
    delete floor.walls.w7;
    delete floor.rooms.r2;
    scene.rebuild();
    expect(scene.getWallMesh('w7')).toBeUndefined();
    expect(scene.getFloorMesh('r2')).toBeUndefined();
    expect(scene.getWallMesh('w1')).toBe(w1);
    expect(sub(scene, 'h3x-walls').children).toHaveLength(6);
    expect(sub(scene, 'h3x-joins').children).toHaveLength(0);
  });

  it('dispose is idempotent and does not dispose materials twice', () => {
    const scene = new H3xScene(makeDoc());
    const spy = vi.spyOn(MaterialLibrary.prototype, 'dispose');
    scene.dispose();
    scene.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rebuild after dispose creates nothing and does not notify', () => {
    const scene = new H3xScene(makeDoc());
    const fn = vi.fn();
    scene.onInvalidate(fn);
    scene.dispose();
    scene.rebuild();
    expect(fn).not.toHaveBeenCalled();
    expect(scene.getWallMesh('w1')).toBeUndefined();
    expect(scene.root.children).toHaveLength(0);
  });

  it('keeps extra objects added to root across rebuilds', () => {
    const doc = makeDoc();
    const scene = new H3xScene(doc);
    const extra = new Group();
    scene.root.add(extra);
    doc.execute(moveNode('n3', { x: 5, y: 4 }));
    expect(extra.parent).toBe(scene.root);
  });
});

/** Three stacked copies of oneRoomFloor (f0, f1, f2): every floor has w1..w4 and r1. */
function threeFloorDoc(): H3xDocument {
  const floors = ['f0', 'f1', 'f2'].map((id, level) => ({ ...oneRoomFloor(), id, level }));
  floors[1]!.slabThickness = 0.2;
  return H3xDocument.fromProject({ name: 'p', floors } as unknown as Project);
}

const visible = (scene: H3xScene): string[] =>
  ['f0', 'f1', 'f2'].filter((id) => floorGroup(scene, id).visible);

describe('H3xScene with several floors', () => {
  it('builds one group per floor with stacked slabs and walls', () => {
    const doc = threeFloorDoc();
    const scene = new H3xScene(doc);
    expect(scene.root.children.map((c) => c.name)).toEqual([
      'h3x-floor-f0',
      'h3x-floor-f1',
      'h3x-floor-f2',
    ]);
    for (const f of doc.project.floors) {
      const g = floorGroup(scene, f.id);
      expect(g.userData.h3xFloorId).toBe(f.id);
      const slab = scene.getSlabMesh(f.id)!;
      expect(slab.userData).toEqual({ h3xKind: 'slab', h3xId: f.id, h3xFloorId: f.id });
      expect(slab.parent).toBe(g);
      const box = new Box3().setFromObject(slab);
      expect(box.min.y).toBeCloseTo(f.elevation - f.slabThickness, 6);
      expect(box.max.y).toBeCloseTo(f.elevation, 6);
      const wall = new Box3().setFromObject(scene.getWallMesh('w2', f.id)!);
      expect(wall.min.y).toBeCloseTo(f.elevation, 6);
    }
    const [f0, f1, f2] = doc.project.floors;
    expect(f1!.elevation).toBeGreaterThan(f0!.elevation);
    expect(f2!.elevation).toBeGreaterThan(f1!.elevation);
    // no floorId -> the active (ground) floor
    expect(scene.getSlabMesh()).toBe(scene.getSlabMesh('f0'));
    expect(scene.getWallMesh('w1')).toBe(scene.getWallMesh('w1', 'f0'));
    expect(scene.getFloorMesh('r1')).toBe(scene.getFloorMesh('r1', 'f0'));
  });

  it('tags every floor mesh with userData.h3xFloorId', () => {
    const doc = threeFloorDoc();
    const scene = new H3xScene(doc);
    for (const f of doc.project.floors) {
      let meshes = 0;
      floorGroup(scene, f.id).traverse((o) => {
        if (!(o as { isMesh?: boolean }).isMesh) return;
        meshes++;
        expect(o.userData.h3xFloorId).toBe(f.id);
        expect(o.userData.h3xKind).toBeDefined();
      });
      expect(meshes).toBeGreaterThan(5);
    }
  });

  it('removing the active floor in active mode never invalidates with every floor hidden', () => {
    const doc = threeFloorDoc();
    doc.setActiveFloor('f2');
    const scene = new H3xScene(doc);
    scene.setViewMode('active');
    const hidden: boolean[] = [];
    scene.onInvalidate(() => {
      hidden.push(doc.project.floors.every((f) => !floorGroup(scene, f.id).visible));
    });
    doc.execute(removeFloor('f2'));
    expect(doc.activeFloorId).toBe('f1');
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden).not.toContain(true);
    expect(floorGroup(scene, 'f1').visible).toBe(true);
    expect(floorGroup(scene, 'f0').visible).toBe(false);
  });

  it('keeps meshes of the same id on different floors distinct', () => {
    const scene = new H3xScene(threeFloorDoc());
    const a = scene.getWallMesh('w1', 'f0')!;
    const b = scene.getWallMesh('w1', 'f1')!;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
    expect(a.geometry).not.toBe(b.geometry);
    expect(scene.getWallMesh('w1', 'nope')).toBeUndefined();
  });

  it('view modes toggle floor visibility', () => {
    const doc = threeFloorDoc();
    doc.setActiveFloor('f1');
    const scene = new H3xScene(doc);
    expect(scene.viewMode).toBe('all');
    expect(visible(scene)).toEqual(['f0', 'f1', 'f2']);
    const fn = vi.fn();
    scene.onInvalidate(fn);
    const expected: [H3xViewMode, string[]][] = [
      ['active', ['f1']],
      ['cutaway', ['f0', 'f1']],
      ['all', ['f0', 'f1', 'f2']],
    ];
    const geom = scene.getWallMesh('w1', 'f1')!.geometry;
    for (const [mode, ids] of expected) {
      scene.setViewMode(mode);
      expect(scene.viewMode).toBe(mode);
      expect(visible(scene)).toEqual(ids);
    }
    expect(fn).toHaveBeenCalledTimes(3);
    expect(scene.getWallMesh('w1', 'f1')!.geometry).toBe(geom);
  });

  it('setActiveFloor updates visibility in the current mode', () => {
    const doc = threeFloorDoc();
    const scene = new H3xScene(doc);
    scene.setViewMode('cutaway');
    expect(visible(scene)).toEqual(['f0']);
    const fn = vi.fn();
    scene.onInvalidate(fn);
    doc.setActiveFloor('f2');
    expect(visible(scene)).toEqual(['f0', 'f1', 'f2']);
    scene.setViewMode('active');
    doc.setActiveFloor('f1');
    expect(visible(scene)).toEqual(['f1']);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('a change on one floor rebuilds only that floor', () => {
    const doc = threeFloorDoc();
    doc.setActiveFloor('f1');
    const scene = new H3xScene(doc);
    const other = scene.getWallMesh('w2', 'f0')!.geometry;
    const own = scene.getWallMesh('w2', 'f1')!.geometry;
    doc.execute(moveNode('n3', { x: 5, y: 4 }));
    expect(scene.getWallMesh('w2', 'f0')!.geometry).toBe(other);
    expect(scene.getWallMesh('w2', 'f1')!.geometry).not.toBe(own);
  });

  it('setFloorHeight rebuilds floors whose elevation changed', () => {
    const doc = threeFloorDoc();
    const scene = new H3xScene(doc);
    const ground = scene.getWallMesh('w2', 'f0')!.geometry;
    doc.execute(setFloorHeight('f0', 4));
    // f0 itself (wallHeight changed) and the floors above (elevation changed) are rebuilt
    expect(scene.getWallMesh('w2', 'f0')!.geometry).not.toBe(ground);
    for (const f of doc.project.floors.slice(1)) {
      const slab = new Box3().setFromObject(scene.getSlabMesh(f.id)!);
      expect(slab.max.y).toBeCloseTo(f.elevation, 6);
      const wall = new Box3().setFromObject(scene.getWallMesh('w2', f.id)!);
      expect(wall.min.y).toBeCloseTo(f.elevation, 6);
    }
  });

  it('removeFloor disposes the floor group and its geometries', () => {
    const doc = threeFloorDoc();
    const scene = new H3xScene(doc);
    const group = floorGroup(scene, 'f2');
    const geoms: BufferGeometry[] = [];
    group.traverse((o) => {
      const g = (o as { geometry?: BufferGeometry }).geometry;
      if (g) geoms.push(g);
    });
    const spies = geoms.map((g) => vi.spyOn(g, 'dispose'));
    expect(geoms.length).toBeGreaterThan(5);
    doc.execute(removeFloor('f2'));
    expect(group.parent).toBeNull();
    expect(scene.root.getObjectByName('h3x-floor-f2')).toBeUndefined();
    expect(scene.getWallMesh('w1', 'f2')).toBeUndefined();
    for (const s of spies) expect(s).toHaveBeenCalled();
    doc.undo();
    expect(scene.getWallMesh('w1', 'f2')).toBeDefined();
    expect(scene.root.children.map((c) => c.name)).toEqual([
      'h3x-floor-f0',
      'h3x-floor-f1',
      'h3x-floor-f2',
    ]);
  });
});
