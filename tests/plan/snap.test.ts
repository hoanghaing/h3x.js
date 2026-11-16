import { describe, expect, it } from 'vitest';
import { snapPoint, snapScalar } from '../../src/plan/snap';

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
