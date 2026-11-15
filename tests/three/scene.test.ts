import { Box3, BufferGeometry, type Material, type MeshStandardMaterial } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { H3xDocument, moveNode, setWallFinish, type Project } from '../../src/core';
import { H3xScene } from '../../src/three';
import { oneRoomFloor } from '../fixtures/floors';

function makeDoc(floor = oneRoomFloor()): H3xDocument {
  const project = { name: 'p', floors: [floor] } as unknown as Project;
  return H3xDocument.fromProject(project);
}

afterEach(() => vi.restoreAllMocks());

describe('H3xScene', () => {
  it('builds wall and floor meshes with userData', () => {
    const scene = new H3xScene(makeDoc());
    expect(scene.root.name).toBe('h3x-root');
    expect(scene.root.children.map((c) => c.name)).toEqual(['h3x-walls', 'h3x-floors', 'h3x-joins']);
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
});
