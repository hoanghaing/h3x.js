// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { H3xDocument, type Floor, type Project } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import type { PlanPointerEvent, Tool, ToolContext } from '../../src/plan/tools/Tool';
import { DEFAULT_CSS } from '../../src/plan/style';
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
function makePlan(tool?: Tool | null, floor: Floor = oneRoomFloor()): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, docOf(floor), { tool });
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
  init: { pointerId?: number; button?: number; buttons?: number; pointerType?: string } = {},
): void {
  const e = new MouseEvent(type, {
    clientX: x,
    clientY: y,
    button: init.button ?? 0,
    buttons: init.buttons ?? 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  if (init.pointerType) Object.defineProperty(e, 'pointerType', { value: init.pointerType });
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

  it('snapDraw uses the plan snap options and an 8px reach', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    const ctx = vi.mocked(tool.activate).mock.calls[0]![0];
    const n1 = plan.doc.floor.nodes['n1']!;
    const reach = 8 / plan.view.scale;
    const near = ctx.snapDraw({ x: n1.x + reach * 0.9, y: n1.y }, undefined, false);
    expect(near.target).toEqual({ kind: 'node', id: 'n1' });
    expect(near.point).toEqual({ x: n1.x, y: n1.y });
    // Off the walls: a wall hit this close to n1 would snap to n1 (split-too-short guard).
    const far = ctx.snapDraw({ x: n1.x + reach * 1.5, y: n1.y + reach * 1.5 }, undefined, false);
    expect(far.target.kind).not.toBe('node');
    const off = ctx.snapDraw({ x: n1.x + 0.001, y: n1.y }, undefined, true);
    expect(off).toEqual({
      point: { x: n1.x + 0.001, y: n1.y },
      guides: [],
      target: { kind: 'free' },
    });
  });

  it('setTool mid-gesture: the new tool sees nothing of that press and panning works again', () => {
    const a = fakeTool(true);
    const b = fakeTool(true);
    const plan = makePlan(a.tool);
    pointer(plan.svg, 'pointerdown', 400, 300);
    plan.setTool(b.tool);
    pointer(plan.svg, 'pointermove', 450, 300);
    pointer(plan.svg, 'pointerup', 450, 300);
    expect(b.tool.onPointerMove).not.toHaveBeenCalled();
    expect(b.tool.onPointerUp).not.toHaveBeenCalled();
    plan.setTool(null);
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 400, 300);
    pointer(plan.svg, 'pointermove', 500, 300);
    pointer(plan.svg, 'pointerup', 500, 300);
    expect(plan.view.cx).toBeCloseTo(before.cx - 100 / before.scale);
  });

  it('a second pointer ends a consumed gesture with exactly one pointer up', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    pointer(plan.svg, 'pointerdown', 300, 300, { pointerId: 1 });
    pointer(plan.svg, 'pointerdown', 500, 300, { pointerId: 2 });
    pointer(plan.svg, 'pointerup', 300, 300, { pointerId: 1 });
    pointer(plan.svg, 'pointerup', 500, 300, { pointerId: 2 });
    expect(tool.onPointerUp).toHaveBeenCalledTimes(1);
  });

  it('after dispose no events reach the tool', () => {
    const { tool } = fakeTool(true);
    const plan = makePlan(tool);
    const svg = plan.svg;
    plan.dispose();
    pointer(svg, 'pointerdown', 400, 300);
    pointer(svg, 'pointermove', 410, 300);
    pointer(svg, 'pointerup', 410, 300);
    svg.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
    svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(tool.onPointerDown).not.toHaveBeenCalled();
    expect(tool.onPointerMove).not.toHaveBeenCalled();
    expect(tool.onKeyDown).not.toHaveBeenCalled();
  });

  it('the default stylesheet disables browser touch gestures', () => {
    expect(DEFAULT_CSS('h3x-plan')).toContain('touch-action: none');
  });
  it('a press and release over an open room reach the tool', () => {
    const { tool } = fakeTool(false);
    const floor = oneRoomFloor();
    floor.rooms['r1']!.walls = ['w1', 'w2'];
    const plan = makePlan(tool, floor);
    const s = plan.planToScreen({ x: 2, y: 2 });
    pointer(plan.svg, 'pointermove', s.x, s.y);
    pointer(plan.svg, 'pointerdown', s.x, s.y);
    pointer(plan.svg, 'pointerup', s.x, s.y);
    expect(tool.onPointerUp).toHaveBeenCalledTimes(1);
    expect(vi.mocked(tool.onPointerUp!).mock.calls[0]![0].hit).toBeNull();
  });

  it('a tool that throws in onPointerUp does not wedge input', () => {
    const { tool } = fakeTool(false);
    vi.mocked(tool.onPointerUp!).mockImplementationOnce(() => {
      throw new Error('tool bug');
    });
    const plan = makePlan(tool);
    // jsdom reports listener exceptions on window; swallow this expected one.
    const errors: unknown[] = [];
    const onError = (ev: ErrorEvent): void => {
      errors.push(ev.error);
      ev.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      pointer(plan.svg, 'pointerdown', 400, 300);
      pointer(plan.svg, 'pointerup', 400, 300);
    } finally {
      window.removeEventListener('error', onError);
    }
    expect(errors).toHaveLength(1);
    // Hovering after the release must not pan.
    const before = plan.view;
    pointer(plan.svg, 'pointermove', 500, 300);
    expect(plan.view.cx).toBe(before.cx);
    // The next empty-space drag pans.
    pointer(plan.svg, 'pointerdown', 400, 300);
    pointer(plan.svg, 'pointermove', 500, 300);
    pointer(plan.svg, 'pointerup', 500, 300);
    expect(plan.view.cx).toBeCloseTo(before.cx - 100 / before.scale);
  });

  it('a right-button drag neither pans nor reaches the tool', () => {
    const { tool } = fakeTool(false);
    const plan = makePlan(tool);
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 400, 300, { button: 2 });
    pointer(plan.svg, 'pointermove', 500, 300, { buttons: 2 });
    pointer(plan.svg, 'pointerup', 500, 300, { button: 2 });
    expect(plan.view.cx).toBe(before.cx);
    expect(tool.onPointerDown).not.toHaveBeenCalled();
  });

  it('a mouse pan ends when a move shows no buttons held (lost pointerup)', () => {
    const plan = makePlan();
    const before = plan.view;
    pointer(plan.svg, 'pointerdown', 400, 300, { pointerType: 'mouse', buttons: 1 });
    pointer(plan.svg, 'pointermove', 450, 300, { pointerType: 'mouse', buttons: 1 });
    const panned = plan.view.cx;
    expect(panned).toBeCloseTo(before.cx - 50 / before.scale);
    pointer(plan.svg, 'pointermove', 500, 300, { pointerType: 'mouse', buttons: 0 });
    pointer(plan.svg, 'pointermove', 550, 300, { pointerType: 'mouse', buttons: 0 });
    expect(plan.view.cx).toBe(panned);
    // A fresh press pans again.
    pointer(plan.svg, 'pointerdown', 400, 300, { pointerType: 'mouse', buttons: 1 });
    pointer(plan.svg, 'pointermove', 420, 300, { pointerType: 'mouse', buttons: 1 });
    expect(plan.view.cx).toBeCloseTo(panned - 20 / before.scale);
  });

  it('after a tool swap and a lost release, a buttonless mouse move drops the stale pointer and hovers', () => {
    const a = fakeTool(true);
    const b = fakeTool(true);
    const plan = makePlan(a.tool);
    pointer(plan.svg, 'pointerdown', 400, 300, { pointerType: 'mouse', buttons: 1 });
    plan.setTool(b.tool);
    // The pointerup never arrives; the mouse then moves with no button held.
    pointer(plan.svg, 'pointermove', 450, 300, { pointerType: 'mouse', buttons: 0 });
    expect(b.tool.onPointerMove).toHaveBeenCalledTimes(1);
    expect(b.tool.onPointerUp).not.toHaveBeenCalled();
    // A fresh press is a normal one-finger gesture for the new tool (not a pinch).
    pointer(plan.svg, 'pointerdown', 450, 300, { pointerType: 'mouse', buttons: 1 });
    expect(b.tool.onPointerDown).toHaveBeenCalledTimes(1);
  });
});
