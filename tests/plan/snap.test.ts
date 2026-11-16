import { describe, expect, it } from 'vitest';
import type { Floor } from '../../src/core';
import { snapDraw, snapPoint, snapScalar } from '../../src/plan/snap';

const opts = { grid: 0.05, align: true, alignRadius: 0.05 };

describe('snapPoint', () => {
  it('rounds to the grid when there are no others', () => {
    const r = snapPoint({ x: 1.23, y: 2.07 }, [], opts);
    expect(r.point).toEqual({ x: 1.25, y: 2.05 });
    expect(r.guides).toEqual([]);
  });

  it('aligns to a nearby node per axis, grid-snapping the other axis', () => {
    const r = snapPoint({ x: 1.23, y: 2.07 }, [{ x: 1.21, y: 9 }], opts);
    expect(r.point).toEqual({ x: 1.21, y: 2.05 });
    expect(r.guides).toEqual([{ axis: 'x', value: 1.21, from: { x: 1.21, y: 9 } }]);
  });

  it('picks the nearest of several candidates on an axis', () => {
    const r = snapPoint(
      { x: 1.23, y: 0 },
      [
        { x: 1.2, y: 5 },
        { x: 1.22, y: 7 },
      ],
      opts,
    );
    expect(r.point.x).toBe(1.22);
    expect(r.guides[0]?.from).toEqual({ x: 1.22, y: 7 });
  });

  it('ignores others when align is false', () => {
    const r = snapPoint({ x: 1.23, y: 2.07 }, [{ x: 1.21, y: 9 }], { ...opts, align: false });
    expect(r.point).toEqual({ x: 1.25, y: 2.05 });
    expect(r.guides).toEqual([]);
  });

  it('leaves the point unchanged when grid is 0 and nothing aligns', () => {
    const r = snapPoint({ x: 1.234, y: 2.071 }, [], { ...opts, grid: 0 });
    expect(r.point).toEqual({ x: 1.234, y: 2.071 });
  });
});

describe('snapScalar', () => {
  it('rounds to the grid', () => {
    expect(snapScalar(0.376, 0.05)).toBeCloseTo(0.4, 9);
    expect(snapScalar(-0.024, 0.05)).toBeCloseTo(0, 9);
    expect(Object.is(snapScalar(-0.024, 0.05), -0)).toBe(false);
  });

  it('returns the value when grid is not positive', () => {
    expect(snapScalar(0.376, 0)).toBe(0.376);
  });
});

const floor = {
  nodes: {
    a: { id: 'a', x: 0, y: 0 },
    b: { id: 'b', x: 4, y: 0 },
    c: { id: 'c', x: 4, y: 3 },
  },
  walls: {
    w1: { id: 'w1', a: 'a', b: 'b', thickness: 0.2, height: 2.7 },
    w2: { id: 'w2', a: 'b', b: 'zz', thickness: 0.2, height: 2.7 },
  },
} as unknown as Floor;
const dopts = { grid: 0.05, align: true, alignRadius: 0.05, reach: 0.1 };

describe('snapDraw', () => {
  it('returns free grid-snapped point with nothing near', () => {
    const r = snapDraw({ x: 2.02, y: 1.52 }, floor, { ...dopts, align: false });
    expect(r.target).toEqual({ kind: 'free' });
    expect(r.point).toEqual({ x: 2, y: 1.5 });
  });

  it('snaps to a node within reach', () => {
    const r = snapDraw({ x: 4.06, y: 0.05 }, floor, dopts);
    expect(r.target).toEqual({ kind: 'node', id: 'b' });
    expect(r.point).toEqual({ x: 4, y: 0 });
  });

  it('node wins over the wall it sits on', () => {
    const r = snapDraw({ x: 0.03, y: 0.03 }, floor, dopts);
    expect(r.target).toEqual({ kind: 'node', id: 'a' });
  });

  it('snaps to the closest point on a wall center line, ignoring walls with missing nodes', () => {
    const r = snapDraw({ x: 2.013, y: 0.07 }, floor, dopts);
    expect(r.target).toEqual({ kind: 'wall', id: 'w1' });
    expect(r.point.x).toBeCloseTo(2.013, 9);
    expect(r.point.y).toBeCloseTo(0, 9);
    const far = snapDraw({ x: 4.0, y: -1.5 }, floor, { ...dopts, align: false });
    expect(far.target).toEqual({ kind: 'free' });
  });

  it('aligns to nodes and extra points when nothing is hit', () => {
    const r = snapDraw({ x: 4.03, y: 2 }, floor, dopts);
    expect(r.target).toEqual({ kind: 'free' });
    expect(r.point).toEqual({ x: 4, y: 2 });
    expect(r.guides).toHaveLength(1);
    const e = snapDraw({ x: 7.02, y: 1.5 }, floor, { ...dopts, extra: [{ x: 7, y: 9 }] });
    expect(e.point.x).toBe(7);
  });

  it('alignment beats angle lock', () => {
    // ~44.8 degrees from (0,-2): inside the lock tolerance, and x is within alignRadius of node b
    const r = snapDraw({ x: 4.03, y: 2 }, floor, { ...dopts, from: { x: 0, y: -2 } });
    expect(r.point).toEqual({ x: 4, y: 2 });
    expect(r.guides).toHaveLength(1);
    expect(r.angleLock).toBeUndefined();
  });

  it('locks to 45 degrees at 44 degrees and grid-snaps the length', () => {
    const from = { x: 10, y: 10 };
    const t = (44 * Math.PI) / 180;
    const p = { x: 10 + 2.03 * Math.cos(t), y: 10 + 2.03 * Math.sin(t) };
    const r = snapDraw(p, floor, { ...dopts, from });
    const d = Math.SQRT1_2 * 2.05;
    expect(r.point.x).toBeCloseTo(10 + d, 6);
    expect(r.point.y).toBeCloseTo(10 + d, 6);
    expect(r.target).toEqual({ kind: 'free' });
    expect(r.angleLock).toEqual({ from, to: r.point });
  });

  it('does not lock at 30 degrees', () => {
    const from = { x: 10, y: 10 };
    const t = (30 * Math.PI) / 180;
    const p = { x: 10 + 2 * Math.cos(t), y: 10 + 2 * Math.sin(t) };
    const r = snapDraw(p, floor, { ...dopts, from });
    expect(r.angleLock).toBeUndefined();
    expect(r.point.y).not.toBeCloseTo(10 + 2 * Math.sin(Math.PI / 4), 3);
  });
});

describe('snapDraw structure option', () => {
  it('structure: false ignores node and wall targets but falls through to grid', () => {
    const node = snapDraw({ x: 4.06, y: 0.05 }, floor, {
      ...dopts,
      align: false,
      structure: false,
    });
    expect(node.target).toEqual({ kind: 'free' });
    expect(node.point).toEqual({ x: 4.05, y: 0.05 });
    const wall = snapDraw({ x: 2.013, y: 0.07 }, floor, {
      ...dopts,
      align: false,
      structure: false,
    });
    expect(wall.target).toEqual({ kind: 'free' });
    expect(wall.point).toEqual({ x: 2, y: 0.05 });
  });
});
