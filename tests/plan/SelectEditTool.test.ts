// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, moveNode, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan, type H3xPlanOptions, type LengthEditRequest } from '../../src/plan/H3xPlan';
import { SelectEditTool } from '../../src/plan/tools/SelectEditTool';
import { SelectEditTool as Exported } from '../../src/plan';
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
function makePlan(opts: H3xPlanOptions = {}): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, docOf(oneRoomFloor()), opts);
  plan.fitToContent();
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

interface Mods {
  altKey?: boolean;
  shiftKey?: boolean;
}

// jsdom may lack PointerEvent: a MouseEvent with a pointerId stands in. The SVG's bounding
// rect is all zeros under jsdom, so client coordinates are screen coordinates.
function fire(plan: H3xPlan, type: string, p: Vec2, mods: Mods = {}): void {
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

function key(plan: H3xPlan, k: string, mods: Mods = {}): void {
  plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }));
}

/** Presses at `from`, moves through `steps` evenly spaced points to `to`; releases unless `hold`. */
function drag(plan: H3xPlan, from: Vec2, to: Vec2, steps = 5, mods: Mods = {}, hold = false) {
  fire(plan, 'pointerdown', from, mods);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    fire(
      plan,
      'pointermove',
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      mods,
    );
  }
  if (!hold) fire(plan, 'pointerup', to, mods);
}

const node = (plan: H3xPlan, id: string) => plan.doc.floor.nodes[id]!;
const at = (plan: H3xPlan, id: string): Vec2 => ({ x: node(plan, id).x, y: node(plan, id).y });

describe('SelectEditTool', () => {
  it('is the default tool and exported from h3x/plan', () => {
    const plan = makePlan();
    expect(plan.tool).toBeInstanceOf(SelectEditTool);
    expect(Exported).toBe(SelectEditTool);
    expect(makePlan({ tool: null }).tool).toBeNull();
  });

  it('click on a node selects it; click on empty space clears', () => {
    const plan = makePlan();
    fire(plan, 'pointerdown', at(plan, 'n1'));
    fire(plan, 'pointerup', at(plan, 'n1'));
    expect(plan.selection).toEqual({ kind: 'node', id: 'n1' });
    fire(plan, 'pointerdown', { x: 2, y: 2.5 });
    fire(plan, 'pointerup', { x: 2, y: 2.5 });
    expect(plan.selection).toBeNull();
    expect(plan.doc.canUndo).toBe(false);
  });

  it('dragging a node moves it with snapping as one undo step', () => {
    const plan = makePlan();
    drag(plan, at(plan, 'n2'), { x: 5.013, y: 0.004 });
    expect(at(plan, 'n2')).toEqual({ x: 5, y: 0 });
    expect(plan.selection).toEqual({ kind: 'node', id: 'n2' });
    expect(plan.doc.canUndo).toBe(true);
    plan.doc.undo();
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('a rejected step leaves the node at its last valid position; a valid one clears it', () => {
    const plan = makePlan();
    fire(plan, 'pointerdown', at(plan, 'n2'));
    fire(plan, 'pointermove', { x: 3.5, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 3.5, y: 0 });
    fire(plan, 'pointermove', at(plan, 'n1'));
    expect(at(plan, 'n2')).toEqual({ x: 3.5, y: 0 });
    expect(plan.issues.rejected[0]?.code).toBe('wall-too-short');
    fire(plan, 'pointermove', { x: 3, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 3, y: 0 });
    expect(plan.issues.rejected).toEqual([]);
    fire(plan, 'pointerup', { x: 3, y: 0 });
  });

  it('Alt disables snapping', () => {
    const plan = makePlan();
    const target = { x: 4.613, y: 0.237 };
    drag(plan, at(plan, 'n2'), target, 5, { altKey: true });
    const p = plan.screenToPlan(plan.planToScreen(target));
    expect(node(plan, 'n2').x).toBeCloseTo(p.x, 9);
    expect(node(plan, 'n2').y).toBeCloseTo(p.y, 9);
    expect(node(plan, 'n2').x).not.toBeCloseTo(4.6, 3);
  });

  it('aligns to other nodes and shows a guide while dragging', () => {
    const plan = makePlan({ snap: { grid: 0 } });
    const overlay = plan.svg.querySelector('.h3x-plan-layer-overlay')!;
    drag(plan, at(plan, 'n3'), { x: 4.03, y: 4.3 }, 5, {}, true);
    expect(node(plan, 'n3').x).toBe(4);
    expect(node(plan, 'n3').y).toBeCloseTo(4.3, 6);
    expect(overlay.children.length).toBe(1);
    fire(plan, 'pointerup', { x: 4.03, y: 4.3 });
    expect(overlay.children.length).toBe(0);
  });

  it('dragging a wall moves both nodes along its normal as one undo step', () => {
    const plan = makePlan();
    drag(plan, { x: 2, y: 4 }, { x: 2.2, y: 4.51 });
    expect(node(plan, 'n3').y).toBeCloseTo(4.5, 9);
    expect(node(plan, 'n4').y).toBeCloseTo(4.5, 9);
    expect(node(plan, 'n3').x).toBe(4);
    expect(plan.selection).toEqual({ kind: 'wall', id: 'w3' });
    plan.doc.undo();
    expect(node(plan, 'n3').y).toBe(4);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Esc mid-drag reverts the gesture and keeps the redo stack', () => {
    const plan = makePlan();
    plan.doc.execute(moveNode('n4', { x: -0.5, y: 4 }));
    plan.doc.undo();
    expect(plan.doc.canRedo).toBe(true);
    drag(plan, at(plan, 'n2'), { x: 5, y: 0 }, 5, {}, true);
    expect(at(plan, 'n2')).toEqual({ x: 5, y: 0 });
    key(plan, 'Escape');
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.doc.canUndo).toBe(false);
    expect(plan.doc.canRedo).toBe(true);
    // The rest of the press does nothing.
    fire(plan, 'pointermove', { x: 6, y: 0 });
    fire(plan, 'pointerup', { x: 6, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Esc without a gesture clears the selection', () => {
    const plan = makePlan();
    plan.select({ kind: 'node', id: 'n1' });
    key(plan, 'Escape');
    expect(plan.selection).toBeNull();
  });

  it('a document change from elsewhere ends the gesture', () => {
    const plan = makePlan();
    plan.doc.execute(moveNode('n4', { x: -0.5, y: 4 }));
    drag(plan, at(plan, 'n2'), { x: 5, y: 0 }, 5, {}, true);
    plan.doc.undo();
    const snapshot = structuredClone(plan.doc.floor);
    const { canUndo, canRedo } = plan.doc;
    fire(plan, 'pointermove', { x: 6, y: 0 });
    expect(plan.doc.floor).toEqual(snapshot);
    expect(() => fire(plan, 'pointerup', { x: 6, y: 0 })).not.toThrow();
    key(plan, 'Escape');
    expect(plan.doc.floor).toEqual(snapshot);
    expect(plan.doc.canUndo).toBe(canUndo);
    expect(plan.doc.canRedo).toBe(canRedo);
  });

  it('dragging back to the exact start then Esc is harmless', () => {
    const plan = makePlan();
    fire(plan, 'pointerdown', at(plan, 'n2'));
    fire(plan, 'pointermove', { x: 5, y: 0 });
    fire(plan, 'pointermove', { x: 4, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(() => key(plan, 'Escape')).not.toThrow();
    expect(plan.doc.canUndo).toBe(false);
    fire(plan, 'pointerup', { x: 4, y: 0 });
  });

  it('arrow keys nudge the selection, each press its own undo step', () => {
    const plan = makePlan();
    plan.select({ kind: 'node', id: 'n2' });
    key(plan, 'ArrowRight');
    expect(node(plan, 'n2').x).toBeCloseTo(4.01, 9);
    expect(node(plan, 'n2').y).toBe(0);
    plan.select({ kind: 'wall', id: 'w1' });
    key(plan, 'ArrowUp', { shiftKey: true });
    expect(node(plan, 'n1').y).toBeCloseTo(0.1, 9);
    expect(node(plan, 'n2').y).toBeCloseTo(0.1, 9);
    plan.doc.undo();
    expect(node(plan, 'n1').y).toBe(0);
    expect(node(plan, 'n2').x).toBeCloseTo(4.01, 9);
    plan.doc.undo();
    expect(node(plan, 'n2').x).toBe(4);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('a rejected nudge is reported', () => {
    const plan = makePlan({ tool: new SelectEditTool({ nudge: 3.9 }) });
    plan.select({ kind: 'node', id: 'n2' });
    key(plan, 'ArrowLeft');
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.issues.rejected.length).toBeGreaterThan(0);
  });

  it('double-clicking a dimension label requests a length edit', () => {
    const plan = makePlan();
    const rect = plan.dimensionRects().get('w1')!;
    const got: LengthEditRequest[] = [];
    plan.on('lengthEditRequest', (e) => got.push(e));
    const c = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    plan.svg.dispatchEvent(
      new MouseEvent('dblclick', { clientX: c.x, clientY: c.y, bubbles: true }),
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.wallId).toBe('w1');
    expect(got[0]!.length).toBeCloseTo(4, 9);
  });

  it('setTool(null) mid-drag ends the gesture as one undo step', () => {
    const plan = makePlan();
    drag(plan, at(plan, 'n2'), { x: 5, y: 0 }, 5, {}, true);
    plan.setTool(null);
    fire(plan, 'pointermove', { x: 6, y: 0 });
    fire(plan, 'pointerup', { x: 6, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 5, y: 0 });
    plan.doc.undo();
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.doc.canUndo).toBe(false);
  });
});
