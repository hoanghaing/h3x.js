// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  H3xDocument,
  removeOpening,
  setWallLength,
  type Floor,
  type Project,
} from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import type { LengthEditRequest } from '../../src/plan/H3xPlan';
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
function makePlan(): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, docOf(oneRoomFloor()));
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
  vi.useRealTimers();
});

const labels = (plan: H3xPlan): string[] =>
  Array.from(plan.svg.querySelectorAll('.h3x-plan-layer-dimensions text')).map(
    (t) => t.textContent ?? '',
  );

describe('selection', () => {
  it('marks the selected element and fires once per change', () => {
    const plan = makePlan();
    const fn = vi.fn();
    plan.on('selectionchange', fn);
    plan.select({ kind: 'wall', id: 'w1' });
    expect(plan.getElement('wall', 'w1')!.classList.contains('h3x-plan-selected')).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ kind: 'wall', id: 'w1' });
    plan.select({ kind: 'wall', id: 'w1' });
    expect(fn).toHaveBeenCalledTimes(1);
    plan.select({ kind: 'wall', id: 'nope' });
    expect(plan.selection).toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith(null);
    expect(plan.getElement('wall', 'w1')!.classList.contains('h3x-plan-selected')).toBe(false);
  });

  it('limits dimensions to the selected wall', () => {
    const plan = makePlan();
    plan.select({ kind: 'wall', id: 'w1' });
    expect(labels(plan)).toEqual(['4.00']);
    plan.select(null);
    expect(labels(plan)).toHaveLength(4);
  });
});

describe('issues', () => {
  it('marks standing problems and clears them on undo', () => {
    const plan = makePlan();
    const fn = vi.fn();
    plan.on('issues', fn);
    plan.doc.execute(setWallLength('w1', 1.0));
    expect(plan.getElement('opening', 'o1')!.classList.contains('h3x-plan-invalid')).toBe(true);
    expect(plan.issues.standing.map((i) => i.code)).toContain('opening-out-of-wall');
    // Layout and placement checks both find it; the list holds it once.
    expect(plan.issues.standing.filter((i) => i.code === 'opening-out-of-wall')).toHaveLength(1);
    expect(fn).toHaveBeenCalled();
    plan.doc.undo();
    expect(plan.getElement('opening', 'o1')!.classList.contains('h3x-plan-invalid')).toBe(false);
    expect(plan.issues.standing).toEqual([]);
  });

  it('flashes a rejected edit for 600 ms', () => {
    vi.useFakeTimers();
    const plan = makePlan();
    const res = plan.setWallLength('w1', 0.1);
    expect(res.ok).toBe(false);
    expect(plan.issues.rejected[0]!.code).toBe('wall-too-short');
    const w1 = plan.getElement('wall', 'w1')!;
    expect(w1.classList.contains('h3x-plan-rejected')).toBe(true);
    vi.advanceTimersByTime(600);
    expect(w1.classList.contains('h3x-plan-rejected')).toBe(false);
    expect(plan.issues.rejected).toEqual([]);
  });

  it('clears the flash timer on dispose', () => {
    vi.useFakeTimers();
    const plan = makePlan();
    plan.reportRejected([{ code: 'x', ids: ['w1'], message: 'm' }]);
    plan.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('setWallLength', () => {
  it('defaults the anchor by the pick rule', () => {
    const plan = makePlan();
    expect(plan.setWallLength('w1', 3)).toEqual({ ok: true });
    expect(plan.doc.floor.nodes['n2']).toMatchObject({ x: 3, y: 0 });
  });

  it('emits a length edit request with the label rect', () => {
    const plan = makePlan();
    const fn = vi.fn<(e: LengthEditRequest) => void>();
    plan.on('lengthEditRequest', fn);
    plan.emitLengthEditRequest('w1');
    const e = fn.mock.calls[0]![0];
    expect(e).toMatchObject({ wallId: 'w1', length: 4, anchor: 'a' });
    for (const v of Object.values(e.anchorRect)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('selection of a removed entity', () => {
  it('is dropped when the entity disappears', () => {
    const plan = makePlan();
    const fn = vi.fn();
    plan.select({ kind: 'opening', id: 'o1' });
    plan.on('selectionchange', fn);
    plan.doc.execute(removeOpening('o1'));
    expect(plan.selection).toBeNull();
    expect(fn).toHaveBeenCalledWith(null);
  });
});
