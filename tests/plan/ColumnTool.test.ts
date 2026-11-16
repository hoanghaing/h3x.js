// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { ColumnTool } from '../../src/plan/tools/ColumnTool';
import { ColumnTool as Exported } from '../../src/plan';
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
function makePlan(tool = new ColumnTool()): H3xPlan {
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

function click(plan: H3xPlan, p: Vec2): void {
  fire(plan, 'pointermove', p);
  fire(plan, 'pointerdown', p);
  fire(plan, 'pointerup', p);
}

const columns = (plan: H3xPlan) => Object.values(plan.doc.floor.columns ?? {});

describe('ColumnTool', () => {
  it('is exported from h3x/plan', () => {
    expect(Exported).toBe(ColumnTool);
  });

  it('places a default square 0.3 column at the grid-snapped point and selects it', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', { x: 11.02, y: 2.98 });
    fire(plan, 'pointerdown', { x: 11.02, y: 2.98 });
    const [c] = columns(plan);
    expect(columns(plan)).toHaveLength(1);
    expect(c).toMatchObject({ x: 11, y: 3, shape: 'square', width: 0.3 });
    expect(plan.selection).toEqual({ kind: 'column', id: c!.id });
  });

  it('snaps to a node and to a wall line', () => {
    const plan = makePlan();
    click(plan, { x: 4.03, y: 0.04 });
    click(plan, { x: 2.013, y: 0.03 });
    const [a, b] = columns(plan);
    expect(a).toMatchObject({ x: 4, y: 0 });
    expect(b!.x).toBeCloseTo(2.013, 9);
    expect(b!.y).toBeCloseTo(0, 9);
  });

  it('one undo step per column', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    expect(columns(plan)).toHaveLength(2);
    expect(plan.doc.undo()).toBe(true);
    expect(columns(plan)).toHaveLength(1);
    expect(plan.doc.undo()).toBe(true);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('uses the shape and size options', () => {
    const plan = makePlan(new ColumnTool({ shape: 'round', width: 0.5 }));
    click(plan, { x: 10, y: 0 });
    expect(columns(plan)[0]).toMatchObject({ shape: 'round', width: 0.5 });
  });

  it('Alt disables snapping', () => {
    const plan = makePlan();
    fire(plan, 'pointermove', { x: 10.013, y: 0.017 }, { altKey: true });
    fire(plan, 'pointerdown', { x: 10.013, y: 0.017 }, { altKey: true });
    expect(columns(plan)[0]!.x).toBeCloseTo(10.013, 6);
    expect(columns(plan)[0]!.y).toBeCloseTo(0.017, 6);
  });

  it('deactivate clears the guides', () => {
    const tool = new ColumnTool();
    const plan = makePlan(tool);
    fire(plan, 'pointermove', { x: 4.03, y: 2 });
    plan.setTool(null);
    expect(plan.svg.querySelectorAll('.h3x-plan-guide')).toHaveLength(0);
  });
});
