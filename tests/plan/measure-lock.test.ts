// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { MeasureTool, type Measurement } from '../../src/plan/tools/MeasureTool';
import { MeasureTool as Exported } from '../../src/plan';
import type { Tool } from '../../src/plan/tools/Tool';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

let plans: H3xPlan[] = [];
function planOf(floor: Floor = oneRoomFloor(), tool?: Tool): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const doc = H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );
  const plan = new H3xPlan(el, doc, tool ? { tool } : {});
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
const click = (plan: H3xPlan, p: Vec2): void => {
  fire(plan, 'pointermove', p);
  fire(plan, 'pointerdown', p);
  fire(plan, 'pointerup', p);
};
const key = (plan: H3xPlan, k: string): void => {
  plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
};

describe('MeasureTool', () => {
  it('is exported', () => {
    expect(Exported).toBe(MeasureTool);
  });

  it('adds up segment lengths, closes for an area, and never edits', () => {
    const seen: Measurement[] = [];
    const tool = new MeasureTool({ onChange: (m) => seen.push(m) });
    const plan = planOf(oneRoomFloor(), tool);
    for (const p of [
      { x: 6, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 2 },
    ]) {
      click(plan, p);
    }
    expect(tool.measurement).toMatchObject({ length: 5, area: null, closed: false });
    fire(plan, 'pointermove', { x: 6, y: 2 });
    expect(plan.svg.querySelector('.h3x-plan-preview-label')?.textContent).toBe(
      '3.00 m (Σ 8.00 m)',
    );
    click(plan, { x: 6, y: 2 });
    click(plan, { x: 6.02, y: 0.02 });
    const m = tool.measurement;
    expect(m.closed).toBe(true);
    expect(m.area).toBeCloseTo(6, 9);
    expect(m.length).toBeCloseTo(10, 9);
    expect(seen.at(-1)?.closed).toBe(true);
    expect(plan.svg.querySelector('.h3x-plan-preview-label')?.textContent).toBe(
      '6.00 m² · 10.00 m',
    );
    expect(plan.doc.canUndo).toBe(false);
  });

  it('snaps like drawing: a wall midpoint', () => {
    const tool = new MeasureTool();
    const plan = planOf(oneRoomFloor(), tool);
    click(plan, { x: 2.03, y: 0.04 });
    expect(tool.measurement.points[0]).toEqual({ x: 2, y: 0 });
  });

  it('Backspace drops the last point or reopens; Esc starts over', () => {
    const tool = new MeasureTool();
    const plan = planOf(oneRoomFloor(), tool);
    for (const p of [
      { x: 6, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 2 },
      { x: 6, y: 0 },
    ]) {
      click(plan, p);
    }
    expect(tool.measurement.closed).toBe(true);
    key(plan, 'Backspace');
    expect(tool.measurement).toMatchObject({ closed: false, area: null });
    key(plan, 'Backspace');
    expect(tool.measurement.points).toHaveLength(2);
    key(plan, 'Escape');
    expect(tool.measurement.points).toHaveLength(0);
    expect(plan.svg.querySelector('.h3x-plan-preview')).toBeNull();
  });
});

describe('plan lock and align', () => {
  const withColumns = (): Floor => {
    const f = oneRoomFloor();
    f.columns.c1 = { id: 'c1', x: 1, y: 1, shape: 'square', width: 0.3, rotation: 0 };
    f.columns.c2 = { id: 'c2', x: 2.5, y: 2, shape: 'square', width: 0.3, rotation: 0 };
    return f;
  };

  it('lockSelection marks the elements and drags are rejected until unlocked', () => {
    const plan = planOf(withColumns());
    plan.select({ kind: 'column', id: 'c1' });
    expect(plan.lockSelection(true)).toBe(true);
    expect(plan.getElement('column', 'c1')!.classList.contains('h3x-plan-locked')).toBe(true);
    fire(plan, 'pointerdown', { x: 1, y: 1 });
    for (let i = 1; i <= 5; i++) fire(plan, 'pointermove', { x: 1 + i * 0.2, y: 1 });
    fire(plan, 'pointerup', { x: 2, y: 1 });
    expect(plan.doc.floor.columns.c1).toMatchObject({ x: 1, y: 1 });
    expect(plan.selection).toEqual({ kind: 'column', id: 'c1' });
    expect(plan.lockSelection(false)).toBe(true);
    expect(plan.getElement('column', 'c1')!.classList.contains('h3x-plan-locked')).toBe(false);
  });

  it('alignSelection lines up the selection; one object is not enough', () => {
    const plan = planOf(withColumns());
    plan.select({ kind: 'column', id: 'c1' });
    expect(plan.alignSelection('left')).toBe(false);
    plan.selectMany([
      { kind: 'column', id: 'c1' },
      { kind: 'column', id: 'c2' },
    ]);
    expect(plan.alignSelection('bottom')).toBe(true);
    expect(plan.doc.floor.columns.c2!.y).toBeCloseTo(1, 9);
  });
});
