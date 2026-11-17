// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, validateStairs, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { StairTool } from '../../src/plan/tools/StairTool';
import { StairTool as Exported } from '../../src/plan';
import { snapBayCorner } from '../../src/plan/snap';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

// A 2.2 x 4.5 m room (inner faces) with 0.2 m walls.
function narrowRoom(): Floor {
  const f = oneRoomFloor();
  f.openings = {};
  f.nodes.n2 = { id: 'n2', x: 2.4, y: 0 };
  f.nodes.n3 = { id: 'n3', x: 2.4, y: 4.7 };
  f.nodes.n4 = { id: 'n4', x: 0, y: 4.7 };
  return f;
}

let plans: H3xPlan[] = [];
function makePlan(tool = new StairTool()): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const doc = H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [narrowRoom()],
    } as Project,
    { presets: testPresets },
  );
  const plan = new H3xPlan(el, doc, { tool });
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
const stairs = (plan: H3xPlan) => Object.values(plan.doc.floor.stairs);

describe('StairTool', () => {
  it('is exported from h3x/plan', () => {
    expect(Exported).toBe(StairTool);
  });

  it('a drag between two inner corners adds exactly that bay, clear of the walls', () => {
    const plan = makePlan();
    fire(plan, 'pointerdown', { x: 0.13, y: 0.12 });
    fire(plan, 'pointermove', { x: 1.5, y: 2 });
    fire(plan, 'pointermove', { x: 2.27, y: 4.58 });
    fire(plan, 'pointerup', { x: 2.27, y: 4.58 });
    const [s] = stairs(plan);
    expect(stairs(plan)).toHaveLength(1);
    expect(s!.x).toBeCloseTo(1.2, 9);
    expect(s!.y).toBeCloseTo(2.35, 9);
    expect(s!.width).toBeCloseTo(2.2, 9);
    expect(s!.depth).toBeCloseTo(4.5, 9);
    expect(s!.rotation).toBe(0);
    expect(validateStairs(plan.doc.floor, undefined).map((w) => w.code)).not.toContain(
      'stair-overlaps-wall',
    );
    expect(plan.doc.canUndo).toBe(true);
  });

  it('a drag with a side under 0.6 m adds nothing', () => {
    const plan = makePlan();
    fire(plan, 'pointerdown', { x: 1, y: 1 });
    fire(plan, 'pointermove', { x: 1.4, y: 3 });
    fire(plan, 'pointerup', { x: 1.4, y: 3 });
    expect(stairs(plan)).toHaveLength(0);
  });

  it('Esc mid-drag cancels', () => {
    const plan = makePlan();
    fire(plan, 'pointerdown', { x: 0.5, y: 0.5 });
    fire(plan, 'pointermove', { x: 2, y: 3 });
    plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fire(plan, 'pointerup', { x: 2, y: 3 });
    expect(stairs(plan)).toHaveLength(0);
  });

  it('uses the tool options', () => {
    const plan = makePlan(new StairTool({ type: 'L', hand: 'left' }));
    fire(plan, 'pointerdown', { x: 0.5, y: 0.5 });
    fire(plan, 'pointerup', { x: 2, y: 3 });
    expect(stairs(plan)[0]).toMatchObject({ type: 'L', hand: 'left' });
  });
});

describe('snapBayCorner', () => {
  const opts = { grid: 0.05, align: true, alignRadius: 0.08 };
  it('snaps to inner-outline vertices within the radius, else the grid', () => {
    const f = narrowRoom();
    const c = snapBayCorner({ x: 0.13, y: 0.14 }, f, opts).point;
    expect(c.x).toBeCloseTo(0.1, 9);
    expect(c.y).toBeCloseTo(0.1, 9);
    expect(snapBayCorner({ x: 1.01, y: 1.02 }, f, opts).point).toEqual({ x: 1, y: 1 });
  });
});

describe('StairTool tolerance and options', () => {
  it('an exact 0.6 m drag is accepted', () => {
    const plan = makePlan(new StairTool({ type: 'straight', flightWidth: 0.6 }));
    fire(plan, 'pointerdown', { x: 1, y: 1 });
    fire(plan, 'pointerup', { x: 1.6, y: 1.6 });
    expect(stairs(plan)).toHaveLength(1);
  });

  it('undefined options do not overwrite defaults', () => {
    const plan = makePlan(new StairTool({ hand: undefined, type: undefined, flightWidth: 0.7 }));
    fire(plan, 'pointerdown', { x: 0.5, y: 0.5 });
    fire(plan, 'pointerup', { x: 2, y: 3 });
    expect(stairs(plan)[0]).toMatchObject({ type: 'U', hand: 'right' });
  });
});
