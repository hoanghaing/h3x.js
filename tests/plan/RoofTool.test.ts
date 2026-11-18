// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { RoofTool } from '../../src/plan/tools/RoofTool';
import { RoofTool as Exported } from '../../src/plan';
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
function makePlan(tool: RoofTool): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, docOf(oneRoomFloor()), { tool });
  plan.fitToContent();
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
const roofs = (plan: H3xPlan) => Object.values(plan.doc.floor.roofs);

describe('RoofTool', () => {
  it('is exported from h3x/plan', () => {
    expect(Exported).toBe(RoofTool);
  });

  it('follow mode: a click in a room adds a follow roof on it and selects it', () => {
    const plan = makePlan(new RoofTool({ preset: 'gable' }));
    click(plan, { x: 2, y: 2 });
    const [r] = roofs(plan);
    expect(roofs(plan)).toHaveLength(1);
    expect(r!.follow).toBe(true);
    expect(r!.rooms).toEqual(['r1']);
    expect(r!.preset).toBe('gable');
    expect(plan.selection).toEqual({ kind: 'roof', id: r!.id });
  });

  it('follow mode defaults to the thai preset', () => {
    const plan = makePlan(new RoofTool());
    click(plan, { x: 2, y: 2 });
    expect(roofs(plan)[0]!.preset).toBe('thai');
  });

  it('follow mode: a click outside every room is rejected with roof-no-room', () => {
    const plan = makePlan(new RoofTool());
    click(plan, { x: 9, y: 9 });
    expect(roofs(plan)).toHaveLength(0);
    expect(plan.issues.rejected.map((i) => i.code)).toEqual(['roof-no-room']);
  });

  it('draw mode: four clicks and a click on the first point add an independent roof', () => {
    const plan = makePlan(new RoofTool({ mode: 'draw', preset: 'gable' }));
    for (const p of [
      { x: 0, y: 6 },
      { x: 4, y: 6 },
      { x: 4, y: 9 },
      { x: 0, y: 9 },
    ]) {
      click(plan, p);
    }
    expect(roofs(plan)).toHaveLength(0);
    click(plan, { x: 0, y: 6 });
    const [r] = roofs(plan);
    expect(roofs(plan)).toHaveLength(1);
    expect(r!.follow).toBe(false);
    expect(r!.points).toHaveLength(4);
    expect(r!.edges).toHaveLength(4);
    expect(plan.selection).toEqual({ kind: 'roof', id: r!.id });
  });

  it('draw mode: Esc mid-draw leaves no roof', () => {
    const plan = makePlan(new RoofTool({ mode: 'draw' }));
    click(plan, { x: 0, y: 6 });
    click(plan, { x: 4, y: 6 });
    click(plan, { x: 4, y: 9 });
    plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(roofs(plan)).toHaveLength(0);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('follow mode: a click on an existing roof replaces its kind instead of stacking a new one', () => {
    const tool = new RoofTool({ preset: 'thai' });
    const plan = makePlan(tool);
    click(plan, { x: 2, y: 2 });
    const id = roofs(plan)[0]!.id;
    tool.setOptions({ preset: 'metal' });
    click(plan, { x: 2, y: 2 });
    expect(roofs(plan)).toHaveLength(1);
    expect(roofs(plan)[0]!.id).toBe(id);
    expect(roofs(plan)[0]!.preset).toBe('metal');
    expect(plan.selection).toEqual({ kind: 'roof', id });
    plan.doc.undo();
    expect(roofs(plan)[0]!.preset).toBe('thai');
  });

  it('Delete removes the selected roof while the tool is active', () => {
    const plan = makePlan(new RoofTool());
    click(plan, { x: 2, y: 2 });
    plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(roofs(plan)).toHaveLength(0);
    expect(plan.selection).toBeNull();
  });

  it('setOptions switches the mode and cancels a drawing in progress', () => {
    const tool = new RoofTool({ mode: 'draw' });
    const plan = makePlan(tool);
    click(plan, { x: 10, y: 10 });
    click(plan, { x: 13, y: 10 });
    tool.setOptions({ mode: 'follow' });
    click(plan, { x: 2, y: 2 });
    expect(roofs(plan)).toHaveLength(1);
    expect(roofs(plan)[0]!.follow).toBe(true);
  });
});

describe('H3xPlan.deleteSelection', () => {
  it('deletes the selected entity in one undo step, and returns false with nothing selected', () => {
    const plan = makePlan(new RoofTool());
    expect(plan.deleteSelection()).toBe(false);
    click(plan, { x: 2, y: 2 });
    expect(plan.deleteSelection()).toBe(true);
    expect(roofs(plan)).toHaveLength(0);
    plan.doc.undo();
    expect(roofs(plan)).toHaveLength(1);
    plan.select({ kind: 'wall', id: Object.keys(plan.doc.floor.walls)[0]! });
    const walls = Object.keys(plan.doc.floor.walls).length;
    expect(plan.deleteSelection()).toBe(true);
    expect(Object.keys(plan.doc.floor.walls)).toHaveLength(walls - 1);
  });
});
