// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  H3xDocument,
  addFloor,
  moveNode,
  type Floor,
  type PlanNode,
  type Project,
  type Vec2,
  type Wall,
} from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import type { Tool } from '../../src/plan/tools/Tool';
import { DrawWallTool } from '../../src/plan/tools/DrawWallTool';
import { DEFAULT_CSS } from '../../src/plan/style';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const node = (id: string, x: number, y: number): PlanNode => ({ id, x, y });
const wall = (id: string, a: string, b: string): Wall => ({
  id,
  a,
  b,
  thickness: 0.2,
  height: 3.2,
});

/** Ground 'g': the one-room square (0..4) plus a round column; 'u' and 't': one wall each. */
function project(): Project {
  const g: Floor = {
    ...oneRoomFloor(),
    id: 'g',
    columns: { c1: { id: 'c1', x: 2, y: 2, shape: 'round', width: 0.3, rotation: 0 } },
  };
  const single = (id: string, level: number, y: number): Floor => ({
    id,
    level,
    elevation: level * 3.35,
    wallHeight: 3.2,
    slabThickness: 0.15,
    nodes: { [`${id}1`]: node(`${id}1`, 10, y), [`${id}2`]: node(`${id}2`, 14, y) },
    walls: { [`${id}w`]: wall(`${id}w`, `${id}1`, `${id}2`) },
    openings: {},
    rooms: {},
    items: {},
    columns: {},
  });
  return {
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors: [g, single('u', 1, 10), single('t', 2, 20)],
  } as Project;
}

let plans: H3xPlan[] = [];
function makePlan(
  tool?: Tool | null,
  doc = H3xDocument.fromProject(project(), { presets: testPresets }),
): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, doc, tool === undefined ? {} : { tool });
  plan.setView({ cx: 7, cy: 5, scale: 40 });
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

function fire(plan: H3xPlan, type: string, p: Vec2): void {
  const s = plan.planToScreen(p);
  const e = new MouseEvent(type, {
    clientX: s.x,
    clientY: s.y,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  plan.svg.dispatchEvent(e);
}
function click(plan: H3xPlan, p: Vec2): void {
  fire(plan, 'pointermove', p);
  fire(plan, 'pointerdown', p);
  fire(plan, 'pointerup', p);
}

const underlay = (plan: H3xPlan): SVGGElement =>
  plan.svg.querySelector<SVGGElement>('.h3x-plan-underlay')!;
const underlayShapes = (plan: H3xPlan): Element[] => Array.from(underlay(plan).children);

describe('H3xPlan floors: underlay', () => {
  it('draws one element per wall and column of the floor below, none on the ground', () => {
    const plan = makePlan();
    expect(underlay(plan)).not.toBeNull();
    expect(underlayShapes(plan)).toHaveLength(0);
    plan.doc.setActiveFloor('u');
    expect(underlayShapes(plan)).toHaveLength(5); // 4 walls + 1 column
    expect(underlay(plan).querySelectorAll('circle')).toHaveLength(1);
    plan.doc.setActiveFloor('t');
    expect(underlayShapes(plan)).toHaveLength(1);
  });

  it('sits above the grid and below rooms, ignoring the pointer', () => {
    const plan = makePlan();
    const layers = Array.from(plan.svg.querySelectorAll('g > g')).map((g) =>
      g.getAttribute('class'),
    );
    const at = layers.indexOf('h3x-plan-underlay');
    expect(at).toBe(layers.indexOf('h3x-plan-layer-grid') + 1);
    expect(at).toBeLessThan(layers.indexOf('h3x-plan-layer-rooms'));
    expect(underlay(plan).getAttribute('pointer-events')).toBe('none');
    expect(DEFAULT_CSS('h3x-plan')).toContain('.h3x-plan-underlay polygon');
  });

  it('is not hit-tested', () => {
    const plan = makePlan();
    plan.doc.setActiveFloor('u');
    expect(plan.hitAt(plan.planToScreen({ x: 2, y: 0 }))).toBeNull();
    expect(plan.hitAt(plan.planToScreen({ x: 2, y: 2 }))).toBeNull();
  });

  it('is not snapped to by the draw tool', () => {
    const plan = makePlan(new DrawWallTool());
    plan.doc.setActiveFloor('u');
    click(plan, { x: 0.04, y: 0.04 }); // near the ground node (0, 0)
    click(plan, { x: 2, y: 3 });
    const f = plan.doc.floor;
    const ends = Object.values(f.walls)
      .filter((w) => w.id !== 'uw')
      .flatMap((w) => [f.nodes[w.a]!, f.nodes[w.b]!]);
    expect(ends).toContainEqual({ id: expect.any(String), x: 0.05, y: 0.05 });
    expect(ends.some((n) => n.x === 0 && n.y === 0)).toBe(false);
  });

  it('re-renders when the floor below changes', () => {
    const plan = makePlan();
    plan.doc.execute(moveNode('n2', { x: 5, y: 0 }));
    plan.doc.setActiveFloor('u');
    const before = underlayShapes(plan).map((e) => e.getAttribute('points'));
    plan.doc.undo(); // a change on 'g' while 'u' is active
    const after = underlayShapes(plan).map((e) => e.getAttribute('points'));
    expect(after).not.toEqual(before);
    expect(after.join(' ')).toContain('4.1');
  });

  it('a change on an unrelated floor touches no element but recomputes issues', async () => {
    const plan = makePlan();
    plan.doc.setActiveFloor('t');
    plan.doc.execute(moveNode('t1', { x: 9, y: 20 }));
    plan.doc.setActiveFloor('u');
    const spy = vi.spyOn(plan.doc, 'validateLayout');
    const records: MutationRecord[] = [];
    const obs = new MutationObserver((r) => records.push(...r));
    obs.observe(plan.svg, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    plan.doc.undo(); // a change on 't' while 'u' is active
    await Promise.resolve();
    records.push(...obs.takeRecords());
    obs.disconnect();
    expect(records).toEqual([]);
    expect(spy).toHaveBeenCalled();
  });
});

describe('H3xPlan floors: switching', () => {
  it('clears the selection and renders the new floor', () => {
    const plan = makePlan();
    plan.select({ kind: 'wall', id: 'w1' });
    const seen: unknown[] = [];
    plan.on('selectionchange', (s) => seen.push(s));
    plan.doc.setActiveFloor('u');
    expect(plan.selection).toBeNull();
    expect(seen).toEqual([null]);
    expect(plan.getElement('wall', 'w1')).toBeUndefined();
    expect(plan.getElement('room', 'r1')).toBeUndefined();
    expect(plan.getElement('wall', 'uw')).toBeDefined();
    expect(plan.svg.querySelectorAll('.h3x-plan-layer-walls > g')).toHaveLength(1);
  });

  it('cancels an in-progress wall chain', () => {
    const plan = makePlan(new DrawWallTool());
    click(plan, { x: 6, y: 6 });
    fire(plan, 'pointermove', { x: 8, y: 6 });
    expect(plan.svg.querySelectorAll('.h3x-plan-preview').length).toBeGreaterThan(0);
    plan.doc.setActiveFloor('u');
    expect(plan.svg.querySelectorAll('.h3x-plan-preview')).toHaveLength(0);
    fire(plan, 'pointermove', { x: 8, y: 7 });
    expect(plan.svg.querySelectorAll('.h3x-plan-preview')).toHaveLength(0);
    // The next click starts a fresh chain on 'u' rather than committing a wall from (6, 6).
    click(plan, { x: 8, y: 7 });
    expect(Object.keys(plan.doc.floor.walls)).toEqual(['uw']);
  });

  it('undo of addFloor while that floor is active shows the ground floor', () => {
    const doc = H3xDocument.fromProject(
      { ...project(), floors: [project().floors[0]!] },
      { presets: testPresets },
    );
    const plan = makePlan(undefined, doc);
    const cmd = addFloor({ position: 'above' });
    doc.execute(cmd);
    const id = cmd.createdId;
    doc.setActiveFloor(id);
    expect(plan.getElement('wall', 'w1')).toBeUndefined();
    expect(underlayShapes(plan)).toHaveLength(5);
    expect(() => doc.undo()).not.toThrow();
    expect(doc.activeFloorId).toBe('g');
    expect(plan.getElement('wall', 'w1')).toBeDefined();
    expect(plan.svg.querySelectorAll('.h3x-plan-layer-walls > g')).toHaveLength(4);
    expect(underlayShapes(plan)).toHaveLength(0);
  });
});
