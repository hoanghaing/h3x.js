import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  fitBounds,
  panBy,
  planToScreen,
  screenToPlan,
  zoomAt,
  type View,
} from '../../src/plan';

const v: View = { cx: 2, cy: 1, scale: 50, width: 800, height: 600 };

describe('view transform', () => {
  it('round-trips plan -> screen -> plan', () => {
    const p = { x: 3.5, y: -2 };
    const back = screenToPlan(v, planToScreen(v, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('maps +y up on screen', () => {
    expect(planToScreen(v, { x: 2, y: 2 }).y).toBeLessThan(planToScreen(v, { x: 2, y: 1 }).y);
  });

  it('puts the centre at the viewport middle', () => {
    expect(planToScreen(v, { x: 2, y: 1 })).toEqual({ x: 400, y: 300 });
  });

  it('zoomAt keeps the plan point under the cursor fixed', () => {
    const s = { x: 123, y: 456 };
    const before = screenToPlan(v, s);
    const z = zoomAt(v, s, 1.7);
    expect(z.scale).toBeCloseTo(85);
    const after = screenToPlan(z, s);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('zoomAt clamps scale to [MIN_SCALE, MAX_SCALE]', () => {
    expect(zoomAt(v, { x: 0, y: 0 }, 1e6).scale).toBe(MAX_SCALE);
    expect(zoomAt(v, { x: 0, y: 0 }, 1e-6).scale).toBe(MIN_SCALE);
    expect([MIN_SCALE, MAX_SCALE, DEFAULT_SCALE]).toEqual([5, 2000, 50]);
  });

  it('panBy moves the view by screen pixels', () => {
    const p = panBy(v, 100, 50);
    // dragging right/down shows content further left/up in plan terms
    expect(p.cx).toBeCloseTo(0);
    expect(p.cy).toBeCloseTo(2);
  });

  it('fitBounds fits the box with padding', () => {
    const f = fitBounds(v, { x: 0, y: 0 }, { x: 4, y: 16 }, 40);
    expect(f.scale).toBeCloseTo(32.5);
    expect(f.cx).toBeCloseTo(2);
    expect(f.cy).toBeCloseTo(8);
  });

  it('fitBounds clamps scale and tolerates a degenerate box', () => {
    const f = fitBounds(v, { x: 1, y: 1 }, { x: 1, y: 1 });
    expect(f.scale).toBe(MAX_SCALE);
    expect(f.cx).toBe(1);
  });

  it('handles a zero-size viewport', () => {
    const z: View = { cx: 0, cy: 0, scale: 50, width: 0, height: 0 };
    const f = fitBounds(z, { x: 0, y: 0 }, { x: 4, y: 16 });
    expect(f.scale).toBe(DEFAULT_SCALE);
    expect(Number.isFinite(f.cx)).toBe(true);
    expect(Number.isFinite(f.cy)).toBe(true);
    const p = screenToPlan(z, { x: 10, y: 10 });
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
  });
});
