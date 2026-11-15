// @vitest-environment jsdom
import { Quaternion, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxisGizmo, projectAxes, type AxisName } from '../../src/three';

const byAxis = (r: ReturnType<typeof projectAxes>, a: AxisName) => r.find((e) => e.axis === a)!;

describe('projectAxes', () => {
  it('maps the identity view', () => {
    const r = projectAxes(new Quaternion());
    expect(byAxis(r, 'x')).toMatchObject({ x: 1, y: 0 });
    expect(byAxis(r, '-x')).toMatchObject({ x: -1, y: 0 });
    expect(byAxis(r, 'y')).toMatchObject({ x: 0, y: 1 });
    expect(r).toHaveLength(6);
    expect(r[0]!.axis).toBe('-z');
    expect(r[5]!.axis).toBe('z');
    for (let i = 1; i < r.length; i++) expect(r[i]!.depth).toBeGreaterThanOrEqual(r[i - 1]!.depth);
  });

  it('handles a camera yawed 90 degrees (looking along -X)', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const r = projectAxes(q);
    expect(r[5]!.axis).toBe('x');
    expect(r[5]!.x).toBeCloseTo(0);
    expect(r[5]!.y).toBeCloseTo(0);
    expect(r[0]!.axis).toBe('-x');
  });
});

describe('AxisGizmo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('tolerates a null 2D context and still hit-tests', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const g = new AxisGizmo({ size: 100 });
    document.body.appendChild(g.element);
    g.update(new Quaternion());
    const fn = vi.fn();
    const off = g.onSelect(fn);
    g.element.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }) as DOMRect;
    // +x sits right of centre
    g.element.dispatchEvent(new MouseEvent('click', { clientX: 50 + 0.7 * 50, clientY: 50 }));
    expect(fn).toHaveBeenCalledWith('x');
    fn.mockClear();
    g.element.dispatchEvent(new MouseEvent('click', { clientX: 0, clientY: 100 }));
    expect(fn).not.toHaveBeenCalled();
    off();
    g.element.dispatchEvent(new MouseEvent('click', { clientX: 50 + 35, clientY: 50 }));
    expect(fn).not.toHaveBeenCalled();
    g.dispose();
  });
});
