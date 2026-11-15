// @vitest-environment jsdom
import { Box3, Sphere, Vector3, type Camera, type Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { H3xDocument, type Project } from '../../src/core';
import { H3xScene, H3xViewer, type RendererLike } from '../../src/three';
import { oneRoomFloor } from '../fixtures/floors';

function makeFake() {
  const dom = document.createElement('canvas');
  const r = {
    domElement: dom,
    shadowMap: { enabled: false },
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn<(s: Scene, c: Camera) => void>(),
    dispose: vi.fn(),
  };
  return r satisfies RendererLike;
}

let rafCb: (() => void) | undefined;
const disconnect = vi.fn();
const cancelRaf = vi.fn();

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  rafCb = undefined;
  disconnect.mockClear();
  cancelRaf.mockClear();
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    rafCb = cb;
    return 7;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelRaf(id);
    rafCb = undefined;
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup() {
  const project = { name: 'p', floors: [oneRoomFloor()] } as unknown as Project;
  const scene = new H3xScene(H3xDocument.fromProject(project));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const fake = makeFake();
  const viewer = new H3xViewer(container, scene, { createRenderer: () => fake });
  return { scene, container, fake, viewer };
}

const flush = () => {
  const cb = rafCb;
  rafCb = undefined;
  cb?.();
};

describe('H3xViewer', () => {
  it('appends the canvas and coalesces render requests', () => {
    const { container, fake, viewer } = setup();
    expect(container.contains(fake.domElement)).toBe(true);
    expect(fake.domElement.style.display).toBe('block');
    flush();
    fake.render.mockClear();
    viewer.requestRender();
    viewer.requestRender();
    flush();
    expect(fake.render).toHaveBeenCalledTimes(1);
    flush();
    expect(fake.render).toHaveBeenCalledTimes(1);
    viewer.dispose();
  });

  it('switches projection keeping the target', () => {
    const { viewer } = setup();
    expect(viewer.projection).toBe('perspective');
    viewer.fitToContent();
    const before = viewer.target.clone();
    viewer.setProjection('orthographic');
    expect(viewer.projection).toBe('orthographic');
    expect(viewer.camera.type).toBe('OrthographicCamera');
    expect(viewer.target.distanceTo(before)).toBeLessThan(1e-9);
    viewer.setProjection('perspective');
    expect(viewer.camera.type).toBe('PerspectiveCamera');
    expect(viewer.target.distanceTo(before)).toBeLessThan(1e-9);
    viewer.dispose();
  });

  it('viewFromAxis("y") looks down from above', () => {
    const { viewer } = setup();
    viewer.fitToContent();
    viewer.viewFromAxis('y');
    expect(viewer.projection).toBe('orthographic');
    const dir = new Vector3();
    viewer.camera.getWorldDirection(dir);
    expect(dir.y).toBeLessThan(-0.99);
    expect(dir.distanceTo(new Vector3(0, -1, 0))).toBeLessThan(1e-6);
    expect(viewer.camera.up.toArray()).toEqual([0, 0, -1]);
    expect(viewer.camera.position.y).toBeGreaterThan(viewer.target.y);
    viewer.dispose();
  });

  it('keeps content inside the clip range after dollying close', () => {
    const { scene, viewer } = setup();
    viewer.fitToContent();
    const radius = new Box3().setFromObject(scene.root).getBoundingSphere(new Sphere()).radius;
    const target = viewer.target;
    const dir = viewer.camera.position.clone().sub(target).normalize();
    viewer.camera.position.copy(target).addScaledVector(dir, 0.5);
    viewer.viewFromAxis('y');
    const dist = viewer.camera.position.y - target.y;
    expect(dist).toBeGreaterThanOrEqual(radius * 2);
    expect(viewer.camera.near).toBeLessThan(dist - radius);
    expect(viewer.camera.far).toBeGreaterThanOrEqual(dist + 2 * radius);
    viewer.dispose();
  });

  it('dispose tears everything down', () => {
    const { scene, container, fake, viewer } = setup();
    viewer.requestRender();
    viewer.dispose();
    expect(container.contains(fake.domElement)).toBe(false);
    expect(disconnect).toHaveBeenCalled();
    expect(cancelRaf).toHaveBeenCalledWith(7);
    expect(fake.dispose).toHaveBeenCalled();
    fake.render.mockClear();
    scene.rebuild();
    flush();
    expect(fake.render).not.toHaveBeenCalled();
  });
});
