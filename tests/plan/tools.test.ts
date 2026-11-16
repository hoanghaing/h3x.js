// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { H3xDocument, type Floor, type Project } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import type { PlanPointerEvent, Tool, ToolContext } from '../../src/plan/tools/Tool';
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
function makePlan(tool?: Tool | null): H3xPlan {
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

// jsdom may lack PointerEvent: a MouseEvent with a pointerId stands in.
function pointer(
  svg: Element,
  type: string,
  x: number,
  y: number,
  init: { pointerId?: number; button?: number } = {},
): void {
  const e = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: init.button ?? 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  svg.dispatchEvent(e);
}

function fakeTool(consume: boolean) {
  const events: PlanPointerEvent[] = [];
  const tool: Tool = {
    activate: vi.fn<(ctx: ToolContext) => void>(),
    deactivate: vi.fn(),
    onPointerDown: vi.fn((e: PlanPointerEvent) => {
      events.push(e);
      return consume;
    }),
    onPointerMove: vi.fn((e: PlanPointerEvent) => void events.push(e)),
    onPointerUp: vi.fn((e: PlanPointerEvent) => void events.push(e)),
    onKeyDown: vi.fn(() => true),
  };
  return { tool, events };
}

describe('tool dispatch', () => {
  it('delivers down/move/up with plan coordinates and the hit target', () => {
    const { tool, events } = fakeTool(true);
    const plan = makePlan(tool);
    const n1 = plan.doc.floor.nodes['n1']!;
    const s = plan.planToScreen(n1);
    pointer(plan.svg, 'pointerdown', s.x, s.y);
    pointer(plan.svg, 'pointermove', s.x + 30, s.y);
    pointer(plan.svg, 'pointerup', s.x + 30, s.y);
    expect(tool.onPointerDown).toHaveBeenCalledTimes(1);
    expect(tool.onPointerUp).toHaveBeenCalledTimes(1);
    expect(events[0]!.hit).toEqual({ kind: 'node', id: 'n1' });
    expect(events[0]!.plan.x).toBeCloseTo(n1.x);
    expect(events[0]!.plan.y).toBeCloseTo(n1.y);
    expect(events[1]!.plan).toEqual(plan.screenToPlan({ x: s.x + 30, y: s.y }));
  });

  it('does not pan while the tool consumes the press', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 400, 300);
    pointer(plan.svg, 'pointermove', 500, 300);
    pointer(plan.svg, 'pointerup', 500, 300);
    expect(plan.view.cx).toBe(before.cx);
  });

  it('pans when the tool returns false and still sends move/up', () => {
    const { tool } = fakeTool(false);
    const plan = makePlan(tool);
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 400, 300);
    pointer(plan.svg, 'pointermove', 500, 300);
    pointer(plan.svg, 'pointerup', 500, 300);
    expect(plan.view.cx).toBeCloseTo(before.cx - 100 / before.scale);
    expect(tool.onPointerMove).toHaveBeenCalled();
    expect(tool.onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('pans with the middle button without telling the tool', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 400, 300, { button: 1 });
    pointer(plan.svg, 'pointermove', 450, 300);
    pointer(plan.svg, 'pointerup', 450, 300);
    expect(tool.onPointerDown).not.toHaveBeenCalled();
    expect(tool.onPointerUp).not.toHaveBeenCalled();
    expect(plan.view.cx).toBeCloseTo(before.cx - 50 / before.scale);
  });

  it('delivers pointercancel as pointer up', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    pointer(plan.svg, 'pointerdown', 400, 300);
    pointer(plan.svg, 'pointercancel', 400, 300);
    expect(tool.onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('pans with no tool at all', () => {
    const plan = makePlan();
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 400, 300);
    pointer(plan.svg, 'pointermove', 400, 340);
    pointer(plan.svg, 'pointerup', 400, 340);
    expect(plan.view.cy).toBeCloseTo(before.cy + 40 / before.scale);
  });

  it('wheel zooms about the cursor', () => {
    const plan = makePlan();
    const at = { x: 250, y: 120 };
    const before = plan.view;
    const fixed = plan.screenToPlan(at);
    const e = new WheelEvent('wheel', {
      deltaY: -100,
      clientX: at.x,
      clientY: at.y,
      cancelable: true,
      bubbles: true,
    });
    plan.svg.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(plan.view.scale).toBeGreaterThan(before.scale);
    const after = plan.screenToPlan(at);
    expect(after.x).toBeCloseTo(fixed.x);
    expect(after.y).toBeCloseTo(fixed.y);
  });

  it('pinch zooms about the midpoint and starves the tool', () => {
    const { tool } = fakeTool(false);
    const plan = makePlan(tool);
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 300, 300, { pointerId: 1 });
    pointer(plan.svg, 'pointerdown', 500, 300, { pointerId: 2 });
    const moves = vi.mocked(tool.onPointerMove!).mock.calls.length;
    const fixed = plan.screenToPlan({ x: 400, y: 300 });
    pointer(plan.svg, 'pointermove', 200, 300, { pointerId: 1 });
    pointer(plan.svg, 'pointermove', 600, 300, { pointerId: 2 });
    expect(plan.view.scale).toBeGreaterThan(before.scale);
    expect(plan.screenToPlan({ x: 400, y: 300 }).x).toBeCloseTo(fixed.x);
    expect(vi.mocked(tool.onPointerMove!).mock.calls.length).toBe(moves);
    pointer(plan.svg, 'pointerup', 200, 300, { pointerId: 1 });
    pointer(plan.svg, 'pointerup', 600, 300, { pointerId: 2 });
    expect(tool.onPointerUp).not.toHaveBeenCalled();
  });

  it('setTool deactivates the old tool before activating the new; dispose deactivates', () => {
    const a = fakeTool(true);
    const b = fakeTool(true);
    const order: string[] = [];
    vi.mocked(a.tool.deactivate).mockImplementation(() => void order.push('a.deactivate'));
    vi.mocked(b.tool.activate).mockImplementation(() => void order.push('b.activate'));
    const plan = makePlan(a.tool);
    expect(plan.tool).toBe(a.tool);
    plan.setTool(b.tool);
    expect(order).toEqual(['a.deactivate', 'b.activate']);
    expect(plan.tool).toBe(b.tool);
    plan.dispose();
    expect(b.tool.deactivate).toHaveBeenCalledTimes(1);
  });

  it('forwards keydown to the tool', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    expect(plan.svg.getAttribute('tabindex')).toBe('0');
    plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(tool.onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('gives the tool a context that snaps, draws guides and marks dragging', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    const ctx = vi.mocked(tool.activate).mock.calls[0]![0];
    expect(ctx.plan).toBe(plan);
    expect(ctx.snap({ x: 1.234, y: 0.5 }, [], true).point).toEqual({ x: 1.234, y: 0.5 });
    expect(ctx.snap({ x: 1.234, y: 0.5 }, [], false).point.x).toBeCloseTo(1.25);
    ctx.showGuides([{ axis: 'x', value: 1, from: { x: 1, y: 0 } }]);
    expect(plan.svg.querySelectorAll('.h3x-plan-guide')).toHaveLength(1);
    ctx.showGuides([]);
    expect(plan.svg.querySelectorAll('.h3x-plan-guide')).toHaveLength(0);
    ctx.setDragging('n1');
    // only the two walls touching n1 show their lengths while it is dragged
    expect(plan.svg.querySelectorAll('.h3x-plan-layer-dimensions text')).toHaveLength(2);
  });
});
