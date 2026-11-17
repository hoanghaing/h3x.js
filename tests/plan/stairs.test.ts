// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  H3xDocument,
  layoutStair,
  setFloorHeight,
  updateStair,
  type Floor,
  type Project,
  type Stair,
} from '../../src/core';
import { H3xPlan, type H3xPlanOptions } from '../../src/plan/H3xPlan';
import { DEFAULT_CSS } from '../../src/plan/style';

/** A U stair with a landing, 2.2 × 4.5 m, centred at (5, 5). */
const uStair = (over: Partial<Stair> = {}): Stair => ({
  id: 's1',
  x: 5,
  y: 5,
  width: 2.2,
  depth: 4.5,
  rotation: 0,
  type: 'U',
  turn: 'landing',
  hand: 'right',
  flightWidth: 1.0,
  ...over,
});

const floor = (id: string, level: number, stairs: Record<string, Stair> = {}): Floor => ({
  id,
  level,
  elevation: level * 3.35,
  wallHeight: 3.2,
  slabThickness: 0.15,
  nodes: {},
  walls: {},
  openings: {},
  rooms: {},
  items: {},
  columns: {},
  stairs,
});

function project(stair: Stair = uStair()): Project {
  return {
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors: [floor('g', 0, { [stair.id]: stair }), floor('u', 1)],
  } as Project;
}

let plans: H3xPlan[] = [];
function makePlan(doc = H3xDocument.fromProject(project()), opts: H3xPlanOptions = {}): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, doc, opts);
  plan.setView({ cx: 5, cy: 5, scale: 40 });
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

const P = 'h3x-plan';
const stairGroups = (plan: H3xPlan): SVGGElement[] =>
  Array.from(plan.svg.querySelectorAll<SVGGElement>(`.${P}-layer-stairs .${P}-stair`));
const okLayout = () => {
  const l = layoutStair(uStair(), 3.35);
  if (!l.ok) throw new Error('fixture stair must fit');
  return l;
};

describe('plan stairs: own floor', () => {
  it('draws steps, hidden steps above 1.2 m, a break line, a walking line with an arrow and UP', () => {
    const plan = makePlan();
    const groups = stairGroups(plan);
    expect(groups).toHaveLength(1);
    const g = groups[0]!;
    expect(g.getAttribute('data-h3x-kind')).toBe('stair');
    expect(g.getAttribute('data-h3x-id')).toBe('s1');
    const l = okLayout();
    const steps = g.querySelectorAll(`.${P}-stair-step`);
    expect(steps.length).toBe(l.steps.length + l.landings.length);
    const hidden = g.querySelectorAll(`.${P}-stair-hidden`);
    const expectedHidden = [...l.steps, ...l.landings].filter((s) => s.top > 1.2).length;
    expect(expectedHidden).toBeGreaterThan(0);
    expect(hidden.length).toBe(expectedHidden);
    expect(g.querySelectorAll(`.${P}-stair-break`)).toHaveLength(1);
    const walk = g.querySelector(`.${P}-stair-walk`)!;
    expect(walk.tagName).toBe('path');
    expect(walk.getAttribute('d')).toMatch(/^M/);
    expect(g.querySelectorAll(`.${P}-stair-arrow`)).toHaveLength(1);
    const label = g.querySelector(`.${P}-stair-label`)!;
    expect(label.textContent).toBe('UP');
    for (const cls of ['stair-step', 'stair-hidden', 'stair-walk', 'stair-break', 'stair-label']) {
      expect(DEFAULT_CSS(P)).toContain(`.${P}-${cls}`);
    }
  });

  it('sits in a stairs layer between rooms and walls', () => {
    const plan = makePlan();
    const layers = Array.from(plan.svg.querySelectorAll('g > g')).map((g) =>
      g.getAttribute('class'),
    );
    const at = layers.indexOf(`${P}-layer-stairs`);
    expect(at).toBeGreaterThan(layers.indexOf(`${P}-layer-rooms`));
    expect(at).toBeLessThan(layers.indexOf(`${P}-layer-walls`));
  });

  it('uses the stairLabels option', () => {
    const doc = H3xDocument.fromProject(project());
    const plan = makePlan(doc, { stairLabels: { up: 'LÊN', down: 'XUỐNG' } });
    expect(stairGroups(plan)[0]!.querySelector(`.${P}-stair-label`)!.textContent).toBe('LÊN');
    plan.doc.setActiveFloor('u');
    expect(plan.svg.querySelector(`.${P}-underlay .${P}-stair-label`)!.textContent).toBe('XUỐNG');
  });

  it('hit-tests the bay as the stair', () => {
    const plan = makePlan();
    expect(plan.hitAt(plan.planToScreen({ x: 5, y: 5 }))).toEqual({ kind: 'stair', id: 's1' });
    expect(plan.hitAt(plan.planToScreen({ x: 8, y: 5 }))).toBeNull();
  });

  it('a stair that does not fit draws only its bay outline, marked invalid', () => {
    const doc = H3xDocument.fromProject(project(uStair({ depth: 1.5 })));
    const plan = makePlan(doc);
    const g = stairGroups(plan)[0]!;
    expect(g.children).toHaveLength(1);
    expect(g.firstElementChild!.tagName).toBe('polygon');
    expect(g.firstElementChild!.getAttribute('points')!.split(' ')).toHaveLength(4);
    expect(g.classList.contains(`${P}-invalid`)).toBe(true);
  });

  it('re-renders on stair and floor changes', () => {
    const plan = makePlan();
    const count = () => stairGroups(plan)[0]!.querySelectorAll(`.${P}-stair-step`).length;
    const before = count();
    plan.doc.execute(updateStair('s1', { depth: 1.5 }));
    expect(count()).toBe(0);
    plan.doc.undo();
    expect(count()).toBe(before);
    plan.doc.execute(setFloorHeight('g', 2.5)); // lower rise → fewer risers
    expect(count()).toBeLessThan(before);
  });
});

describe('plan stairs: floor above', () => {
  const below = (plan: H3xPlan) => plan.svg.querySelector<SVGGElement>(`.${P}-underlay`)!;

  it('shows the opening, the steps and DN in the non-interactive underlay', () => {
    const plan = makePlan();
    expect(below(plan).querySelector(`.${P}-stair-opening`)).toBeNull();
    plan.doc.setActiveFloor('u');
    const u = below(plan);
    expect(u.getAttribute('pointer-events')).toBe('none');
    expect(u.querySelectorAll(`.${P}-stair-opening`)).toHaveLength(1);
    const l = okLayout();
    expect(u.querySelectorAll(`.${P}-stair-step`).length).toBe(l.steps.length + l.landings.length);
    expect(u.querySelector(`.${P}-stair-label`)!.textContent).toBe('DN');
    expect(stairGroups(plan)).toHaveLength(0);
    expect(plan.hitAt(plan.planToScreen({ x: 5, y: 5 }))).toBeNull();
    expect(DEFAULT_CSS(P)).toContain(`.${P}-stair-opening`);
  });

  it('refreshes when the stair below changes', () => {
    const plan = makePlan();
    plan.doc.execute(updateStair('s1', { depth: 1.5 }));
    plan.doc.setActiveFloor('u');
    expect(below(plan).querySelector(`.${P}-stair-opening`)).toBeNull();
    plan.doc.undo(); // a stair change on the floor below the active one
    expect(plan.doc.activeFloorId).toBe('u');
    expect(below(plan).querySelectorAll(`.${P}-stair-opening`)).toHaveLength(1);
  });
});
