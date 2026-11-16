// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { DrawSiteTool } from '../../src/plan/tools/DrawSiteTool';
import { DrawSiteTool as Exported } from '../../src/plan';
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
function makePlan(tool = new DrawSiteTool()): H3xPlan {
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

function key(plan: H3xPlan, k: string): void {
  plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

const previewLines = (plan: H3xPlan) => Array.from(plan.svg.querySelectorAll('.h3x-plan-preview'));
const site = (plan: H3xPlan) => plan.doc.project.site;

const corners = [
  { x: 20, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 10 },
  { x: 20, y: 10 },
];

describe('DrawSiteTool', () => {
  it('is exported from h3x/plan', () => {
    expect(Exported).toBe(DrawSiteTool);
  });

  it('4 clicks and a click on the first vertex set the site in one undo step', () => {
    const plan = makePlan();
    for (const c of corners) click(plan, c);
    expect(site(plan)).toBeUndefined();
    expect(plan.doc.canUndo).toBe(false);
    click(plan, corners[0]!);
    expect(site(plan)!.points).toEqual(corners);
    expect(plan.doc.undo()).toBe(true);
    expect(site(plan)).toBeUndefined();
    expect(plan.doc.canUndo).toBe(false);
  });

  it('previews the polygon so far plus the rubber band', () => {
    const plan = makePlan();
    click(plan, corners[0]!);
    click(plan, corners[1]!);
    fire(plan, 'pointermove', corners[2]!);
    expect(previewLines(plan)).toHaveLength(2);
  });

  it('Esc cancels the polygon without history', () => {
    const plan = makePlan();
    for (const c of corners) click(plan, c);
    key(plan, 'Escape');
    expect(previewLines(plan)).toHaveLength(0);
    click(plan, corners[0]!); // starts anew, does not close
    expect(site(plan)).toBeUndefined();
    expect(plan.doc.canUndo).toBe(false);
  });

  it('closing with fewer than 3 points does nothing', () => {
    const plan = makePlan();
    click(plan, corners[0]!);
    click(plan, corners[1]!);
    click(plan, corners[0]!);
    key(plan, 'Enter');
    fire(plan, 'dblclick', corners[1]!);
    expect(site(plan)).toBeUndefined();
    expect(plan.doc.canUndo).toBe(false);
    fire(plan, 'pointermove', corners[2]!);
    expect(previewLines(plan)).toHaveLength(2); // still drawing
  });

  it('Enter and double-click close with 3 or more points', () => {
    const a = makePlan();
    for (const c of corners.slice(0, 3)) click(a, c);
    key(a, 'Enter');
    expect(site(a)!.points).toHaveLength(3);
    const b = makePlan();
    for (const c of corners.slice(0, 3)) click(b, c);
    click(b, corners[2]!); // second click of a double-click: ignored duplicate
    fire(b, 'dblclick', corners[2]!);
    expect(site(b)!.points).toHaveLength(3);
    expect(b.doc.undo()).toBe(true);
    expect(b.doc.canUndo).toBe(false);
  });

  it('ignores node and wall targets: clicking on a wall puts the vertex on the grid', () => {
    const plan = makePlan();
    click(plan, { x: 4.01, y: 0.04 }); // on node n2 / wall w1 of the fixture
    click(plan, { x: 5, y: -5 });
    click(plan, { x: 8, y: -5 });
    key(plan, 'Enter');
    expect(site(plan)!.points).toContainEqual({ x: 4, y: 0 });
  });

  it('Alt disables snapping', () => {
    const plan = makePlan();
    for (const c of corners.slice(0, 2)) click(plan, c);
    fire(plan, 'pointermove', { x: 30.013, y: 10.017 }, { altKey: true });
    fire(plan, 'pointerdown', { x: 30.013, y: 10.017 }, { altKey: true });
    key(plan, 'Enter'); // only 3 points now
    expect(site(plan)!.points[2]!.x).toBeCloseTo(30.013, 6);
    expect(site(plan)!.points[2]!.y).toBeCloseTo(10.017, 6);
  });

  it('deactivate clears the preview and the polygon', () => {
    const tool = new DrawSiteTool();
    const plan = makePlan(tool);
    click(plan, corners[0]!);
    fire(plan, 'pointermove', corners[1]!);
    expect(previewLines(plan)).toHaveLength(1);
    plan.setTool(null);
    expect(previewLines(plan)).toHaveLength(0);
    plan.setTool(tool);
    fire(plan, 'pointermove', corners[2]!);
    expect(previewLines(plan)).toHaveLength(0);
  });
});
