import { Box3, BufferGeometry, Group, type Material, type MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { H3xDocument, moveNode, setWallFinish, type Floor, type Project } from '../../src/core';
import { H3xScene, MaterialLibrary } from '../../src/three';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';

function makeDoc(floor = oneRoomFloor()): H3xDocument {
  const project = { name: 'p', floors: [floor] } as unknown as Project;
  return H3xDocument.fromProject(project);
}

afterEach(() => vi.restoreAllMocks());

describe('H3xScene', () => {
  it('builds wall and floor meshes with userData', () => {
    const scene = new H3xScene(makeDoc());
    expect(scene.root.name).toBe('h3x-root');
    expect(scene.root.children.map((c) => c.name)).toEqual([
      'h3x-walls',
      'h3x-floors',
      'h3x-joins',
      'h3x-columns',
    ]);
    for (const id of ['w1', 'w2', 'w3', 'w4']) {
      const m = scene.getWallMesh(id)!;
      expect(m.userData).toEqual({ h3xKind: 'wall', h3xId: id });
      expect(m.castShadow && m.receiveShadow).toBe(true);
      expect(m.material).toHaveLength(3);
    }
    const f = scene.getFloorMesh('r1')!;
    expect(f.userData).toEqual({ h3xKind: 'room', h3xId: 'r1' });
    expect(scene.root.children[0]!.children).toHaveLength(4);
    expect(scene.root.children[1]!.children).toHaveLength(1);
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
    expect(scene.root.children[0]!.children).toHaveLength(4);
    expect(scene.root.children[1]!.children).toHaveLength(0);
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
    expect(scene.root.children.every((g) => g.children.length === 0)).toBe(true);
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
    const join = scene.root.getObjectByName('h3x-joins')!.children[0]!;
    const oldGeom = wall.geometry;
    const spy = vi.spyOn(oldGeom, 'dispose');
    doc.execute(moveNode('n3', { x: 9, y: 0 }));
    expect(scene.getWallMesh('w2')).toBe(wall);
    expect(scene.getFloorMesh('r2')).toBe(floor);
    expect(scene.root.getObjectByName('h3x-joins')!.children[0]).toBe(join);
    expect(wall.geometry).not.toBe(oldGeom);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(scene.root.children[0]!.children).toHaveLength(7);
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
    expect(scene.root.children[0]!.children).toHaveLength(6);
    expect(scene.root.getObjectByName('h3x-joins')!.children).toHaveLength(0);
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
    expect(scene.root.children.every((g) => g.children.length === 0)).toBe(true);
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
