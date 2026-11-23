// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  H3xDocument,
  addOpening,
  openingGeometry,
  type Floor,
  type Opening,
  type Project,
  type Vec2,
} from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { paintOpening } from '../../src/plan/openings';
import { OpeningTool } from '../../src/plan/tools/OpeningTool';
import { OpeningTool as Exported } from '../../src/plan';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

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

let plans: H3xPlan[] = [];
function makePlan(tool: OpeningTool = new OpeningTool({ preset: 'door-single-01' })): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, docOf(oneRoomFloor()), { tool });
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

// The SVG's bounding rect is all zeros under jsdom, so client coordinates are screen coordinates.
function fire(plan: H3xPlan, type: string, p: Vec2, mods: { altKey?: boolean } = {}): void {
  const s = plan.planToScreen(p);
  const e = new MouseEvent(type, {
    clientX: s.x,
    clientY: s.y,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  plan.svg.dispatchEvent(e);
}

function click(plan: H3xPlan, p: Vec2, mods: { altKey?: boolean } = {}): void {
  fire(plan, 'pointermove', p, mods);
  fire(plan, 'pointerdown', p, mods);
  fire(plan, 'pointerup', p, mods);
}

function key(plan: H3xPlan, k: string, type = 'keydown'): KeyboardEvent {
  const e = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true });
  plan.svg.dispatchEvent(e);
  return e;
}

const ghost = (plan: H3xPlan): SVGGElement | null => plan.svg.querySelector('.h3x-plan-ghost');

interface Paths {
  gap: string | null;
  arcs: string | null;
  lines: string | null;
}

function pathsOf(g: Element): Paths {
  return {
    gap: g.querySelector('.h3x-plan-opening-gap')!.getAttribute('points'),
    arcs: g.querySelector('.h3x-plan-opening-arc')!.getAttribute('d'),
    lines: g.querySelector('.h3x-plan-opening-lines')!.getAttribute('d'),
  };
}

function expected(floor: Floor, o: Partial<Opening>): Paths {
  const opening: Opening = {
    id: 'x',
    wall: 'w3',
    preset: 'door-single-01',
    offset: 2,
    width: 0.9,
    height: 2.1,
    sill: 0,
    type: 'door-swing',
    hinge: 'a',
    swing: 'left',
    ...o,
  };
  const s = paintOpening(openingGeometry(floor, opening)!);
  return { gap: s.gap, arcs: s.arcs, lines: s.lines };
}

const openings = (plan: H3xPlan) => Object.values(plan.doc.floor.openings);
const added = (plan: H3xPlan) => openings(plan).filter((o) => o.id !== 'o1');

// w3 runs from (4, 4) to (0, 4), 0.2 thick; its left side faces the room (y < 4).
const NEAR_W3 = { x: 2.03, y: 3.95 };

describe('OpeningTool', () => {
  it('is exported from h3x/plan', () => {
    expect(Exported).toBe(OpeningTool);
  });

  it('hover draws the symbol the click places, and changes no document', () => {
    const plan = makePlan();
    let changes = 0;
    plan.doc.on('change', () => changes++);
    fire(plan, 'pointermove', NEAR_W3);
    const g = ghost(plan);
    expect(g).not.toBeNull();
    expect(g!.classList.contains('h3x-plan-invalid')).toBe(false);
    const hovered = pathsOf(g!);
    // Snapped to the middle of w3; swing on the pointer side.
    expect(hovered).toEqual(expected(plan.doc.floor, { offset: 2 }));
    expect(changes).toBe(0);
    expect(plan.doc.canUndo).toBe(false);
    expect(openings(plan)).toHaveLength(1);

    fire(plan, 'pointerdown', NEAR_W3);
    const [o] = added(plan);
    expect(o).toMatchObject({ wall: 'w3', preset: 'door-single-01', hinge: 'a', swing: 'left' });
    expect(o!.offset).toBeCloseTo(2, 9);
    expect(pathsOf(plan.getElement('opening', o!.id)!)).toEqual(hovered);
  });

  it('shows the snap guides of the placement and clears them when the ghost goes', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    expect(plan.svg.querySelectorAll('.h3x-plan-ghost-guide').length).toBeGreaterThan(0);
    key(plan, 'Escape');
    expect(plan.svg.querySelectorAll('.h3x-plan-ghost-guide')).toHaveLength(0);
  });

  it('a click is one undo step, selects the new opening and keeps the tool', () => {
    const tool = new OpeningTool({ preset: 'door-single-01' });
    const plan = makePlan(tool);
    click(plan, NEAR_W3);
    const [o] = added(plan);
    expect(plan.selection).toEqual({ kind: 'opening', id: o!.id });
    expect(plan.tool).toBe(tool);
    expect(plan.issues.rejected).toEqual([]);

    click(plan, { x: 3.95, y: 2.03 });
    expect(added(plan)).toHaveLength(2);
    expect(added(plan)[1]!.wall).toBe('w2');

    expect(plan.doc.undo()).toBe(true);
    expect(added(plan)).toHaveLength(1);
    expect(plan.doc.undo()).toBe(true);
    expect(added(plan)).toHaveLength(0);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('an invalid position shows a red ghost; the click adds nothing and reports why', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', { x: 1.4, y: 0.05 }); // over o1 on w1
    expect(ghost(plan)!.classList.contains('h3x-plan-invalid')).toBe(true);
    fire(plan, 'pointerdown', { x: 1.4, y: 0.05 });
    expect(added(plan)).toHaveLength(0);
    expect(plan.doc.canUndo).toBe(false);
    expect(plan.issues.rejected.map((i) => i.code)).toEqual(['opening-overlap']);
    expect(plan.issues.rejected[0]!.ids).toEqual(['o1']);
  });

  it('with no wall in reach: a free red bar at the pointer and placement-no-host', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', { x: 2, y: 2 });
    const g = ghost(plan)!;
    expect(g.classList.contains('h3x-plan-invalid')).toBe(true);
    const p = pathsOf(g);
    expect(p.gap).toBe('');
    expect(p.arcs).toBe('');
    const n = (p.lines ?? '').match(/-?[\d.e-]+/g)!.map(Number);
    expect(n).toHaveLength(4);
    [1.55, 2, 2.45, 2].forEach((v, i) => expect(n[i]).toBeCloseTo(v, 6));
    expect(plan.svg.querySelectorAll('.h3x-plan-ghost-guide')).toHaveLength(0);
    fire(plan, 'pointerdown', { x: 2, y: 2 });
    expect(added(plan)).toHaveLength(0);
    expect(plan.issues.rejected.map((i) => i.code)).toEqual(['placement-no-host']);
  });

  it('Space cycles hinge and swing; it survives moves until the host changes', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    expect(key(plan, ' ').defaultPrevented).toBe(true);
    expect(pathsOf(ghost(plan)!)).toEqual(expected(plan.doc.floor, { hinge: 'b' }));
    key(plan, ' ');
    expect(pathsOf(ghost(plan)!)).toEqual(expected(plan.doc.floor, { hinge: 'b', swing: 'right' }));

    // Along the wall and across it: the choice stays.
    fire(plan, 'pointermove', { x: 1.03, y: 4.05 });
    expect(pathsOf(ghost(plan)!)).toEqual(
      expected(plan.doc.floor, { offset: 2.95, hinge: 'b', swing: 'right' }),
    );
    fire(plan, 'pointermove', { x: 1.03, y: 3.95 });
    click(plan, { x: 1.03, y: 3.95 });
    expect(added(plan)[0]).toMatchObject({ wall: 'w3', hinge: 'b', swing: 'right' });

    // Another host drops it.
    fire(plan, 'pointermove', { x: 3.95, y: 2.53 });
    fire(plan, 'pointermove', { x: 2.53, y: 3.95 });
    expect(pathsOf(ghost(plan)!)).toEqual(expected(plan.doc.floor, { offset: 1.45 }));
  });

  it('Space does nothing without a host or for a type with no orientation', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', { x: 2, y: 2 });
    expect(key(plan, ' ').defaultPrevented).toBe(false);
    const plan2 = makePlan(new OpeningTool({ preset: 'window-01' }));
    fire(plan2, 'pointermove', NEAR_W3);
    expect(key(plan2, ' ').defaultPrevented).toBe(false);
  });

  it('Alt places without snapping', () => {
    const plan = makePlan();
    click(plan, NEAR_W3, { altKey: true });
    expect(added(plan)[0]!.offset).toBeCloseTo(1.97, 6);
    expect(plan.svg.querySelectorAll('.h3x-plan-ghost-guide')).toHaveLength(0);
  });

  it('Esc clears the ghost; the next move shows it again', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    expect(key(plan, 'Escape').defaultPrevented).toBe(true);
    expect(ghost(plan)).toBeNull();
    expect(key(plan, 'Escape').defaultPrevented).toBe(false);
    fire(plan, 'pointermove', NEAR_W3);
    expect(ghost(plan)).not.toBeNull();
  });

  it('a tool change clears the ghost and the guides', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    plan.setTool(null);
    expect(ghost(plan)).toBeNull();
    expect(plan.svg.querySelectorAll('.h3x-plan-ghost-guide')).toHaveLength(0);
  });

  it('setOptions changes the preset live', () => {
    const tool = new OpeningTool({ preset: 'door-single-01' });
    const plan = makePlan(tool);
    fire(plan, 'pointermove', NEAR_W3);
    tool.setOptions({ preset: 'window-01' });
    expect(pathsOf(ghost(plan)!)).toEqual(
      expected(plan.doc.floor, {
        preset: 'window-01',
        width: 1.2,
        height: 1.4,
        sill: 0.9,
        type: 'window-fixed',
      }),
    );
    fire(plan, 'pointerdown', NEAR_W3);
    expect(added(plan)[0]).toMatchObject({ preset: 'window-01', width: 1.2, sill: 0.9 });
  });

  it('Alt pressed or released without a move redraws the ghost', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    key(plan, 'Alt');
    expect(pathsOf(ghost(plan)!)).toEqual(expected(plan.doc.floor, { offset: 1.97 }));
    expect(plan.svg.querySelectorAll('.h3x-plan-ghost-guide')).toHaveLength(0);
    key(plan, 'Alt', 'keyup');
    expect(pathsOf(ghost(plan)!)).toEqual(expected(plan.doc.floor, { offset: 2 }));
  });

  it('guide ticks have their own class and survive other guides being cleared', () => {
    const tool = new OpeningTool({ preset: 'door-single-01' });
    const plan = makePlan(tool);
    fire(plan, 'pointermove', NEAR_W3);
    const ticks = plan.svg.querySelectorAll('.h3x-plan-ghost-guide');
    expect(ticks.length).toBeGreaterThan(0);
    expect(plan.svg.querySelectorAll('.h3x-plan-guide')).toHaveLength(0);
    (tool as unknown as { ctx: { showGuides(g: []): void } }).ctx.showGuides([]);
    expect(plan.svg.querySelectorAll('.h3x-plan-ghost-guide')).toHaveLength(ticks.length);
  });

  it('reach follows the zoom', () => {
    const plan = makePlan();
    const p = { x: 2.03, y: 3.75 }; // 0.15 m from the face of w3
    plan.setView({ scale: 100 }); // reach 0.24 m
    fire(plan, 'pointermove', p);
    expect(ghost(plan)!.classList.contains('h3x-plan-ghost-free')).toBe(false);
    plan.setView({ scale: 400 }); // reach 0.06 m
    click(plan, p);
    expect(ghost(plan)!.classList.contains('h3x-plan-ghost-free')).toBe(true);
    expect(added(plan)).toHaveLength(0);
    expect(plan.issues.rejected.map((i) => i.code)).toEqual(['placement-no-host']);
  });

  it('Esc forgets the Space choice', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    key(plan, ' ');
    key(plan, 'Escape');
    fire(plan, 'pointermove', NEAR_W3);
    expect(pathsOf(ghost(plan)!)).toEqual(expected(plan.doc.floor, {}));
  });

  it('the ghost hides after a successful click until the next move', () => {
    const plan = makePlan();
    click(plan, NEAR_W3);
    expect(added(plan)).toHaveLength(1);
    expect(ghost(plan)).toBeNull();
    fire(plan, 'pointermove', { x: 3.95, y: 2.03 });
    expect(ghost(plan)).not.toBeNull();
  });

  it('a preset that is not an opening preset adds nothing and says so', () => {
    const plan = makePlan(new OpeningTool({ preset: 'no-such-preset' }));
    click(plan, NEAR_W3);
    expect(added(plan)).toHaveLength(0);
    expect(plan.issues.rejected.map((i) => i.code)).toEqual(['unknown-preset']);
  });

  it('an edit the document rejects is reported and nothing is selected', () => {
    const plan = makePlan();
    const issue = { code: 'some-issue', ids: ['w3'], message: 'no' };
    vi.spyOn(plan.doc, 'tryExecute').mockReturnValue({ ok: false, issues: [issue] });
    click(plan, NEAR_W3);
    expect(added(plan)).toHaveLength(0);
    expect(plan.selection).toBeNull();
    expect(plan.issues.rejected).toEqual([issue]);
  });

  it('the ghost follows document changes while it is shown (undo during hover)', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    plan.doc.execute(addOpening({ wall: 'w3', preset: 'door-single-01', offset: 2 }));
    expect(ghost(plan)!.classList.contains('h3x-plan-invalid')).toBe(true);
    plan.doc.undo();
    expect(ghost(plan)!.classList.contains('h3x-plan-invalid')).toBe(false);
  });

  it('leaving the plan hides the ghost; a hidden ghost ignores document changes', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', NEAR_W3);
    plan.svg.dispatchEvent(new MouseEvent('pointerleave'));
    expect(ghost(plan)).toBeNull();
    plan.doc.execute(addOpening({ wall: 'w1', preset: 'door-single-01', offset: 3 }));
    expect(ghost(plan)).toBeNull();
  });

  it('after a tool change, document changes draw no ghost', () => {
    const tool = new OpeningTool({ preset: 'door-single-01' });
    const plan = makePlan(tool);
    fire(plan, 'pointermove', NEAR_W3);
    plan.setTool(null);
    plan.doc.execute(addOpening({ wall: 'w1', preset: 'door-single-01', offset: 3 }));
    expect(ghost(plan)).toBeNull();
    tool.setOptions({ preset: 'window-01' });
    expect(ghost(plan)).toBeNull();
  });
});
