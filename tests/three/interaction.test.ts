// @vitest-environment jsdom
import { Vector3, type Camera, type Scene } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  H3xDocument,
  moveNode,
  type Floor,
  type Issue,
  type Opening,
  type Project,
} from '../../src/core';
import { openingMoveTarget } from '../../src/plan/tools/openingEdit';
import { H3xScene, H3xViewer, type RendererLike } from '../../src/three';
import { oneRoomFloor } from '../fixtures/floors';
import { testRoof } from './helpers';

const W = 800;
const H = 600;

function makeFake() {
  const dom = document.createElement('canvas');
  Object.defineProperty(dom, 'clientWidth', { value: W });
  Object.defineProperty(dom, 'clientHeight', { value: H });
  dom.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H, x: 0, y: 0 }) as DOMRect;
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

type Captures = { setPointerCapture?: unknown; releasePointerCapture?: unknown };

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  const proto = Element.prototype as unknown as Captures;
  proto.setPointerCapture = () => undefined;
  proto.releasePointerCapture = () => undefined;
});
afterEach(() => {
  document.body.innerHTML = '';
  const proto = Element.prototype as unknown as Captures;
  delete proto.setPointerCapture;
  delete proto.releasePointerCapture;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The one-room floor; its door o1 on w1 (along +x at plan y = 0) faces world +z. */
function floorWith(extra: Partial<Floor> = {}): Floor {
  const f = oneRoomFloor();
  f.wallHeight = 3.2;
  return { ...f, ...extra };
}

function upperFloor(): Floor {
  return { ...oneRoomFloor(), id: 'f2', level: 1, elevation: 3.35 };
}

function setup(opts: { editing?: boolean; floors?: Floor[] } = {}) {
  const floors = opts.floors ?? [floorWith()];
  const project = { version: 1, unit: 'm', name: 'p', floors } as unknown as Project;
  const doc = H3xDocument.fromProject(project);
  const scene = new H3xScene(doc);
  const container = document.createElement('div');
  Object.defineProperty(container, 'clientWidth', { value: W });
  Object.defineProperty(container, 'clientHeight', { value: H });
  document.body.appendChild(container);
  const fake = makeFake();
  const viewer = new H3xViewer(container, scene, {
    createRenderer: () => fake,
    gizmo: false,
    ...(opts.editing !== undefined ? { editing: opts.editing } : {}),
  });
  const canvas = fake.domElement;
  const look = (from: Vector3, at: Vector3): void => {
    const cam = viewer.camera;
    cam.position.copy(from);
    cam.lookAt(at);
    cam.updateMatrixWorld();
  };
  /** Client coordinates of a world point through the current camera. */
  const screen = (p: Vector3): { x: number; y: number } => {
    const v = p.clone().project(viewer.camera);
    return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
  };
  const fire = (
    type: string,
    p: { x: number; y: number },
    extra: { altKey?: boolean; pointerId?: number } = {},
  ): void => {
    const e = new MouseEvent(type, {
      clientX: p.x,
      clientY: p.y,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      bubbles: true,
      cancelable: true,
      altKey: extra.altKey ?? false,
    });
    Object.defineProperty(e, 'pointerId', { value: extra.pointerId ?? 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    canvas.dispatchEvent(e);
  };
  const down = (w: Vector3, extra?: { altKey?: boolean }) => fire('pointerdown', screen(w), extra);
  const move = (w: Vector3, extra?: { altKey?: boolean }) => fire('pointermove', screen(w), extra);
  const up = (w: Vector3) => fire('pointerup', screen(w));
  const key = (k: string): void => {
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  };
  const inner = viewer as unknown as {
    controls: { enabled: boolean };
    overlay: { children: unknown[] };
  };
  const orbit = (): boolean => inner.controls.enabled;
  return {
    doc,
    scene,
    container,
    canvas,
    viewer,
    look,
    screen,
    fire,
    down,
    move,
    up,
    key,
    orbit,
    inner,
  };
}

/** Front of the door o1 (on w1's outer face, world z = +0.1), mid height. */
const DOOR_FRONT = new Vector3(1.2, 1.05, 0.1);
/** A camera south of w1, a little east, seeing w1's and w2's outer faces. */
const SOUTH_EAST = new Vector3(7, 2, 6);
const SOUTH = new Vector3(2, 1.5, 6);
const ORIGIN = new Vector3(2, 1.2, 0);

const opening = (doc: H3xDocument, id = 'o1'): Opening | undefined => doc.floor.openings[id];

describe('H3xViewer editing', () => {
  it('is off by default and leaves the press to orbit', () => {
    const t = setup();
    t.look(SOUTH, ORIGIN);
    const seen: unknown[] = [];
    t.viewer.on('selectionchange', (s) => seen.push(s));
    const before = t.viewer.camera.position.clone();
    t.down(DOOR_FRONT);
    t.fire('pointermove', { x: t.screen(DOOR_FRONT).x + 60, y: t.screen(DOOR_FRONT).y });
    t.fire('pointerup', { x: t.screen(DOOR_FRONT).x + 60, y: t.screen(DOOR_FRONT).y });
    expect(t.viewer.camera.position.distanceTo(before)).toBeGreaterThan(1e-3);
    expect(t.viewer.selection).toBeNull();
    expect(seen).toEqual([]);
    expect(opening(t.doc)!.offset).toBe(1.2);
    // Programmatic selection and keys do nothing either.
    t.viewer.select({ kind: 'opening', id: 'o1' });
    expect(t.viewer.selection).toBeNull();
    t.key('Delete');
    expect(opening(t.doc)).toBeDefined();
    expect(t.canvas.hasAttribute('tabindex')).toBe(false);
  });

  it('selects an opening on click and clears on a click elsewhere', () => {
    const t = setup({ editing: true });
    t.look(SOUTH, ORIGIN);
    const seen: unknown[] = [];
    t.viewer.on('selectionchange', (s) => seen.push(s));
    t.down(DOOR_FRONT);
    t.up(DOOR_FRONT);
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
    // A click on the wall beside it clears.
    const wall = new Vector3(3, 1.5, 0.1);
    t.down(wall);
    t.up(wall);
    expect(t.viewer.selection).toBeNull();
    expect(seen).toEqual([{ kind: 'opening', id: 'o1' }, null]);
  });

  it('select() takes only openings of the active floor', () => {
    const t = setup({ editing: true, floors: [floorWith(), upperFloor()] });
    t.viewer.select({ kind: 'opening', id: 'o1' });
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
    t.viewer.select({ kind: 'opening', id: 'nope' });
    expect(t.viewer.selection).toBeNull();
  });

  it('a wall in front blocks the pick', () => {
    const t = setup({ editing: true });
    // West of w4 (plan x = 0), the ray to the door crosses w4 first.
    t.look(new Vector3(-6, 1, -1), new Vector3(1.2, 1.05, 0));
    t.down(new Vector3(1.2, 1.05, 0));
    t.up(new Vector3(1.2, 1.05, 0));
    expect(t.viewer.selection).toBeNull();
  });

  it('a visible roof blocks the pick, a hidden one does not', () => {
    const roofed = floorWith({ roofs: { R1: testRoof() } });
    const t = setup({ editing: true, floors: [roofed] });
    const target = new Vector3(1.2, 1.05, 0);
    t.look(new Vector3(2, 10, -2), target);
    t.down(target);
    t.up(target);
    expect(t.viewer.selection).toBeNull();
    t.viewer.setRoofsVisible(false);
    t.down(target);
    t.up(target);
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
  });

  it('a hidden floor does not block; a shown one does', () => {
    const t = setup({ editing: true, floors: [floorWith(), upperFloor()] });
    const target = new Vector3(1.2, 1.05, 0);
    t.look(new Vector3(2, 12, -2), target);
    t.scene.setViewMode('all');
    t.down(target);
    t.up(target);
    expect(t.viewer.selection).toBeNull();
    t.scene.setViewMode('active');
    t.down(target);
    t.up(target);
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
  });

  it('openings of another floor do not pick', () => {
    const t = setup({ editing: true, floors: [floorWith(), upperFloor()] });
    t.look(new Vector3(2, 5, 8), new Vector3(1.2, 4.4, 0.1));
    const upper = new Vector3(1.2, 3.35 + 1.05, 0.1);
    t.down(upper);
    t.up(upper);
    expect(t.viewer.selection).toBeNull();
    t.doc.setActiveFloor('f2');
    t.down(upper);
    t.up(upper);
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
  });

  it('drags along a wall like the plan, one undo step, orbit paused', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const start = structuredClone(opening(t.doc)!);
    const cam = t.viewer.camera.position.clone();
    const to = new Vector3(2.6, 1.05, 0.1);
    t.down(DOOR_FRONT);
    t.move(new Vector3(1.6, 1.05, 0.1));
    t.move(to);
    expect(t.viewer.camera.position.distanceTo(cam)).toBeLessThan(1e-9);
    t.up(to);
    const plan = openingMoveTarget(
      t.doc.floor,
      start,
      0,
      { x: 2.6, y: -0.1 },
      {
        pxPerM: 50,
        grid: 0.05,
        free: false,
      },
    )!;
    const o = opening(t.doc)!;
    expect(o.wall).toBe(plan.opening.wall);
    expect(o.offset).toBeCloseTo(plan.opening.offset, 9);
    expect(o.offset).toBeCloseTo(2.6, 9);
    expect(t.viewer.camera.position.distanceTo(cam)).toBeLessThan(1e-9);
    t.doc.undo();
    expect(opening(t.doc)!.offset).toBe(1.2);
    expect(t.doc.canUndo).toBe(false);
    // Orbit is back after the gesture.
    const sky = { x: 10, y: 10 };
    t.fire('pointerdown', sky);
    t.fire('pointermove', { x: 80, y: 10 });
    t.fire('pointerup', { x: 80, y: 10 });
    expect(t.viewer.camera.position.distanceTo(cam)).toBeGreaterThan(1e-3);
  });

  it('the pointer over the dragged opening keeps its wall, not what shows through its hole', () => {
    const t = setup({ editing: true });
    t.look(SOUTH, ORIGIN);
    t.down(DOOR_FRONT);
    t.move(new Vector3(1.5, 1.05, 0.1));
    expect(opening(t.doc)!.wall).toBe('w1');
    expect(opening(t.doc)!.offset).toBeCloseTo(1.5, 9);
    t.move(new Vector3(1.8, 1.05, 0.1));
    t.up(new Vector3(1.8, 1.05, 0.1));
    expect(opening(t.doc)!.wall).toBe('w1');
    expect(opening(t.doc)!.offset).toBeCloseTo(1.8, 9);
  });

  it('drags onto another wall like the plan', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const start = structuredClone(opening(t.doc)!);
    const to = new Vector3(4.1, 1.05, -2.5);
    t.down(DOOR_FRONT);
    t.move(new Vector3(2.6, 1.05, 0.1));
    t.move(to);
    t.up(to);
    const plan = openingMoveTarget(
      t.doc.floor,
      start,
      0,
      { x: 4.1, y: 2.5 },
      {
        pxPerM: 50,
        grid: 0.05,
        free: false,
        current: 'w1',
      },
    )!;
    const o = opening(t.doc)!;
    expect(o.wall).toBe('w2');
    expect(o.wall).toBe(plan.opening.wall);
    expect(o.offset).toBeCloseTo(plan.opening.offset, 9);
    expect(o.hinge).toBe(plan.opening.hinge);
    expect(o.swing).toBe(plan.opening.swing);
  });

  it('Alt drags without snapping, like the plan', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const start = structuredClone(opening(t.doc)!);
    const to = new Vector3(2.013, 1.05, 0.1);
    t.down(DOOR_FRONT, { altKey: true });
    t.move(to, { altKey: true });
    t.up(to);
    const plan = openingMoveTarget(
      t.doc.floor,
      start,
      0,
      { x: 2.013, y: -0.1 },
      {
        pxPerM: 50,
        grid: 0.05,
        free: true,
      },
    )!;
    expect(opening(t.doc)!.offset).toBeCloseTo(plan.opening.offset, 6);
    expect(opening(t.doc)!.offset).toBeCloseTo(2.013, 6);
  });

  it('a drag out and back leaves no change and no undo step', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    t.down(DOOR_FRONT);
    t.move(new Vector3(2.6, 1.05, 0.1));
    expect(opening(t.doc)!.offset).toBeCloseTo(2.6, 9);
    t.move(DOOR_FRONT);
    t.up(DOOR_FRONT);
    expect(opening(t.doc)!.offset).toBe(1.2);
    expect(t.doc.canUndo).toBe(false);
  });

  it('an invalid spot keeps the last valid one and reports why', () => {
    const f = floorWith();
    f.openings.o2 = { ...f.openings.o1!, id: 'o2', offset: 3.0 };
    const t = setup({ editing: true, floors: [f] });
    t.look(SOUTH_EAST, ORIGIN);
    const issues: Issue[][] = [];
    t.viewer.on('issues', (i) => issues.push(i));
    t.down(DOOR_FRONT);
    t.move(new Vector3(1.6, 1.05, 0.1));
    expect(opening(t.doc)!.offset).toBeCloseTo(1.6, 9);
    t.move(new Vector3(2.9, 1.05, 0.1));
    expect(opening(t.doc)!.offset).toBeCloseTo(1.6, 9);
    expect(issues.at(-1)!.map((i) => i.code)).toContain('opening-overlap');
    t.up(new Vector3(2.9, 1.05, 0.1));
    expect(opening(t.doc)!.offset).toBeCloseTo(1.6, 9);
    expect(issues.at(-1)).toEqual([]);
  });

  it('Esc cancels the drag and gives orbit back', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const cam = t.viewer.camera.position.clone();
    t.down(DOOR_FRONT);
    t.move(new Vector3(2.6, 1.05, 0.1));
    expect(t.orbit()).toBe(false);
    t.key('Escape');
    expect(t.orbit()).toBe(true);
    expect(opening(t.doc)!.offset).toBe(1.2);
    expect(t.doc.canUndo).toBe(false);
    // The rest of the press is ignored.
    t.move(new Vector3(3, 1.05, 0.1));
    t.up(new Vector3(3, 1.05, 0.1));
    expect(opening(t.doc)!.offset).toBe(1.2);
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
    t.fire('pointerdown', { x: 10, y: 10 });
    t.fire('pointermove', { x: 80, y: 10 });
    t.fire('pointerup', { x: 80, y: 10 });
    expect(t.viewer.camera.position.distanceTo(cam)).toBeGreaterThan(1e-3);
    // Esc again clears the selection.
    t.key('Escape');
    expect(t.viewer.selection).toBeNull();
  });

  it('Delete removes the selected opening', () => {
    const t = setup({ editing: true });
    t.look(SOUTH, ORIGIN);
    t.down(DOOR_FRONT);
    t.up(DOOR_FRONT);
    t.key('Delete');
    expect(opening(t.doc)).toBeUndefined();
    expect(t.viewer.selection).toBeNull();
    t.doc.undo();
    expect(opening(t.doc)).toBeDefined();
  });

  it('keys typed into an input inside the container do not reach the viewer', () => {
    const t = setup({ editing: true });
    t.look(SOUTH, ORIGIN);
    t.down(DOOR_FRONT);
    t.up(DOOR_FRONT);
    const input = document.createElement('input');
    t.container.appendChild(input);
    input.focus();
    for (const k of ['Delete', 'Backspace', 'Escape']) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
      );
    }
    expect(opening(t.doc)).toBeDefined();
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
  });

  it('issues clear when the pointer finds a valid spot, leaves the walls or placing changes', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const issues: Issue[][] = [];
    t.viewer.on('issues', (i) => issues.push(i));
    t.viewer.setPlacement({ preset: 'door-single-01' });
    // On the door: refused.
    t.down(DOOR_FRONT);
    t.up(DOOR_FRONT);
    expect(issues.at(-1)!.length).toBeGreaterThan(0);
    t.move(new Vector3(4.1, 1.05, -2.5));
    expect(issues.at(-1)).toEqual([]);
    t.down(DOOR_FRONT);
    t.up(DOOR_FRONT);
    expect(issues.at(-1)!.length).toBeGreaterThan(0);
    t.fire('pointermove', { x: 10, y: 10 });
    expect(issues.at(-1)).toEqual([]);
    t.down(DOOR_FRONT);
    t.up(DOOR_FRONT);
    expect(issues.at(-1)!.length).toBeGreaterThan(0);
    t.viewer.setPlacement(null);
    expect(issues.at(-1)).toEqual([]);
    expect(Object.keys(t.doc.floor.openings)).toHaveLength(1);
  });

  it('a press left to orbit does not block the next one', () => {
    const t = setup({ editing: true });
    t.look(SOUTH, ORIGIN);
    // Its release never reaches the container.
    t.fire('pointerdown', { x: 10, y: 10 });
    t.down(DOOR_FRONT);
    t.up(DOOR_FRONT);
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: 'o1' });
  });

  it('a document change ends the drag', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    t.down(DOOR_FRONT);
    t.move(new Vector3(2.6, 1.05, 0.1));
    t.doc.execute(moveNode('n3', { x: 4, y: 4.5 }));
    t.move(new Vector3(3, 1.05, 0.1));
    t.up(new Vector3(3, 1.05, 0.1));
    expect(opening(t.doc)!.offset).toBeCloseTo(2.6, 9);
  });

  it('a floor switch ends the drag and clears the selection', () => {
    const t = setup({ editing: true, floors: [floorWith(), upperFloor()] });
    t.look(SOUTH_EAST, ORIGIN);
    t.down(DOOR_FRONT);
    t.move(new Vector3(2.6, 1.05, 0.1));
    expect(t.orbit()).toBe(false);
    t.doc.setActiveFloor('f2');
    expect(t.orbit()).toBe(true);
    expect(t.viewer.selection).toBeNull();
    t.move(new Vector3(3, 1.05, 0.1));
    t.up(new Vector3(3, 1.05, 0.1));
    expect(t.doc.floorById('f1')!.openings.o1!.offset).toBeCloseTo(2.6, 9);
    expect(t.doc.floorById('f2')!.openings.o1!.offset).toBe(1.2);
  });

  it('dispose ends the drag as one undo step and stops listening', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const removed = vi.spyOn(t.container, 'removeEventListener');
    expect(t.canvas.getAttribute('tabindex')).toBe('0');
    t.down(DOOR_FRONT);
    t.move(new Vector3(2.6, 1.05, 0.1));
    expect(t.orbit()).toBe(false);
    expect(t.inner.overlay.children.length).toBeGreaterThan(0);
    t.viewer.dispose();
    expect(t.orbit()).toBe(true);
    expect(t.canvas.hasAttribute('tabindex')).toBe(false);
    expect(t.inner.overlay.children).toHaveLength(0);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      expect(removed).toHaveBeenCalledWith(type, expect.any(Function), true);
    }
    for (const type of ['pointerleave', 'keydown']) {
      expect(removed).toHaveBeenCalledWith(type, expect.any(Function), false);
    }
    t.move(new Vector3(3, 1.05, 0.1));
    t.up(new Vector3(3, 1.05, 0.1));
    expect(opening(t.doc)!.offset).toBeCloseTo(2.6, 9);
    t.doc.undo();
    expect(opening(t.doc)!.offset).toBe(1.2);
  });

  it('places from a preset on a wall and selects it', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const cam = t.viewer.camera.position.clone();
    const issues: Issue[][] = [];
    t.viewer.on('issues', (i) => issues.push(i));
    t.viewer.setPlacement({ preset: 'window-01' });
    const at = new Vector3(4.1, 1.5, -2.5);
    t.move(at);
    t.down(at);
    t.move(new Vector3(4.1, 1.5, -2.0));
    t.up(new Vector3(4.1, 1.5, -2.0));
    expect(t.viewer.camera.position.distanceTo(cam)).toBeLessThan(1e-9);
    const added = Object.values(t.doc.floor.openings).filter((o) => o.id !== 'o1');
    expect(added).toHaveLength(1);
    expect(added[0]!.wall).toBe('w2');
    expect(added[0]!.preset).toBe('window-01');
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: added[0]!.id });
    // The same spot again overlaps: nothing added, the reason reported.
    t.down(at);
    t.up(at);
    expect(Object.keys(t.doc.floor.openings)).toHaveLength(2);
    expect(issues.at(-1)!.map((i) => i.code)).toContain('opening-overlap');
    // Off: a press on the new window selects it again and adds nothing.
    t.viewer.setPlacement(null);
    t.viewer.select(null);
    t.down(at);
    t.up(at);
    expect(Object.keys(t.doc.floor.openings)).toHaveLength(2);
    expect(t.viewer.selection).toEqual({ kind: 'opening', id: added[0]!.id });
  });

  it('a placement press on empty space leaves it to orbit', () => {
    const t = setup({ editing: true });
    t.look(SOUTH_EAST, ORIGIN);
    const cam = t.viewer.camera.position.clone();
    t.viewer.setPlacement({ preset: 'door-single-01' });
    t.fire('pointerdown', { x: 10, y: 10 });
    t.fire('pointermove', { x: 80, y: 10 });
    t.fire('pointerup', { x: 80, y: 10 });
    expect(t.viewer.camera.position.distanceTo(cam)).toBeGreaterThan(1e-3);
    expect(Object.keys(t.doc.floor.openings)).toHaveLength(1);
  });

  it('exposes the document on the scene', () => {
    const t = setup();
    expect(t.scene.document).toBe(t.doc);
  });
});
