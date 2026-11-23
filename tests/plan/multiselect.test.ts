// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, removeWall, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

type Mods = { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean };

let plans: H3xPlan[] = [];
function planOf(floor: Floor = oneRoomFloor()): H3xPlan {
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
  const plan = new H3xPlan(el, doc);
  plan.fitToContent();
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

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
const click = (plan: H3xPlan, p: Vec2, mods: Mods = {}): void => {
  fire(plan, 'pointerdown', p, mods);
  fire(plan, 'pointerup', p, mods);
};
function drag(plan: H3xPlan, from: Vec2, to: Vec2, mods: Mods = {}): void {
  fire(plan, 'pointerdown', from, mods);
  for (let i = 1; i <= 5; i++) {
    const t = i / 5;
    fire(
      plan,
      'pointermove',
      { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
      mods,
    );
  }
  fire(plan, 'pointerup', to, mods);
}
const key = (plan: H3xPlan, k: string, mods: Mods = {}): void => {
  plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...mods }));
};
const ids = (plan: H3xPlan): string[] => plan.selectionSet.map((s) => `${s.kind}:${s.id}`).sort();
const W2: Vec2 = { x: 4, y: 2 };
const W4: Vec2 = { x: 0, y: 2 };

describe('multiple selection', () => {
  it('Shift + click adds, Ctrl + click removes, a plain click starts over', () => {
    const plan = planOf();
    click(plan, W2);
    click(plan, W4, { shiftKey: true });
    expect(ids(plan)).toEqual(['wall:w2', 'wall:w4']);
    expect(plan.selection).toEqual({ kind: 'wall', id: 'w2' });
    const selected = plan.svg.querySelectorAll('.h3x-plan-selected');
    expect(selected.length).toBe(2);
    click(plan, W2, { ctrlKey: true });
    expect(ids(plan)).toEqual(['wall:w4']);
    click(plan, { x: 2, y: 4 });
    expect(ids(plan)).toEqual(['wall:w3']);
  });

  it('a Shift + click on empty space keeps the selection; a plain one clears it', () => {
    const plan = planOf();
    click(plan, W2);
    click(plan, { x: 9, y: 9 }, { shiftKey: true });
    expect(ids(plan)).toEqual(['wall:w2']);
    click(plan, { x: 9, y: 9 });
    expect(ids(plan)).toEqual([]);
  });

  it('dragging a member moves the whole selection as one undo step', () => {
    const plan = planOf();
    plan.selectMany([
      { kind: 'wall', id: 'w2' },
      { kind: 'wall', id: 'w4' },
    ]);
    drag(plan, W2, { x: 5, y: 2 });
    expect(plan.doc.floor.nodes.n1).toMatchObject({ x: 1, y: 0 });
    expect(plan.doc.floor.nodes.n3).toMatchObject({ x: 5, y: 4 });
    expect(ids(plan)).toEqual(['wall:w2', 'wall:w4']);
    plan.doc.undo();
    expect(plan.doc.floor.nodes.n1).toMatchObject({ x: 0, y: 0 });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Delete removes the whole selection in one step', () => {
    const plan = planOf();
    plan.selectMany([
      { kind: 'wall', id: 'w2' },
      { kind: 'wall', id: 'w4' },
    ]);
    key(plan, 'Delete');
    expect(Object.keys(plan.doc.floor.walls).sort()).toEqual(['w1', 'w3']);
    expect(ids(plan)).toEqual([]);
    plan.doc.undo();
    expect(Object.keys(plan.doc.floor.walls)).toHaveLength(4);
  });

  it('arrow keys nudge the whole selection', () => {
    const plan = planOf();
    plan.selectMany([
      { kind: 'wall', id: 'w1' },
      { kind: 'wall', id: 'w3' },
    ]);
    key(plan, 'ArrowUp', { shiftKey: true });
    expect(plan.doc.floor.nodes.n1!.y).toBeCloseTo(0.1, 9);
    expect(plan.doc.floor.nodes.n4!.y).toBeCloseTo(4.1, 9);
  });

  it('Shift + drag on empty space: left to right takes what is inside', () => {
    const plan = planOf();
    drag(plan, { x: -1, y: -1 }, { x: 5, y: 5 }, { shiftKey: true });
    expect(ids(plan)).toEqual(['opening:o1', 'wall:w1', 'wall:w2', 'wall:w3', 'wall:w4']);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('right to left takes what the box touches, added to the selection', () => {
    const plan = planOf();
    click(plan, W4);
    drag(plan, { x: 5, y: 5 }, { x: 3.95, y: 3 }, { shiftKey: true });
    expect(ids(plan)).toEqual(['wall:w2', 'wall:w3', 'wall:w4']);
  });

  it('turns and mirrors the selection about its centre', () => {
    const plan = planOf();
    plan.selectMany(['w1', 'w2', 'w3', 'w4'].map((id) => ({ kind: 'wall' as const, id })));
    const c = plan.selectionCenter()!;
    expect(c).toEqual({ x: 2, y: 2 });
    expect(plan.transformSelection({ kind: 'rotate', center: c, angle: Math.PI / 2 })).toBe(true);
    expect(plan.doc.floor.nodes.n1!.x).toBeCloseTo(4, 9);
    expect(plan.doc.floor.nodes.n1!.y).toBeCloseTo(0, 9);
    expect(plan.transformSelection({ kind: 'mirror', a: c, b: { x: c.x, y: c.y + 1 } })).toBe(true);
    expect(plan.doc.floor.openings.o1!.swing).toBe('right');
  });

  it('unknown ids are dropped and a removed member drops out', () => {
    const plan = planOf();
    plan.selectMany([
      { kind: 'wall', id: 'w2' },
      { kind: 'column', id: 'nope' },
      { kind: 'wall', id: 'w4' },
    ]);
    expect(ids(plan)).toEqual(['wall:w2', 'wall:w4']);
    plan.doc.execute(removeWall('w4'));
    expect(ids(plan)).toEqual(['wall:w2']);
  });
});
