// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addColumn,
  moveColumn,
  moveNode,
  setSite,
  type Floor,
  type Project,
} from '../../src/core';
import { computeJoins } from '../../src/shared/walls/joins';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { DEFAULT_CSS } from '../../src/plan/style';
import { holedRoomFloor, oneRoomFloor, testPresets } from '../fixtures/floors';

const LAYERS = [
  'grid',
  'site',
  'rooms',
  'stairs',
  'walls',
  'joins',
  'columns',
  'openings',
  'items',
  'dimensions',
  'nodes',
  'overlay',
];

function docOf(floor: Floor): H3xDocument {
  return H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );
}

function container(width = 800, height = 600): HTMLDivElement {
  const div = document.createElement('div');
  Object.defineProperty(div, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(div, 'clientHeight', { configurable: true, value: height });
  document.body.appendChild(div);
  return div;
}

const points = (plan: H3xPlan, id: string): string | null | undefined =>
  plan.getElement('wall', id)?.querySelector('polygon')?.getAttribute('points');

const allAttributes = (root: Element): string[] =>
  [root, ...Array.from(root.querySelectorAll('*'))].flatMap((el) =>
    Array.from(el.attributes).map((a) => `${a.name}=${a.value}`),
  );

let plans: H3xPlan[] = [];
function makePlan(floor: Floor = oneRoomFloor(), el: HTMLElement = container()): H3xPlan {
  const plan = new H3xPlan(el, docOf(floor));
  plans.push(plan);
  return plan;
}

afterEach(() => {
  plans.forEach((p) => p.dispose());
  plans = [];
  document.body.innerHTML = '';
});

describe('H3xPlan rendering', () => {
  it('appends an svg sized to the container with the layers in order', () => {
    const el = container();
    const plan = makePlan(oneRoomFloor(), el);
    expect(plan.svg.parentElement).toBe(el);
    expect(plan.svg.getAttribute('width')).toBe('800');
    expect(plan.svg.getAttribute('height')).toBe('600');
    expect(plan.svg.classList.contains('h3x-plan')).toBe(true);
    const layers = Array.from(plan.svg.querySelectorAll('g[class*="-layer-"]')).map((g) =>
      g.getAttribute('class'),
    );
    expect(layers).toEqual(LAYERS.map((l) => `h3x-plan-layer-${l}`));
    expect(plan.svg.querySelector('style')?.textContent).toBe(DEFAULT_CSS('h3x-plan'));
  });

  it('builds one element per node, wall, room and opening', () => {
    const plan = makePlan();
    const count = (kind: string): number =>
      plan.svg.querySelectorAll(`[data-h3x-kind="${kind}"]`).length;
    expect(count('node')).toBe(4);
    expect(count('wall')).toBe(4);
    expect(count('room')).toBe(1);
    expect(count('opening')).toBe(1);
    const w1 = plan.getElement('wall', 'w1')!;
    expect(w1.tagName).toBe('g');
    expect(w1.getAttribute('data-h3x-id')).toBe('w1');
    expect(w1.getAttribute('class')).toBe('h3x-plan-wall');
    expect(w1.parentElement?.getAttribute('class')).toBe('h3x-plan-layer-walls');
    expect(plan.getElement('room', 'r1')!.textContent).toContain('Phòng khách');
    expect(plan.getElement('opening', 'o1')!.parentElement?.getAttribute('class')).toBe(
      'h3x-plan-layer-openings',
    );
    expect(plan.getElement('wall', 'nope')).toBeUndefined();
  });

  it('marks walls lower than the storey height with the low class', () => {
    const floor = oneRoomFloor();
    floor.walls.w1!.height = 1.1;
    const plan = makePlan(floor);
    expect(plan.getElement('wall', 'w1')!.classList.contains('h3x-plan-wall-low')).toBe(true);
    expect(plan.getElement('wall', 'w2')!.classList.contains('h3x-plan-wall-low')).toBe(false);
    expect(plan.getElement('wall', 'w1')!.classList.contains('h3x-plan-wall')).toBe(true);
    expect(plan.svg.querySelector('style')?.textContent).toContain('wall-low polygon');
  });

  it('honours classPrefix and grid: false', () => {
    const plan = new H3xPlan(container(), docOf(oneRoomFloor()), {
      classPrefix: 'fp',
      grid: false,
    });
    plans.push(plan);
    expect(plan.svg.classList.contains('fp')).toBe(true);
    expect(plan.getElement('wall', 'w1')!.getAttribute('class')).toBe('fp-wall');
    expect(plan.svg.querySelector('.fp-layer-grid')!.children.length).toBe(0);
  });

  it('draws wall outlines in plan space under a mirrored root transform', () => {
    const plan = makePlan();
    plan.setView({ cx: 2, cy: 2, scale: 50 });
    const root = plan.svg.querySelector('.h3x-plan-layer-walls')!.parentElement!;
    expect(root.getAttribute('transform')).toBe('matrix(50,0,0,-50,300,400)');
    const c = computeJoins(oneRoomFloor()).corners.w1!;
    expect(points(plan, 'w1')).toBe(
      [c.startLeft, c.endLeft, c.endRight, c.startRight].map((p) => `${p.x},${p.y}`).join(' '),
    );
    expect(plan.svg.querySelector('polygon')!.getAttribute('vector-effect')).toBe(
      'non-scaling-stroke',
    );
  });

  it('positions text in screen space so it stays upright and pixel-sized', () => {
    const plan = makePlan();
    plan.setView({ cx: 2, cy: 2, scale: 50 });
    const text = plan.getElement('room', 'r1')!.querySelector('text')!;
    expect(text.getAttribute('transform')).toMatch(/^matrix\(0\.02,0,0,-0\.02,/);
  });

  it('renders dimensions for the exterior walls and keeps their screen rects', () => {
    const plan = makePlan();
    const dims = plan.svg.querySelector('.h3x-plan-layer-dimensions')!;
    expect(dims.children.length).toBe(4);
    expect(dims.textContent).toContain('4.00');
    const rects = plan.dimensionRects();
    expect([...rects.keys()].sort()).toEqual(['w1', 'w2', 'w3', 'w4']);
    const r = rects.get('w1')!;
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    // w1 runs along y = 0 at the bottom; its label sits below it on screen.
    expect(r.y).toBeGreaterThan(plan.planToScreen({ x: 2, y: 0 }).y);
  });

  it('shows minor grid lines only when they are at least 6 px apart', () => {
    const plan = makePlan();
    const minor = (): string =>
      plan.svg.querySelector('.h3x-plan-grid-minor')!.getAttribute('d') ?? '';
    plan.setView({ scale: 50 });
    expect(minor()).toBe('');
    plan.setView({ scale: 100 });
    expect(minor()).not.toBe('');
    plan.setView({ scale: 59 });
    expect(minor()).toBe('');
    expect(plan.svg.querySelector('.h3x-plan-grid-major')!.getAttribute('d')).not.toBe('');
    plan.setView({ scale: 60 });
    expect(minor()).not.toBe('');
  });
});

describe('H3xPlan document sync', () => {
  it('keeps element identity and updates only the affected walls', () => {
    const plan = makePlan();
    const w1 = plan.getElement('wall', 'w1');
    const before = { w1: points(plan, 'w1'), w2: points(plan, 'w2'), w4: points(plan, 'w4') };
    plan.doc.execute(moveNode('n2', { x: 5, y: 0 }));
    expect(plan.getElement('wall', 'w1')).toBe(w1);
    expect(points(plan, 'w1')).not.toBe(before.w1);
    expect(points(plan, 'w2')).not.toBe(before.w2);
    expect(points(plan, 'w4')).toBe(before.w4);
  });

  it('re-mitres a neighbour wall whose corner moved with a shared node', () => {
    const plan = makePlan();
    plan.doc.execute(moveNode('n2', { x: 5, y: 0 }));
    // w3 meets w2 at n3; w2 changed direction, so w3's mitred corner moved.
    const c = computeJoins(plan.doc.floor).corners.w3!;
    expect(points(plan, 'w3')).toBe(
      [c.startLeft, c.endLeft, c.endRight, c.startRight].map((p) => `${p.x},${p.y}`).join(' '),
    );
  });

  it('undo restores the original points', () => {
    const plan = makePlan();
    const original = ['w1', 'w2', 'w3', 'w4'].map((id) => points(plan, id));
    const room = plan.getElement('room', 'r1')!.querySelector('path')!.getAttribute('d');
    plan.doc.execute(moveNode('n2', { x: 5, y: 0 }));
    plan.doc.undo();
    expect(['w1', 'w2', 'w3', 'w4'].map((id) => points(plan, id))).toEqual(original);
    expect(plan.getElement('room', 'r1')!.querySelector('path')!.getAttribute('d')).toBe(room);
  });

  it('updates the dimension text after a move', () => {
    const plan = makePlan();
    plan.doc.execute(moveNode('n2', { x: 5, y: 0 }));
    expect(plan.svg.querySelector('.h3x-plan-layer-dimensions')!.textContent).toContain('5.00');
  });

  it('adds and removes elements for entities that appear and disappear', () => {
    const plan = makePlan();
    plan.doc.execute({
      label: 'add node',
      run: () => [{ kind: 'node', id: 'n9', before: null, after: { id: 'n9', x: 9, y: 9 } }],
    });
    const n9 = plan.getElement('node', 'n9');
    expect(n9?.parentElement?.getAttribute('class')).toBe('h3x-plan-layer-nodes');
    plan.doc.undo();
    expect(plan.getElement('node', 'n9')).toBeUndefined();
    expect(n9?.isConnected).toBe(false);
  });

  it('reconciles fully on a load-like change touching many ids', () => {
    const plan = makePlan();
    const w1 = plan.getElement('wall', 'w1');
    plan.doc.execute({
      label: 'many nodes',
      run: () =>
        Array.from({ length: 60 }, (_, i) => ({
          kind: 'node' as const,
          id: `m${i}`,
          before: null,
          after: { id: `m${i}`, x: i, y: 10 },
        })),
    });
    expect(plan.svg.querySelectorAll('[data-h3x-kind="node"]').length).toBe(64);
    expect(plan.getElement('wall', 'w1')).toBe(w1);
  });
});

describe('H3xPlan view', () => {
  it('fitToContent centres oneRoomFloor at (2, 2)', () => {
    const plan = makePlan();
    plan.setView({ cx: -10, cy: 7 });
    plan.fitToContent();
    expect(plan.view.cx).toBeCloseTo(2);
    expect(plan.view.cy).toBeCloseTo(2);
    expect(plan.view.width).toBe(800);
    expect(plan.view.height).toBe(600);
  });

  it('converts between plan and screen with its own view', () => {
    const plan = makePlan();
    plan.setView({ cx: 2, cy: 2, scale: 50 });
    expect(plan.planToScreen({ x: 2, y: 2 })).toEqual({ x: 400, y: 300 });
    expect(plan.planToScreen({ x: 3, y: 3 })).toEqual({ x: 450, y: 250 });
    expect(plan.screenToPlan({ x: 450, y: 250 })).toEqual({ x: 3, y: 3 });
  });

  it('clamps the scale given to setView', () => {
    const plan = makePlan();
    plan.setView({ scale: 1e9 });
    expect(Number.isFinite(plan.view.scale)).toBe(true);
    expect(plan.view.scale).toBeLessThan(1e9);
  });

  it('a 0x0 container produces no NaN attributes', () => {
    const plan = makePlan(oneRoomFloor(), container(0, 0));
    plan.fitToContent();
    expect(allAttributes(plan.svg).filter((a) => a.includes('NaN'))).toEqual([]);
  });

  it('follows container size on window resize when ResizeObserver is missing', () => {
    const el = container();
    const plan = makePlan(oneRoomFloor(), el);
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 400 });
    window.dispatchEvent(new Event('resize'));
    expect(plan.view.width).toBe(400);
    expect(plan.svg.getAttribute('width')).toBe('400');
  });

  it('renders a floor with an isolated node and no walls', () => {
    const floor: Floor = {
      ...oneRoomFloor(),
      nodes: { n1: { id: 'n1', x: 1, y: 1 } },
      walls: {},
      openings: {},
      rooms: {},
    };
    const plan = makePlan(floor);
    expect(plan.getElement('node', 'n1')).toBeDefined();
    plan.fitToContent();
    expect(allAttributes(plan.svg).filter((a) => a.includes('NaN'))).toEqual([]);
  });
});

describe('H3xPlan dispose', () => {
  it('removes the svg, ignores later changes and is idempotent', () => {
    const el = container();
    const plan = makePlan(oneRoomFloor(), el);
    const w1 = plan.getElement('wall', 'w1')!;
    const pts = w1.querySelector('polygon')!.getAttribute('points');
    plan.dispose();
    expect(el.querySelector('svg')).toBeNull();
    expect(() => plan.doc.execute(moveNode('n2', { x: 5, y: 0 }))).not.toThrow();
    expect(w1.querySelector('polygon')!.getAttribute('points')).toBe(pts);
    expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
    expect(() => plan.dispose()).not.toThrow();
  });
});

describe('H3xPlan columns, site and holes', () => {
  it('adds, keeps, and removes a column element', () => {
    const plan = makePlan();
    const cmd = addColumn({ x: 2, y: 2, shape: 'round', width: 0.4 });
    plan.doc.execute(cmd);
    const el = plan.getElement('column', cmd.createdId);
    expect(el).toBeDefined();
    expect(el!.parentElement!.getAttribute('class')).toBe('h3x-plan-layer-columns');
    expect(el!.querySelector('circle')!.getAttribute('r')).toBe('0.2');
    plan.doc.execute(moveColumn(cmd.createdId, { x: 3 }));
    expect(plan.getElement('column', cmd.createdId)).toBe(el);
    expect(el!.querySelector('circle')!.getAttribute('cx')).toBe('3');
    plan.doc.undo();
    plan.doc.undo();
    expect(plan.getElement('column', cmd.createdId)).toBeUndefined();
    expect(el!.isConnected).toBe(false);
  });

  it('renders the site as one dashed polygon under the rooms, removed on undo', () => {
    const plan = makePlan();
    plan.doc.execute(
      setSite([
        { x: -2, y: -2 },
        { x: 8, y: -2 },
        { x: 8, y: 8 },
        { x: -2, y: 8 },
      ]),
    );
    const el = plan.getElement('site', 'site');
    expect(el!.parentElement!.getAttribute('class')).toBe('h3x-plan-layer-site');
    expect(el!.querySelector('polygon')!.getAttribute('points')).toBe('-2,-2 8,-2 8,8 -2,8');
    plan.doc.undo();
    expect(plan.getElement('site', 'site')).toBeUndefined();
  });

  it('draws a holed room as an even-odd path and re-renders it when a hole wall moves', () => {
    const plan = makePlan(holedRoomFloor());
    const path = plan.getElement('room', 'r1')!.querySelector('path')!;
    expect(path.getAttribute('fill-rule')).toBe('evenodd');
    expect(path.getAttribute('d')!.match(/M/g)).toHaveLength(2);
    const before = path.getAttribute('d');
    plan.doc.execute(moveNode('hn0', { x: 3, y: 4 }));
    expect(plan.getElement('room', 'r1')!.querySelector('path')).toBe(path);
    expect(path.getAttribute('d')).not.toBe(before);
  });
});
