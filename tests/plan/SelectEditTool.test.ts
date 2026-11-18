// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addColumn,
  addFloor,
  addRoof,
  addStair,
  addWall,
  moveNode,
  roofGeometry,
  setSite,
  validateStairs,
  splitWall,
  type Floor,
  type Id,
  type Project,
  type Vec2,
} from '../../src/core';
import { HISTORY_LIMIT } from '../../src/core/document/history';
import {
  H3xPlan,
  type H3xPlanOptions,
  type LengthEditRequest,
  type RoofEdgeRequest,
} from '../../src/plan/H3xPlan';
import { roofHandles } from '../../src/plan/roofEdit';
import { SelectEditTool } from '../../src/plan/tools/SelectEditTool';
import { SelectEditTool as Exported } from '../../src/plan';
import { oneRoomFloor, testPresets } from '../fixtures/floors';
import { acuteFloor, lFloor } from '../fixtures/irregular';

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
    // Aligned with n1 (a guide) but too close to it: w1 would be 0.2 m.
    fire(plan, 'pointermove', { x: 0.2, y: 0.02 });
    expect(at(plan, 'n2')).toEqual({ x: 3.5, y: 0 });
    expect(plan.issues.rejected[0]?.code).toBe('wall-too-short');
    // The guide of the snapped (rejected) point is not shown.
    expect(plan.svg.querySelector('.h3x-plan-layer-overlay')!.children.length).toBe(0);
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
    expect(node(plan, 'n3').y).toBe(4.5);
    expect(node(plan, 'n4').y).toBe(4.5);
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
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    plan.svg.dispatchEvent(e);
    expect(plan.selection).toBeNull();
    expect(e.defaultPrevented).toBe(true);
  });

  it('Esc with nothing selected and no gesture is not handled', () => {
    const plan = makePlan();
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    plan.svg.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
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

  it('a keyless command from elsewhere ends the gesture, keeping its own undo step', () => {
    const plan = makePlan();
    drag(plan, at(plan, 'n2'), { x: 5, y: 0 }, 5, {}, true);
    plan.doc.execute(moveNode('n4', { x: -0.5, y: 4 }));
    fire(plan, 'pointermove', { x: 6, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 5, y: 0 });
    key(plan, 'Escape');
    expect(at(plan, 'n2')).toEqual({ x: 5, y: 0 });
    fire(plan, 'pointerup', { x: 6, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 5, y: 0 });
    plan.doc.undo();
    expect(at(plan, 'n4')).toEqual({ x: 0, y: 4 });
    expect(at(plan, 'n2')).toEqual({ x: 5, y: 0 });
    plan.doc.undo();
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('dragging back to the exact start then Esc is harmless and keeps the redo stack', () => {
    const plan = makePlan();
    plan.doc.execute(moveNode('n4', { x: -0.5, y: 4 }));
    plan.doc.undo();
    fire(plan, 'pointerdown', at(plan, 'n2'));
    fire(plan, 'pointermove', { x: 5, y: 0 });
    fire(plan, 'pointermove', { x: 4, y: 0 });
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(() => key(plan, 'Escape')).not.toThrow();
    expect(plan.doc.canUndo).toBe(false);
    expect(plan.doc.canRedo).toBe(true);
    fire(plan, 'pointerup', { x: 4, y: 0 });
    plan.doc.redo();
    expect(at(plan, 'n4')).toEqual({ x: -0.5, y: 4 });
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
    key(plan, 'ArrowDown');
    expect(at(plan, 'n2')).toEqual({ x: 4, y: -3.9 });
    expect(plan.issues.rejected).toEqual([]);
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

function dblclick(plan: H3xPlan, p: Vec2): void {
  const s = plan.planToScreen(p);
  plan.svg.dispatchEvent(new MouseEvent('dblclick', { clientX: s.x, clientY: s.y, bubbles: true }));
}

function keyEvent(plan: H3xPlan, k: string, mods: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  plan.svg.dispatchEvent(e);
  return e;
}

const hitKind = (plan: H3xPlan, p: Vec2) => plan.hitAt(plan.planToScreen(p))?.kind;
const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const nodeAt = (plan: H3xPlan, p: Vec2): Id | undefined =>
  Object.values(plan.doc.floor.nodes).find((n) => near(n, p))?.id;
const wallBetween = (plan: H3xPlan, a: Id, b: Id): Id | undefined =>
  Object.values(plan.doc.floor.walls).find(
    (w) => (w.a === a && w.b === b) || (w.a === b && w.b === a),
  )?.id;
const dropMarks = (plan: H3xPlan) => plan.svg.querySelectorAll('.h3x-plan-drop-target').length;

describe('SelectEditTool structural gestures', () => {
  it('double-click on a wall body inserts a point there and selects it, one undo step', () => {
    const plan = makePlan();
    expect(hitKind(plan, { x: 4, y: 1 })).toBe('wall');
    dblclick(plan, { x: 4.03, y: 1 });
    const id = nodeAt(plan, { x: 4, y: 1 });
    expect(id).toBeDefined();
    expect(Object.keys(plan.doc.floor.walls)).toHaveLength(5);
    expect(plan.selection).toEqual({ kind: 'node', id });
    plan.doc.undo();
    expect(Object.keys(plan.doc.floor.nodes)).toHaveLength(4);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('a rejected insert point is reported', () => {
    const plan = makePlan();
    expect(hitKind(plan, { x: 4, y: 0.2 })).toBe('wall');
    dblclick(plan, { x: 4, y: 0.2 });
    expect(Object.keys(plan.doc.floor.nodes)).toHaveLength(4);
    expect(plan.issues.rejected[0]?.code).toBe('split-too-short');
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Delete removes a selected node, Backspace a selected wall; one undo step each', () => {
    const plan = makePlan();
    plan.select({ kind: 'node', id: 'n2' });
    expect(keyEvent(plan, 'Delete').defaultPrevented).toBe(true);
    expect(plan.doc.floor.nodes.n2).toBeUndefined();
    expect(plan.selection).toBeNull();
    plan.doc.undo();
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.doc.canUndo).toBe(false);

    plan.select({ kind: 'wall', id: 'w3' });
    keyEvent(plan, 'Backspace');
    expect(plan.doc.floor.walls.w3).toBeUndefined();
    expect(plan.selection).toBeNull();
    plan.doc.undo();
    expect(plan.doc.floor.walls.w3).toBeDefined();
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Delete removes a selected column and the selected site', () => {
    const plan = makePlan();
    const add = addColumn({ x: 2, y: 2, shape: 'square', width: 0.3 });
    plan.doc.execute(add);
    plan.doc.execute(
      setSite([
        { x: -2, y: -2 },
        { x: 6, y: -2 },
        { x: 6, y: 6 },
      ]),
    );
    fire(plan, 'pointerdown', { x: 2, y: 2 });
    fire(plan, 'pointerup', { x: 2, y: 2 });
    expect(plan.selection).toEqual({ kind: 'column', id: add.createdId });
    keyEvent(plan, 'Delete');
    expect(plan.doc.floor.columns[add.createdId]).toBeUndefined();
    expect(plan.selection).toBeNull();

    fire(plan, 'pointerdown', { x: 2, y: -2 });
    fire(plan, 'pointerup', { x: 2, y: -2 });
    expect(plan.selection).toEqual({ kind: 'site', id: 'site' });
    keyEvent(plan, 'Backspace');
    expect(plan.doc.project.site).toBeUndefined();
    expect(plan.selection).toBeNull();
    plan.doc.undo();
    expect(plan.doc.project.site?.points).toHaveLength(3);
    plan.doc.undo();
    expect(plan.doc.floor.columns[add.createdId]).toBeDefined();
  });

  it('Delete with nothing relevant selected is not handled', () => {
    const plan = makePlan();
    expect(keyEvent(plan, 'Delete').defaultPrevented).toBe(false);
    plan.select({ kind: 'room', id: 'r1' });
    expect(keyEvent(plan, 'Backspace').defaultPrevented).toBe(false);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Delete / Backspace with Ctrl, Meta or Alt held are not handled', () => {
    const plan = makePlan();
    plan.select({ kind: 'node', id: 'n2' });
    expect(keyEvent(plan, 'Delete', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(keyEvent(plan, 'Backspace', { metaKey: true }).defaultPrevented).toBe(false);
    expect(keyEvent(plan, 'Delete', { altKey: true }).defaultPrevented).toBe(false);
    expect(plan.doc.floor.nodes.n2).toBeDefined();
    expect(plan.doc.canUndo).toBe(false);
  });

  it('dragging a column moves it snapped as one undo step; Alt is free', () => {
    const plan = makePlan();
    const add = addColumn({ x: 2, y: 2, shape: 'square', width: 0.3 });
    plan.doc.execute(add);
    const col = () => plan.doc.floor.columns[add.createdId]!;
    drag(plan, { x: 2, y: 2 }, { x: 2.513, y: 1.004 });
    expect({ x: col().x, y: col().y }).toEqual({ x: 2.5, y: 1 });
    expect(plan.selection).toEqual({ kind: 'column', id: add.createdId });
    plan.doc.undo();
    expect({ x: col().x, y: col().y }).toEqual({ x: 2, y: 2 });
    drag(plan, { x: 2, y: 2 }, { x: 2.513, y: 1.004 }, 5, { altKey: true });
    expect(col().x).not.toBeCloseTo(2.5, 3);
  });

  it('Esc cancels a column drag with no history; arrows nudge a column', () => {
    const plan = makePlan();
    const add = addColumn({ x: 2, y: 2, shape: 'square', width: 0.3 });
    plan.doc.execute(add);
    const col = () => plan.doc.floor.columns[add.createdId]!;
    drag(plan, { x: 2, y: 2 }, { x: 3, y: 2 }, 5, {}, true);
    expect(col().x).toBe(3);
    key(plan, 'Escape');
    fire(plan, 'pointerup', { x: 3, y: 2 });
    expect(col().x).toBe(2);
    plan.doc.undo();
    expect(plan.doc.floor.columns[add.createdId]).toBeUndefined();
    plan.doc.redo();

    plan.select({ kind: 'column', id: add.createdId });
    key(plan, 'ArrowRight');
    expect(col().x).toBeCloseTo(2.01, 9);
    key(plan, 'ArrowUp', { shiftKey: true });
    expect(col().y).toBeCloseTo(2.1, 9);
    plan.doc.undo();
    plan.doc.undo();
    expect({ x: col().x, y: col().y }).toEqual({ x: 2, y: 2 });
  });

  /** Splits w2 at y = 1 and y = 3; returns the middle segment (needs connectors when pushed). */
  function middleSegment(plan: H3xPlan): Id {
    const s1 = splitWall('w2', { x: 4, y: 1 });
    plan.doc.execute(s1);
    const upper = Object.values(plan.doc.floor.walls).find(
      (w) => (w.a === s1.createdId || w.b === s1.createdId) && w.a !== 'n2' && w.b !== 'n2',
    )!;
    const s2 = splitWall(upper.id, { x: 4, y: 3 });
    plan.doc.execute(s2);
    return wallBetween(plan, s1.createdId, s2.createdId)!;
  }

  it('Shift + wall drag pushes / pulls the wall as one undo step', () => {
    const plan = makePlan();
    const mid = middleSegment(plan);
    const before = structuredClone(plan.doc.floor);
    const walls = Object.keys(before.walls).length;
    expect(hitKind(plan, { x: 4, y: 1.5 })).toBe('wall');
    drag(plan, { x: 4, y: 1.5 }, { x: 5.02, y: 1.6 }, 5, { shiftKey: true });
    const w = plan.doc.floor.walls[mid]!;
    expect(node(plan, w.a).x).toBe(5);
    expect(node(plan, w.b).x).toBe(5);
    expect(Object.keys(plan.doc.floor.walls)).toHaveLength(walls + 2);
    expect(plan.issues.rejected).toEqual([]);
    plan.doc.undo();
    expect(plan.doc.floor).toEqual(before);
  });

  /** Fills the undo stack to HISTORY_LIMIT with distinct steps (moving n4 back and forth). */
  function fillHistory(plan: H3xPlan): void {
    for (let i = 1; i <= HISTORY_LIMIT; i++) {
      plan.doc.execute(moveNode('n4', { x: i % 2 ? -0.1 : 0, y: 4 }));
    }
  }
  function undoDepth(plan: H3xPlan): number {
    let n = 0;
    while (plan.doc.undo()) n++;
    return n;
  }

  it('push / pull on a full history keeps every old entry (release and Esc)', () => {
    // Released with a push applied: one new entry (the oldest is trimmed as usual).
    const plan = makePlan();
    middleSegment(plan);
    fillHistory(plan);
    drag(plan, { x: 4, y: 1.5 }, { x: 5, y: 1.5 }, 3, { shiftKey: true }, true);
    fire(plan, 'pointermove', { x: 4, y: 1.5 }, { shiftKey: true });
    fire(plan, 'pointermove', { x: 5, y: 1.5 }, { shiftKey: true });
    fire(plan, 'pointerup', { x: 5, y: 1.5 }, { shiftKey: true });
    plan.doc.undo(); // the push
    expect(undoDepth(plan)).toBe(HISTORY_LIMIT - 1);

    // Out and back to zero (the group is dropped), released: no entry lost.
    const back = makePlan();
    middleSegment(back);
    fillHistory(back);
    drag(back, { x: 4, y: 1.5 }, { x: 5, y: 1.5 }, 3, { shiftKey: true }, true);
    fire(back, 'pointermove', { x: 4, y: 1.5 }, { shiftKey: true });
    fire(back, 'pointerup', { x: 4, y: 1.5 }, { shiftKey: true });
    expect(undoDepth(back)).toBe(HISTORY_LIMIT);

    // Esc: no entry lost.
    const esc = makePlan();
    middleSegment(esc);
    fillHistory(esc);
    drag(esc, { x: 4, y: 1.5 }, { x: 5, y: 1.5 }, 3, { shiftKey: true }, true);
    key(esc, 'Escape');
    fire(esc, 'pointerup', { x: 5, y: 1.5 }, { shiftKey: true });
    expect(undoDepth(esc)).toBe(HISTORY_LIMIT);
  });

  it('push / pull below the connector minimum still shows alignment guides', () => {
    const plan = makePlan();
    middleSegment(plan);
    plan.doc.execute(
      addWall({ from: { at: { x: 4.2, y: 5 } }, to: { at: { x: 4.2, y: 6 } }, thickness: 0.2 }),
    );
    const before = structuredClone(plan.doc.floor);
    const guides = () => plan.svg.querySelectorAll('.h3x-plan-guide').length;
    drag(plan, { x: 4, y: 1.5 }, { x: 4.213, y: 1.5 }, 5, { shiftKey: true }, true);
    expect(plan.doc.floor).toEqual(before);
    expect(guides()).toBe(1);
    fire(plan, 'pointerup', { x: 4.213, y: 1.5 }, { shiftKey: true });
    expect(guides()).toBe(0);
    expect(plan.doc.floor).toEqual(before);
  });

  it('push / pull below the connector minimum leaves the document unchanged; Esc cancels', () => {
    const plan = makePlan();
    const mid = middleSegment(plan);
    const before = structuredClone(plan.doc.floor);
    drag(plan, { x: 4, y: 1.5 }, { x: 4.2, y: 1.5 }, 5, { shiftKey: true }, true);
    expect(plan.doc.floor).toEqual(before);
    expect(plan.issues.rejected).toEqual([]);
    fire(plan, 'pointermove', { x: 5, y: 1.5 }, { shiftKey: true });
    expect(node(plan, plan.doc.floor.walls[mid]!.a).x).toBe(5);
    // Back below the minimum: the earlier bump-out is dropped, the document is unchanged.
    fire(plan, 'pointermove', { x: 4.1, y: 1.5 }, { shiftKey: true });
    expect(plan.doc.floor).toEqual(before);
    expect(plan.issues.rejected).toEqual([]);
    key(plan, 'Escape');
    expect(plan.doc.floor).toEqual(before);
    fire(plan, 'pointerup', { x: 4.1, y: 1.5 }, { shiftKey: true });
    expect(plan.doc.floor).toEqual(before);
    plan.doc.undo();
    expect(Object.keys(plan.doc.floor.nodes)).toHaveLength(5); // the second split was undone
  });

  it('push / pull out and back below the minimum, released: a no-op', () => {
    const plan = makePlan();
    middleSegment(plan);
    const before = structuredClone(plan.doc.floor);
    drag(plan, { x: 4, y: 1.5 }, { x: 5, y: 1.5 }, 3, { shiftKey: true }, true);
    fire(plan, 'pointermove', { x: 4.1, y: 1.5 }, { shiftKey: true });
    expect(plan.doc.floor).toEqual(before);
    fire(plan, 'pointerup', { x: 4.1, y: 1.5 }, { shiftKey: true });
    expect(plan.doc.floor).toEqual(before);
    plan.doc.undo();
    expect(Object.keys(plan.doc.floor.nodes)).toHaveLength(5); // the second split was undone
  });

  it('a node dragged onto another node is not moved while snapped; release merges in the same undo step', () => {
    const plan = makePlan();
    drag(plan, at(plan, 'n3'), { x: 0, y: 0 }, 2, {}, true);
    expect(at(plan, 'n3')).toEqual({ x: 2, y: 2 });
    expect(dropMarks(plan)).toBe(1);
    fire(plan, 'pointerup', { x: 0, y: 0 });
    expect(dropMarks(plan)).toBe(0);
    expect(plan.doc.floor.nodes.n3).toBeUndefined();
    expect(plan.selection).toEqual({ kind: 'node', id: 'n1' });
    plan.doc.undo();
    expect(at(plan, 'n3')).toEqual({ x: 4, y: 4 });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('a node dragged onto its neighbour merges them, collapsing their wall, one undo step', () => {
    const plan = makePlan();
    drag(plan, at(plan, 'n2'), at(plan, 'n3'), 5, {}, true);
    expect(dropMarks(plan)).toBe(1);
    expect(plan.issues.rejected).toEqual([]);
    fire(plan, 'pointerup', at(plan, 'n3'));
    expect(plan.doc.floor.nodes.n2).toBeUndefined();
    expect(plan.doc.floor.walls.w2).toBeUndefined();
    expect(Object.keys(plan.doc.floor.walls)).toHaveLength(3);
    expect(plan.selection).toEqual({ kind: 'node', id: 'n3' });
    plan.doc.undo();
    expect(at(plan, 'n2')).toEqual({ x: 4, y: 0 });
    expect(plan.doc.floor.walls.w2).toBeDefined();
    expect(plan.doc.canUndo).toBe(false);
  });

  it('a node dragged onto a wall makes a T-junction on release', () => {
    const plan = makePlan();
    const add = addWall({
      from: { at: { x: 2, y: 1 } },
      to: { at: { x: 2, y: 3 } },
      thickness: 0.2,
    });
    plan.doc.execute(add);
    const before = structuredClone(plan.doc.floor);
    const free = add.endNodeId;
    drag(plan, { x: 2, y: 3 }, { x: 2.01, y: 4.02 }, 5, {}, true);
    expect(at(plan, free).y).toBeLessThan(4);
    expect(dropMarks(plan)).toBe(1);
    fire(plan, 'pointerup', { x: 2.01, y: 4.02 });
    expect(plan.doc.floor.nodes[free]).toBeUndefined();
    const t = nodeAt(plan, { x: 2.01, y: 4 });
    expect(t).toBeDefined();
    expect(wallBetween(plan, t!, 'n3')).toBeDefined();
    expect(wallBetween(plan, t!, 'n4')).toBeDefined();
    expect(wallBetween(plan, t!, nodeAt(plan, { x: 2, y: 1 })!)).toBeDefined();
    plan.doc.undo();
    expect(plan.doc.floor).toEqual(before);
  });

  it('a node dropped onto a wall 0.2 m from its corner joins the corner node', () => {
    const plan = makePlan();
    const add = addWall({
      from: { at: { x: 2, y: 1 } },
      to: { at: { x: 2, y: 3 } },
      thickness: 0.2,
    });
    plan.doc.execute(add);
    const free = add.endNodeId;
    drag(plan, { x: 2, y: 3 }, { x: 3.8, y: 4.02 }, 5, {}, true);
    expect(dropMarks(plan)).toBe(1);
    fire(plan, 'pointerup', { x: 3.8, y: 4.02 });
    expect(plan.issues.rejected).toEqual([]);
    expect(plan.doc.floor.nodes[free]).toBeUndefined();
    expect(wallBetween(plan, 'n3', nodeAt(plan, { x: 2, y: 1 })!)).toBeDefined();
    expect(plan.selection).toEqual({ kind: 'node', id: 'n3' });
  });

  it('dragging off the target again moves the node and clears the mark', () => {
    const plan = makePlan();
    drag(plan, at(plan, 'n3'), { x: 0, y: 0 }, 2, {}, true);
    fire(plan, 'pointermove', { x: 1, y: 1 });
    expect(at(plan, 'n3')).toEqual({ x: 1, y: 1 });
    expect(dropMarks(plan)).toBe(0);
    fire(plan, 'pointerup', { x: 1, y: 1 });
    expect(plan.doc.floor.nodes.n3).toBeDefined();
  });
});

describe('SelectEditTool stairs', () => {
  it('selects, drags (one undo step) and deletes a stair', () => {
    const plan = makePlan();
    const add = addStair({ x: 2, y: 2, width: 2, depth: 3 });
    plan.doc.execute(add);
    const st = () => plan.doc.floor.stairs[add.createdId]!;
    fire(plan, 'pointerdown', { x: 2, y: 2 });
    fire(plan, 'pointerup', { x: 2, y: 2 });
    expect(plan.selection).toEqual({ kind: 'stair', id: add.createdId });
    drag(plan, { x: 2, y: 2 }, { x: 2.5, y: 1 });
    expect(st().x).toBeCloseTo(2.5, 9);
    expect(st().y).toBeCloseTo(1, 9);
    plan.doc.undo();
    expect({ x: st().x, y: st().y }).toEqual({ x: 2, y: 2 });
    key(plan, 'Delete');
    expect(plan.doc.floor.stairs[add.createdId]).toBeUndefined();
  });

  it('arrows nudge a selected stair', () => {
    const plan = makePlan();
    const add = addStair({ x: 2, y: 2, width: 2, depth: 3 });
    plan.doc.execute(add);
    plan.select({ kind: 'stair', id: add.createdId });
    key(plan, 'ArrowRight');
    key(plan, 'ArrowUp', { shiftKey: true });
    const st = plan.doc.floor.stairs[add.createdId]!;
    expect(st.x).toBeCloseTo(2.01, 9);
    expect(st.y).toBeCloseTo(2.1, 9);
    expect(Object.keys(plan.doc.floor.columns)).toHaveLength(0);
  });

  function twoWells(align: boolean): H3xPlan {
    const f = oneRoomFloor();
    f.openings = {};
    f.nodes = {};
    f.walls = {};
    f.rooms = {};
    [0, 6].forEach((ox, r) => {
      const pts = [
        [0, 0],
        [2.4, 0],
        [2.4, 4.7],
        [0, 4.7],
      ];
      pts.forEach(([x, y], i) => {
        f.nodes[`n${r}${i}`] = { id: `n${r}${i}`, x: x! + ox, y: y! };
      });
      const wallIds = pts.map((_, i) => {
        const id = `w${r}${i}`;
        f.walls[id] = { id, a: `n${r}${i}`, b: `n${r}${(i + 1) % 4}`, thickness: 0.2, height: 3.2 };
        return id;
      });
      f.rooms[`r${r}`] = { id: `r${r}`, walls: wallIds, name: `r${r}` };
    });
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
    document.body.appendChild(el);
    const plan = new H3xPlan(el, docOf(f), { snap: { align } });
    plan.fitToContent();
    plans.push(plan);
    return plan;
  }

  it('dragging a bay onto another stairwell lands on its wall faces', () => {
    const plan = twoWells(true);
    const add = addStair({ x: 1.2, y: 2.35, width: 2.2, depth: 4.5 });
    plan.doc.execute(add);
    drag(plan, { x: 1.2, y: 2.35 }, { x: 7.23, y: 2.37 });
    const st = plan.doc.floor.stairs[add.createdId]!;
    expect(st.x).toBeCloseTo(7.2, 9);
    expect(st.y).toBeCloseTo(2.35, 9);
    expect(validateStairs(plan.doc.floor, undefined).map((w) => w.code)).not.toContain(
      'stair-overlaps-wall',
    );
  });

  it('with align off a dragged bay ignores wall faces (grid-snapped delta only)', () => {
    const plan = twoWells(false);
    const add = addStair({ x: 1.2, y: 2.35, width: 2.2, depth: 4.5 });
    plan.doc.execute(add);
    drag(plan, { x: 1.2, y: 2.35 }, { x: 7.23, y: 2.37 });
    const st = plan.doc.floor.stairs[add.createdId]!;
    expect(st.x).toBeCloseTo(7.25, 9);
    expect(st.y).toBeCloseTo(2.35, 9);
  });

  describe('on the townhouse sample', () => {
    function townhouse(): H3xPlan {
      const doc = H3xDocument.fromXML(readFileSync('examples/layouts/townhouse-3f.xml', 'utf8'), {
        presets: testPresets,
      });
      doc.setActiveFloor('f1');
      const el = document.createElement('div');
      Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
      Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
      document.body.appendChild(el);
      const plan = new H3xPlan(el, doc);
      plan.setView({ cx: 1.8, cy: 12.475, scale: 120 });
      plans.push(plan);
      return plan;
    }
    const bay = (plan: H3xPlan) => {
      const s = Object.values(plan.doc.floor.stairs)[0]!;
      return { x: s.x, y: s.y };
    };

    it('a click without movement selects the stair and does not move it', () => {
      const plan = townhouse();
      const before = bay(plan);
      fire(plan, 'pointermove', { x: 1.8, y: 12.475 });
      fire(plan, 'pointerdown', { x: 1.8, y: 12.475 });
      fire(plan, 'pointerup', { x: 1.8, y: 12.475 });
      expect(plan.selection?.kind).toBe('stair');
      expect(bay(plan)).toEqual(before);
      expect(plan.doc.canUndo).toBe(false);
    });

    it('a lost pointerup does not leave a press that drags the stair on later hover', () => {
      const plan = townhouse();
      const before = bay(plan);
      const hover = (p: Vec2) => {
        const sp = plan.planToScreen(p);
        const e = new MouseEvent('pointermove', {
          clientX: sp.x,
          clientY: sp.y,
          button: 0,
          buttons: 0,
          bubbles: true,
        });
        Object.defineProperty(e, 'pointerId', { value: 1 });
        Object.defineProperty(e, 'pointerType', { value: 'mouse' });
        plan.svg.dispatchEvent(e);
      };
      fire(plan, 'pointerdown', { x: 1.8, y: 12.475 });
      // The pointerup never arrives; the mouse then moves over the plan with no button held.
      hover({ x: 6, y: 10 });
      hover({ x: 20.65, y: 10 });
      expect(bay(plan)).toEqual(before);
      expect(plan.doc.canUndo).toBe(false);
    });

    it('a small drag moves the stair by exactly the pointer delta', () => {
      const plan = townhouse();
      drag(plan, { x: 1.8, y: 12.475 }, { x: 2.1, y: 12.475 });
      expect(bay(plan).x).toBeCloseTo(2.1, 9);
      expect(bay(plan).y).toBeCloseTo(12.475, 9);
      drag(plan, { x: 2.1, y: 12.475 }, { x: 2.1, y: 12.775 });
      expect(bay(plan).y).toBeCloseTo(12.775, 9);
    });
  });
});

describe('SelectEditTool stair outline', () => {
  /** One room with 3.4 × 3.4 inner faces (0.2 walls, nodes 0..3.6) and a floor above. */
  function squareRoom(): H3xPlan {
    const f = oneRoomFloor();
    f.openings = {};
    f.nodes = {
      n1: { id: 'n1', x: 0, y: 0 },
      n2: { id: 'n2', x: 3.6, y: 0 },
      n3: { id: 'n3', x: 3.6, y: 3.6 },
      n4: { id: 'n4', x: 0, y: 3.6 },
    };
    const doc = docOf(f);
    doc.execute(addFloor({ position: 'above' }));
    doc.setActiveFloor(f.id);
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
    document.body.appendChild(el);
    const plan = new H3xPlan(el, doc, { snap: { align: true } });
    plan.setView({ cx: 4, cy: 2, scale: 80 });
    plans.push(plan);
    return plan;
  }

  it('a spiral dragged into a room snaps its square (not its bay) onto the wall faces', () => {
    const plan = squareRoom();
    const add = addStair({ x: 7, y: 1.8, width: 3.4, depth: 4.85, type: 'spiral' });
    plan.doc.execute(add);
    // grab inside the square and drop it 3 cm off the centre of the room
    drag(plan, { x: 7, y: 1.8 }, { x: 1.83, y: 1.82 });
    const st = plan.doc.floor.stairs[add.createdId]!;
    expect(st.x).toBeCloseTo(1.8, 9);
    expect(st.y).toBeCloseTo(1.8, 9);
    const above = plan.doc.floorAbove(plan.doc.activeFloorId);
    expect(validateStairs(plan.doc.floor, above).map((w) => w.code)).toEqual([]);
  });

  it('a press inside the bay but outside the outline does not grab the stair', () => {
    const plan = squareRoom();
    const add = addStair({ x: 7, y: 1.8, width: 3.4, depth: 4.85, type: 'spiral' });
    plan.doc.execute(add);
    fire(plan, 'pointerdown', { x: 7, y: 3.9 }); // in the bay, above the 3.4 square
    fire(plan, 'pointerup', { x: 7, y: 3.9 });
    expect(plan.selection).toBeNull();
    fire(plan, 'pointerdown', { x: 7, y: 3.4 });
    fire(plan, 'pointerup', { x: 7, y: 3.4 });
    expect(plan.selection).toEqual({ kind: 'stair', id: add.createdId });
  });
});

describe('SelectEditTool roofs', () => {
  const followRoof = (plan: H3xPlan) => {
    const add = addRoof({ preset: 'hip', follow: true, rooms: ['r1'] });
    plan.doc.execute(add);
    return add.createdId;
  };
  const independent = (plan: H3xPlan) => {
    const add = addRoof({
      preset: 'gable',
      points: [
        { x: 6, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 6, y: 4 },
      ],
    });
    plan.doc.execute(add);
    return add.createdId;
  };
  const corner = (plan: H3xPlan, id: string, i: number): Vec2 =>
    roofGeometry(plan.doc.floor.roofs[id]!, plan.doc.floor).bodies[0]!.outline[0]![i]!;

  it('dragging a vertex of a follow roof detaches it and moves the vertex in one undo step', () => {
    const plan = makePlan();
    const id = followRoof(plan);
    plan.select({ kind: 'roof', id });
    const detached: unknown[] = [];
    plan.on('roofdetached', (e) => detached.push(e));
    const before = structuredClone(plan.doc.floor.roofs[id]!);
    const v = corner(plan, id, 0);
    drag(plan, v, { x: v.x - 1, y: v.y - 1 });
    const r = plan.doc.floor.roofs[id]!;
    expect(r.follow).toBe(false);
    expect(r.points).toHaveLength(4);
    expect(r.points![0]!.x).toBeCloseTo(v.x - 1, 1);
    expect(r.points![0]!.y).toBeCloseTo(v.y - 1, 1);
    expect(detached).toEqual([{ roofId: id, newIds: [] }]);
    plan.doc.undo();
    expect(plan.doc.floor.roofs[id]).toEqual(before);
  });

  it('dragging a vertex of an independent roof moves just that vertex', () => {
    const plan = makePlan();
    const id = independent(plan);
    plan.select({ kind: 'roof', id });
    const detached: unknown[] = [];
    plan.on('roofdetached', (e) => detached.push(e));
    drag(plan, { x: 10, y: 4 }, { x: 11, y: 5 });
    const pts = plan.doc.floor.roofs[id]!.points!;
    expect(pts[2]!.x).toBeCloseTo(11, 1);
    expect(pts[2]!.y).toBeCloseTo(5, 1);
    expect(pts[0]).toEqual({ x: 6, y: 0 });
    expect(detached).toEqual([]);
  });

  it('dragging inside an independent roof moves it by a grid-snapped delta', () => {
    const plan = makePlan();
    const id = independent(plan);
    drag(plan, { x: 8, y: 2 }, { x: 8.52, y: 3.01 });
    const pts = plan.doc.floor.roofs[id]!.points!;
    expect(pts[0]!.x).toBeCloseTo(6.5, 9);
    expect(pts[0]!.y).toBeCloseTo(1, 9);
    expect(plan.selection).toEqual({ kind: 'roof', id });
  });

  it('dragging inside a follow roof does nothing', () => {
    const plan = makePlan();
    const id = followRoof(plan);
    const before = structuredClone(plan.doc.floor.roofs[id]!);
    drag(plan, { x: 2, y: 2 }, { x: 3, y: 3 });
    expect(plan.doc.floor.roofs[id]).toEqual(before);
  });

  it('clicking the edge of the selected roof asks the editor for the edge', () => {
    const plan = makePlan();
    const id = followRoof(plan);
    plan.select({ kind: 'roof', id });
    const asked: RoofEdgeRequest[] = [];
    plan.on('roofEdgeRequest', (e) => asked.push(e));
    const a = corner(plan, id, 0);
    const b = corner(plan, id, 1);
    const mid = { x: (a.x + b.x) / 2 + 0.7, y: (a.y + b.y) / 2 - 0.03 }; // just outside the wall
    fire(plan, 'pointerdown', mid);
    fire(plan, 'pointerup', mid);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.roofId).toBe(id);
    expect(asked[0]!.index).toBe(0);
    expect(asked[0]!.wallId).toBe('w1');
    expect(asked[0]!.current).toEqual({ kind: 'slope', pitch: 30 });
    expect(plan.selection).toEqual({ kind: 'roof', id });
  });

  const planOf = (floor: Floor): H3xPlan => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
    document.body.appendChild(el);
    const plan = new H3xPlan(el, docOf(floor), {});
    plan.fitToContent();
    plans.push(plan);
    return plan;
  };
  const handles = (plan: H3xPlan): Element[] =>
    Array.from(plan.svg.querySelectorAll('.h3x-plan-roof-handle'));

  it('with a follow roof selected, clicking an outer wall selects the wall', () => {
    const plan = makePlan();
    const id = followRoof(plan);
    plan.select({ kind: 'roof', id });
    const asked: RoofEdgeRequest[] = [];
    plan.on('roofEdgeRequest', (e) => asked.push(e));
    const p = { x: 2.9, y: -0.1 }; // on the outer face of w1, away from the corners
    fire(plan, 'pointerdown', p);
    fire(plan, 'pointerup', p);
    expect(asked).toEqual([]);
    expect(plan.selection).toEqual({ kind: 'wall', id: 'w1' });
  });

  it.each([
    ['L-shaped', lFloor],
    ['acute (bevelled corner)', acuteFloor],
  ])('dragging handle k of a %s follow roof moves detached points[k]', (_n, make) => {
    const plan = planOf(make());
    const add = addRoof({ preset: 'hip', follow: true, rooms: ['r1'] });
    plan.doc.execute(add);
    const id = add.createdId;
    plan.select({ kind: 'roof', id });
    const verts = roofHandles(plan.doc.floor.roofs[id]!, plan.doc.floor).map((h) => h.at);
    expect(handles(plan)).toHaveLength(verts.length);
    for (let k = 0; k < verts.length; k++) {
      const p = plan.doc.floor.roofs[id]!;
      const before = structuredClone(p);
      const v = roofHandles(p, plan.doc.floor)[k]!.at;
      const to = { x: v.x + 0.3, y: v.y - 0.3 };
      drag(plan, v, to, 5, { altKey: true });
      const pts = plan.doc.floor.roofs[id]!.points!;
      expect(pts[k]!.x).toBeCloseTo(to.x, 1);
      expect(pts[k]!.y).toBeCloseTo(to.y, 1);
      expect(pts).toHaveLength(verts.length);
      plan.doc.undo();
      expect(plan.doc.floor.roofs[id]).toEqual(before);
    }
  });

  it('an edge click on a hole of an independent roof reports hole and index', () => {
    const plan = makePlan();
    const add = addRoof({
      preset: 'gable',
      points: [
        { x: 6, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 6 },
        { x: 6, y: 6 },
      ],
      holes: [
        [
          { x: 8, y: 2 },
          { x: 8, y: 4 },
          { x: 10, y: 4 },
          { x: 10, y: 2 },
        ],
      ],
    });
    plan.doc.execute(add);
    plan.select({ kind: 'roof', id: add.createdId });
    const asked: RoofEdgeRequest[] = [];
    plan.on('roofEdgeRequest', (e) => asked.push(e));
    const p = { x: 9, y: 4.02 }; // edge 2 of the hole, from (10, 4) to (8, 4)... index 1 is 8,4 to 10,4
    fire(plan, 'pointerdown', p);
    fire(plan, 'pointerup', p);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.hole).toBe(0);
    expect(asked[0]!.index).toBe(1);
    expect(asked[0]!.wallId).toBeUndefined();
  });

  it('handles follow the outline after a change that is not a selection change', () => {
    const plan = makePlan();
    const id = followRoof(plan);
    plan.select({ kind: 'roof', id });
    const pos = (): Vec2[] =>
      handles(plan).map((h) => {
        const m = /matrix\([^,]+,0,0,[^,]+,([-\d.e]+),([-\d.e]+)\)/.exec(
          h.getAttribute('transform') ?? '',
        )!;
        return { x: Number(m[1]), y: Number(m[2]) };
      });
    const expected = (): Vec2[] =>
      roofHandles(plan.doc.floor.roofs[id]!, plan.doc.floor).map((h) => h.at);
    const near = (a: Vec2[], b: Vec2[]) =>
      a.forEach((p, i) => {
        expect(p.x).toBeCloseTo(b[i]!.x, 3);
        expect(p.y).toBeCloseTo(b[i]!.y, 3);
      });
    near(pos(), expected());
    const before = expected();
    plan.doc.execute(moveNode('n3', { x: 6, y: 5 }));
    expect(expected()).not.toEqual(before);
    near(pos(), expected());
    plan.doc.undo();
    near(pos(), before);
  });

  it('Delete removes the selected roof', () => {
    const plan = makePlan();
    const id = followRoof(plan);
    plan.select({ kind: 'roof', id });
    key(plan, 'Delete');
    expect(plan.doc.floor.roofs[id]).toBeUndefined();
    expect(plan.selection).toBeNull();
  });
});

describe('SelectEditTool openings', () => {
  it('selects a door by clicking it and deletes it with Delete (one undo step)', () => {
    const plan = makePlan();
    const p = { x: 1.65, y: 0 };
    fire(plan, 'pointermove', p);
    fire(plan, 'pointerdown', p);
    fire(plan, 'pointerup', p);
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
    expect(plan.getElement('opening', 'o1')!.classList.contains('h3x-plan-selected')).toBe(true);
    key(plan, 'Delete');
    expect(plan.doc.floor.openings.o1).toBeUndefined();
    expect(plan.selection).toBeNull();
    plan.doc.undo();
    expect(plan.doc.floor.openings.o1).toBeDefined();
  });
});
