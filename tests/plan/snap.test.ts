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
    const r = snapDraw({ x: 2.513, y: 0.07 }, floor, dopts);
    expect(r.target).toEqual({ kind: 'wall', id: 'w1' });
    expect(r.point.x).toBeCloseTo(2.513, 9);
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

describe('snapDraw exclude option', () => {
  it('skips excluded nodes as targets and alignment points, and walls touching them', () => {
    // Node b would win, then w1 (touching a): both excluded, c is out of reach.
    const r = snapDraw({ x: 3.93, y: 0.04 }, floor, { ...dopts, exclude: ['a', 'b'] });
    expect(r.target).toEqual({ kind: 'free' });
    expect(r.point).toEqual({ x: 3.95, y: 0.05 });
    expect(r.guides).toEqual([]);
    // c still aligns.
    const c = snapDraw({ x: 3.97, y: 2.02 }, floor, { ...dopts, exclude: ['b'] });
    expect(c.point.x).toBe(4);
  });
});

describe('snapDraw near a wall end', () => {
  it('a wall hit within MIN_WALL_LENGTH of an end node snaps to that node', () => {
    // 0.2 m from a: past the node reach, but a split there would leave a part below 0.3 m.
    const near = snapDraw({ x: 0.2, y: 0.05 }, floor, dopts);
    expect(near.target).toEqual({ kind: 'node', id: 'a' });
    expect(near.point).toEqual({ x: 0, y: 0 });
    const end = snapDraw({ x: 3.75, y: -0.05 }, floor, dopts);
    expect(end.target).toEqual({ kind: 'node', id: 'b' });
    expect(end.point).toEqual({ x: 4, y: 0 });
    // Exactly at the minimum the wall can be split.
    const ok = snapDraw({ x: 0.3, y: 0.05 }, floor, dopts);
    expect(ok.target).toEqual({ kind: 'wall', id: 'w1' });
  });
});

describe('snapDraw site option', () => {
  const site = [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
  ];

  it('snaps to a site corner with kind site-vertex', () => {
    const r = snapDraw({ x: 10.05, y: 10.04 }, floor, { ...dopts, site });
    expect(r.point).toEqual({ x: 10, y: 10 });
    expect(r.target).toEqual({ kind: 'site-vertex' });
  });

  it('snaps onto a site edge with kind site-edge', () => {
    const r = snapDraw({ x: 15.03, y: 10.06 }, floor, { ...dopts, site });
    expect(Math.abs(r.point.y - 10)).toBeLessThan(1e-9);
    expect(r.point.x).toBeCloseTo(15.03, 9);
    expect(r.target).toEqual({ kind: 'site-edge' });
  });

  it('prefers a corner over an edge near it', () => {
    const r = snapDraw({ x: 10.08, y: 10.02 }, floor, { ...dopts, site });
    expect(r.target).toEqual({ kind: 'site-vertex' });
  });

  it('lets a wall node or wall within reach win over the site', () => {
    const near = [
      { x: 0.02, y: 0.02 },
      { x: 20, y: 20 },
      { x: 0, y: 5 },
    ];
    const n = snapDraw({ x: 0.03, y: 0.03 }, floor, { ...dopts, site: near });
    expect(n.target).toEqual({ kind: 'node', id: 'a' });
    const w = snapDraw({ x: 2, y: 0.05 }, floor, {
      ...dopts,
      site: [
        { x: 0, y: 0.08 },
        { x: 5, y: 0.08 },
        { x: 5, y: 5 },
      ],
    });
    expect(w.target).toEqual({ kind: 'wall', id: 'w1' });
  });

  it('beats alignment and grid, ignores sites out of reach', () => {
    const r = snapDraw({ x: 15.03, y: 10.06 }, floor, {
      ...dopts,
      site,
      extra: [{ x: 15, y: 50 }],
    });
    expect(r.target).toEqual({ kind: 'site-edge' });
    const far = snapDraw({ x: 15, y: 10.5 }, floor, { ...dopts, site });
    expect(far.target).toEqual({ kind: 'free' });
  });
});

describe('snapDraw midpoint, perpendicular, extension and ortho', () => {
  it('snaps to a wall midpoint within reach, with a midpoint mark', () => {
    const r = snapDraw({ x: 2.04, y: 0.05 }, floor, dopts);
    expect(r.target).toEqual({ kind: 'wall', id: 'w1' });
    expect(r.point).toEqual({ x: 2, y: 0 });
    expect(r.marks).toEqual([{ kind: 'midpoint', at: { x: 2, y: 0 } }]);
  });

  it('snaps to the foot of the perpendicular from the segment start', () => {
    const from = { x: 3, y: 2 };
    const r = snapDraw({ x: 3.05, y: 0.06 }, floor, { ...dopts, from });
    expect(r.target).toEqual({ kind: 'wall', id: 'w1' });
    expect(r.point).toEqual({ x: 3, y: 0 });
    expect(r.marks).toEqual([{ kind: 'perpendicular', at: { x: 3, y: 0 }, from }]);
  });

  it('no perpendicular when its foot is off the wall or too near an end', () => {
    const r = snapDraw({ x: 4.0, y: -0.06 }, floor, { ...dopts, from: { x: 4.02, y: 2 } });
    expect(r.marks?.[0]?.kind).not.toBe('perpendicular');
  });

  it('snaps onto a wall extension line past its end, the distance on the grid', () => {
    const r = snapDraw({ x: 6.02, y: 0.06 }, floor, dopts);
    expect(r.target).toEqual({ kind: 'free' });
    expect(r.point).toEqual({ x: 6, y: 0 });
    expect(r.marks).toEqual([{ kind: 'extension', at: { x: 6, y: 0 }, from: { x: 4, y: 0 } }]);
    const back = snapDraw({ x: -1.51, y: -0.04 }, floor, dopts);
    expect(back.point).toEqual({ x: -1.5, y: 0 });
  });

  it('ortho keeps the point on the nearer axis through from', () => {
    const from = { x: 1, y: 1 };
    const r = snapDraw({ x: 3.02, y: 1.4 }, floor, { ...dopts, from, ortho: true, align: false });
    expect(r.point).toEqual({ x: 3, y: 1 });
    expect(r.marks).toEqual([{ kind: 'ray', at: { x: 3, y: 1 }, from }]);
    const up = snapDraw({ x: 0.7, y: -1.52 }, floor, { ...dopts, from, ortho: true, align: false });
    expect(up.point).toEqual({ x: 1, y: -1.5 });
  });

  it('ortho aligns its free coordinate to a node and hits a node or wall on the ray', () => {
    const from = { x: 4, y: 2 };
    const node = snapDraw({ x: 4.3, y: 0.02 }, floor, { ...dopts, from, ortho: true });
    expect(node.target).toEqual({ kind: 'node', id: 'b' });
    const wall = snapDraw({ x: 2.3, y: 0.03 }, floor, {
      ...dopts,
      from: { x: 2.3, y: 2 },
      ortho: true,
    });
    expect(wall.target).toEqual({ kind: 'wall', id: 'w1' });
    expect(wall.point).toEqual({ x: 2.3, y: 0 });
    const aligned = snapDraw({ x: 4.03, y: 3.6 }, floor, {
      ...dopts,
      from: { x: 0, y: 3.6 },
      ortho: true,
    });
    expect(aligned.point).toEqual({ x: 4, y: 3.6 });
    expect(aligned.guides[0]).toMatchObject({ axis: 'x', value: 4 });
  });

  it('the 45-degree lock shows a ray mark', () => {
    const from = { x: 10, y: 10 };
    const r = snapDraw({ x: 11, y: 11.03 }, floor, { ...dopts, from, align: false });
    expect(r.marks?.[0]).toMatchObject({ kind: 'ray', from });
  });
});
