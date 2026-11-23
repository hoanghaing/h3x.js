import { describe, expect, it } from 'vitest';
import {
  mirrorOrientation,
  openingGeometry,
  openingHit,
  pieceOutline,
  type Floor,
  type Opening,
  type OpeningGeometry,
  type OpeningPiece,
  type OpeningType,
  type Vec2,
} from '../../src/core';
import { signedArea } from '../../src/core/geometry/polygon';
import { closestPointOnSegment } from '../../src/core/geometry/segment';
import { computeJoins, cornersOfWall } from '../../src/core/walls/joins';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';
import { acuteFloor, tFloor, trapezoidFloor } from '../fixtures/irregular';
import { OPENING_CASES, openingFloor } from '../fixtures/openings';

/** The geometry of o1 on the horizontal wall: cut 1.4 … 2.6 along x, faces at y = ±0.1. */
function geometry(type: OpeningType, over: Partial<Opening> = {}): OpeningGeometry {
  const f = openingFloor({ type, ...over });
  return openingGeometry(f, f.openings.o1!)!;
}

const leaves = (pieces: OpeningPiece[]) => pieces.filter((p) => p.role === 'leaf');
const length = (p: OpeningPiece) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
const mid = (p: OpeningPiece): Vec2 => ({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 });
const byX = (pieces: OpeningPiece[]) => [...pieces].sort((p, q) => mid(p).x - mid(q).x);

function expectPoint(actual: Vec2, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 12);
  expect(actual.y).toBeCloseTo(y, 12);
}

/** Pieces as a set: neither their order nor the direction of their segments matters. */
function pieceSet(pieces: OpeningPiece[]): string[] {
  const n = (v: number) => String(Math.round(v * 1e6) / 1e6 + 0);
  return pieces
    .map((p) => {
      const ends = [p.a, p.b].map((q) => `${n(q.x)},${n(q.y)}`).sort();
      return [p.role, ...ends, n(p.depth), n(p.z0), n(p.z1)].join(' ');
    })
    .sort();
}

describe('openingGeometry: swing doors', () => {
  it.each([
    ['a', 'left', [0.75, 0], [0.75, 0.9], [1.65, 0], false],
    ['b', 'left', [1.65, 0], [1.65, 0.9], [0.75, 0], true],
    ['b', 'right', [1.65, 0], [1.65, -0.9], [0.75, 0], false],
    ['a', 'right', [0.75, 0], [0.75, -0.9], [1.65, 0], true],
  ] as const)('hinge %s, swing %s', (hinge, swing, center, end, closed, ccw) => {
    const f = oneRoomFloor();
    const g = openingGeometry(f, { ...f.openings.o1!, hinge, swing })!;
    expect(g.plan).toHaveLength(1);
    expect(g.plan[0]).toMatchObject({ role: 'leaf', depth: 0 });
    expectPoint(g.plan[0]!.a, center[0], center[1]);
    expectPoint(g.plan[0]!.b, end[0], end[1]);
    expect(g.sweeps).toHaveLength(1);
    const arc = g.sweeps[0]!.arc!;
    expectPoint(arc.center, center[0], center[1]);
    expectPoint(arc.from, end[0], end[1]);
    expectPoint(arc.to, closed[0], closed[1]);
    expect(arc.r).toBe(0.9);
    expect(arc.ccw).toBe(ccw);
  });

  it('sweeps the quarter circle between the open and the closed leaf', () => {
    const { points, arc } = geometry('door-swing').sweeps[0]!;
    expect(signedArea(points)).toBeGreaterThan(0);
    expect(signedArea(points)).toBeCloseTo((Math.PI * 1.2 * 1.2) / 4, 2);
    for (const p of [arc!.center, arc!.from, arc!.to]) expect(points).toContainEqual(p);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(1.4 - 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.hypot(p.x - 1.4, p.y)).toBeLessThanOrEqual(1.2 + 1e-9);
    }
  });
});

describe('openingGeometry: conventions', () => {
  it.each(['a', 'b'] as const)('unequal double: larger leaf hinged at %s', (hinge) => {
    const g = geometry('door-double', { hinge, split: 0.75 });
    const [big, small] = [...leaves(g.plan)].sort((p, q) => length(q) - length(p));
    expect(length(big!)).toBeCloseTo(0.9);
    expect(length(small!)).toBeCloseTo(0.3);
    expectPoint(big!.a, hinge === 'a' ? 1.4 : 2.6, 0);
    expectPoint(small!.a, hinge === 'a' ? 2.6 : 1.4, 0);
    const [p, q] = g.sweeps.map((s) => s.arc!);
    expect([p!.r, q!.r].sort()).toEqual([expect.closeTo(0.3), expect.closeTo(0.9)]);
    expectPoint(p!.to, q!.to.x, q!.to.y);
  });

  it('equal double: two halves', () => {
    const open = leaves(geometry('door-double').plan);
    expect(open.map(length)).toEqual([expect.closeTo(0.6), expect.closeTo(0.6)]);
  });

  it.each([
    ['left', 1],
    ['right', -1],
  ] as const)('sliding door: overlapping panels on tracks on the %s', (swing, side) => {
    const [p, q] = byX(leaves(geometry('door-sliding', { swing }).plan));
    for (const l of [p!, q!]) {
      expect(l.depth).toBeGreaterThan(0);
      expect(l.b.y).toBeCloseTo(l.a.y, 12);
      expect(l.a.y * side).toBeGreaterThan(0);
      expect(Math.abs(l.a.y) + l.depth / 2).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    expect(Math.abs(p!.a.y - q!.a.y)).toBeGreaterThanOrEqual(p!.depth - 1e-9);
    expect(Math.max(p!.a.x, p!.b.x)).toBeGreaterThan(Math.min(q!.a.x, q!.b.x) + 0.01);
  });

  it.each(['a', 'b'] as const)('one sliding panel slides to %s along the track side', (hinge) => {
    for (const side of [1, -1]) {
      const swing = side === 1 ? 'left' : 'right';
      const open = leaves(geometry('door-sliding', { leaves: 1, hinge, swing }).plan);
      expect(open).toHaveLength(1);
      expect((mid(open[0]!).x - 2) * (hinge === 'a' ? -1 : 1)).toBeGreaterThan(0.1);
      expect(open[0]!.a.y * side).toBeGreaterThan(0.1);
      expect(open[0]!.b.y).toBeCloseTo(open[0]!.a.y, 12);
    }
  });

  it.each([2, 3, 4])('sliding window: %i overlapping panels about the centre line', (n) => {
    const panels = byX(leaves(geometry('window-sliding', { leaves: n }).plan));
    expect(panels).toHaveLength(n);
    expect(panels.reduce((sum, p) => sum + p.a.y, 0)).toBeCloseTo(0, 12);
    for (let i = 0; i + 1 < n; i++) {
      const [p, q] = [panels[i]!, panels[i + 1]!];
      expect(Math.abs(p.a.y - q.a.y)).toBeGreaterThanOrEqual(p.depth - 1e-9);
      expect(Math.max(p.a.x, p.b.x)).toBeGreaterThan(Math.min(q.a.x, q.b.x) + 0.01);
    }
  });

  it.each([
    ['a', 'left', 1.4, 1, 1],
    ['a', 'right', 1.4, 1, -1],
    ['b', 'left', 2.6, -1, 1],
    ['b', 'right', 2.6, -1, -1],
  ] as const)('folding: half folded from stack %s to the %s', (hinge, swing, x, dir, side) => {
    const g = geometry('door-folding', { hinge, swing, leaves: 4 });
    const d = 0.3 * Math.SQRT1_2;
    const zigzag = leaves(g.plan);
    expect(zigzag).toHaveLength(4);
    zigzag.forEach((l, i) => {
      expectPoint(l.a, x + dir * i * d, i % 2 ? side * d : 0);
      expectPoint(l.b, x + dir * (i + 1) * d, i % 2 ? 0 : side * d);
    });
    // the band the panels sweep is as deep as one panel
    expect(g.sweeps).toHaveLength(1);
    expect(g.sweeps[0]!.arc).toBeUndefined();
    expect(signedArea(g.sweeps[0]!.points)).toBeCloseTo(1.2 * 0.3);
    for (const p of g.sweeps[0]!.points) {
      expect(p.y * side).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y * side).toBeLessThanOrEqual(0.3 + 1e-9);
    }
  });

  it.each([
    ['left', 1],
    ['right', -1],
  ] as const)('rolling: one line and a box above the cut on the %s', (swing, side) => {
    const g = geometry('door-rolling', { swing, height: 2.4 });
    const shutter = g.plan.filter((p) => p.role === 'shutter');
    expect(shutter).toHaveLength(1);
    expect(shutter[0]!.depth).toBe(0);
    expect(byX(shutter)[0]!.a.y).toBe(0);
    expect(length(shutter[0]!)).toBeCloseTo(1.2);
    for (const pose of [g.plan, g.closed]) {
      const box = pose.find((p) => p.role === 'box')!;
      for (const c of pieceOutline(box)) expect(c.y * side).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(box.z0).toBeGreaterThanOrEqual(g.z1 - 1e-9);
    }
    expect(g.z1).toBeCloseTo(2.4);
  });

  it('opening: only its two jambs, and nothing in the closed pose', () => {
    const g = geometry('opening');
    const jamb = (x: number): OpeningPiece => ({
      role: 'frame',
      a: { x, y: -0.1 },
      b: { x, y: 0.1 },
      depth: 0,
      z0: 0,
      z1: 2.1,
    });
    expect(pieceSet(g.plan)).toEqual(pieceSet([jamb(1.4), jamb(2.6)]));
    expect(g.closed).toEqual([]);
  });

  it.each([1, 2, 3, 4])('casement: %i separate thin leaves at 90 degrees, no sweep', (n) => {
    for (const side of [1, -1]) {
      const g = geometry('window-casement', { leaves: n, swing: side === 1 ? 'left' : 'right' });
      const open = byX(leaves(g.plan));
      expect(open).toHaveLength(n);
      open.forEach((l, i) => {
        expect(l.depth).toBe(0);
        expect(l.a.y).toBe(0);
        expect(l.b.x).toBeCloseTo(l.a.x, 12);
        expect(l.b.y * side).toBeGreaterThan(0.2);
        expect(l.b.y * side).toBeLessThanOrEqual(1.2 / n + 1e-9);
        // two leaves hinged on one mullion still read as two lines
        if (i > 0) expect(l.a.x - open[i - 1]!.a.x).toBeGreaterThan(0.04);
      });
      expect(g.sweeps).toEqual([]);
    }
  });

  it.each(['a', 'b'] as const)('one casement leaf is hinged at %s', (hinge) => {
    const [leaf] = leaves(geometry('window-casement', { leaves: 1, hinge }).plan);
    expectPoint(leaf!.a, hinge === 'a' ? 1.4 : 2.6, 0);
    expect(length(leaf!)).toBeCloseTo(1.2);
  });

  it.each([1, 2, 3, 4])('awning: %i lines parallel to the wall on the swing side', (n) => {
    for (const side of [1, -1]) {
      const g = geometry('window-awning', { leaves: n, swing: side === 1 ? 'left' : 'right' });
      const open = leaves(g.plan);
      expect(open).toHaveLength(n);
      for (const l of open) {
        expect(l.a.y * side).toBeGreaterThan(0.1);
        expect(l.b.y).toBeCloseTo(l.a.y, 12);
      }
    }
  });

  it.each([1, 2, 6])('fixed: three lines plus the divisions of %i panes', (n) => {
    const g = geometry('window-fixed', { leaves: n });
    const divisions = Array<string>(n - 1).fill('frame');
    expect(g.plan.map((p) => p.role)).toEqual(['face', 'glass', 'face', ...divisions]);
    g.plan.slice(3).forEach((p, i) => {
      expectPoint(p.a, 1.4 + ((i + 1) * 1.2) / n, -0.1);
      expectPoint(p.b, 1.4 + ((i + 1) * 1.2) / n, 0.1);
    });
  });
});

describe('openingGeometry: every type', () => {
  it.each(OPENING_CASES)('$name: finite, closed inside the cut', ({ over }) => {
    for (const thickness of [0.05, 0.1, 0.2, 0.4]) {
      for (const width of [0.12, 0.9, 3]) {
        const f = openingFloor({ ...over, width }, { thickness });
        const g = openingGeometry(f, f.openings.o1!)!;
        const points = [
          ...g.cut,
          ...[...g.plan, ...g.closed].flatMap((p) => [p.a, p.b]),
          ...g.sweeps.flatMap((s) => s.points),
        ];
        expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        expect(g.plan.length).toBeGreaterThan(0);
        if (over.type !== 'opening') expect(g.closed.length).toBeGreaterThan(0);
        for (const p of g.closed) {
          expect(p.depth).toBeGreaterThan(0);
          expect(length(p)).toBeGreaterThan(0);
          expect(p.z1).toBeGreaterThan(p.z0);
          if (p.role === 'box') continue;
          expect(p.z0).toBeGreaterThanOrEqual(g.z0 - 1e-9);
          expect(p.z1).toBeLessThanOrEqual(g.z1 + 1e-9);
          for (const c of pieceOutline(p)) {
            expect(Math.abs(c.x - 2)).toBeLessThanOrEqual(width / 2 + 1e-9);
            expect(Math.abs(c.y)).toBeLessThanOrEqual(thickness / 2 + 1e-9);
          }
        }
      }
    }
  });

  it.each(OPENING_CASES)('$name: sweeps only for swing, double and folding', ({ over }) => {
    const { sweeps } = geometry(over.type, over);
    const count: Partial<Record<OpeningType, number>> = {
      'door-swing': 1,
      'door-double': 2,
      'door-folding': 1,
    };
    expect(sweeps).toHaveLength(count[over.type] ?? 0);
    for (const s of sweeps) expect(signedArea(s.points)).toBeGreaterThan(0);
  });

  it.each(OPENING_CASES)('$name: the same seen from the other wall direction', ({ over }) => {
    const f = openingFloor({ ...over, offset: 1.7 }, { b: { x: 4, y: 3 } });
    const o = f.openings.o1!;
    const r: Floor = structuredClone(f);
    r.walls.w = { ...r.walls.w!, a: 'b', b: 'a' };
    const g = openingGeometry(f, o)!;
    const h = openingGeometry(r, { ...o, offset: 5 - o.offset, ...mirrorOrientation(o) })!;
    expect(pieceSet(h.plan)).toEqual(pieceSet(g.plan));
    expect(pieceSet(h.closed)).toEqual(pieceSet(g.closed));
  });

  it.each([
    ['door-double', { hinge: 'b' }],
    ['door-sliding', { hinge: 'b' }],
    ['door-rolling', { hinge: 'b', leaves: 5 }],
    ['door-swing', { leaves: 3, split: 0.8 }],
    ['opening', { hinge: 'b', swing: 'right', leaves: 2 }],
    ['window-fixed', { hinge: 'b', swing: 'right', split: 0.7 }],
    ['window-sliding', { hinge: 'b', swing: 'right' }],
    ['window-casement', { hinge: 'b' }],
  ] as const)('%s ignores parameters that do not apply', (type, over) => {
    expect(geometry(type, over)).toEqual(geometry(type));
  });
});

describe('openingGeometry: cut', () => {
  it('is the opening span across the wall, from the sill to the top', () => {
    const g = geometry('window-fixed', { sill: 0.9, height: 1.4 });
    expectPoint(g.cut[0], 1.4, 0.1);
    expectPoint(g.cut[1], 2.6, 0.1);
    expectPoint(g.cut[2], 2.6, -0.1);
    expectPoint(g.cut[3], 1.4, -0.1);
    expect([g.z0, g.z1]).toEqual([0.9, expect.closeTo(2.3)]);
  });

  it('is clamped below the wall top and to the faces left by the joins', () => {
    const f = oneRoomFloor();
    f.walls.w1!.height = 1;
    const g = openingGeometry(f, { ...f.openings.o1!, offset: 0.3, sill: 0.5, height: 2 })!;
    expectPoint(g.cut[0], 0.101, 0.1);
    expectPoint(g.cut[1], 0.75, 0.1);
    expect([g.z0, g.z1]).toEqual([0.5, expect.closeTo(0.999)]);
  });

  it('collapses, still finite, for an opening beyond its wall', () => {
    const g = geometry('door-double', { offset: 9 });
    expect(g.cut[0]).toEqual(g.cut[1]);
    expectPoint(g.cut[0], 3.999, 0.1);
  });

  it.each([twoRoomFloor, acuteFloor, tFloor, trapezoidFloor])(
    'finds the corners the joins of the whole floor give (%o)',
    (make) => {
      const f = make();
      const { corners } = computeJoins(f);
      for (const w of Object.values(f.walls)) expect(cornersOfWall(f, w)).toEqual(corners[w.id]);
    },
  );

  it('is null without the wall or one of its nodes', () => {
    const f = openingFloor();
    const o = f.openings.o1!;
    expect(openingGeometry(f, { ...o, wall: 'gone' })).toBeNull();
    delete f.nodes.b;
    expect(openingGeometry(f, o)).toBeNull();
  });
});

describe('openingHit', () => {
  const toSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
    const c = closestPointOnSegment(p, a, b).point;
    return Math.hypot(c.x - p.x, c.y - p.y);
  };
  const toRing = (p: Vec2, ring: Vec2[]): number =>
    Math.min(...ring.map((a, i) => toSegment(p, a, ring[(i + 1) % ring.length]!)));
  /** Inside an axis-aligned rectangle. */
  const inRect = (p: Vec2, ring: Vec2[]): boolean => {
    const xs = ring.map((q) => q.x);
    const ys = ring.map((q) => q.y);
    return (
      p.x >= Math.min(...xs) &&
      p.x <= Math.max(...xs) &&
      p.y >= Math.min(...ys) &&
      p.y <= Math.max(...ys)
    );
  };

  describe.each([50, 200, 800])('at %i px/m', (scale) => {
    const reach = 4 / scale;

    it.each(OPENING_CASES)('$name: the cut and the leaves, nothing else', ({ over }) => {
      const g = geometry(over.type, over);
      const open = leaves(g.plan).map((l) => ({ l, ring: pieceOutline(l) }));
      const wrong: Vec2[] = [];
      for (let x = 0.7; x <= 3.3; x += 0.053) {
        for (let y = -1.3; y <= 1.3; y += 0.043) {
          const p = { x, y };
          const nearLeaf = open.some(({ l, ring }) =>
            l.depth === 0
              ? toSegment(p, l.a, l.b) <= reach
              : inRect(p, ring) || toRing(p, ring) <= reach,
          );
          const expected = inRect(p, g.cut) || nearLeaf;
          // up to 1 mm outside a polygon counts as inside
          if (openingHit(g, p, reach) !== expected && toRing(p, g.cut) > 1.001e-3) wrong.push(p);
        }
      }
      expect(wrong).toEqual([]);
    });
  });

  it('does not hit the dashed box or the sweep', () => {
    const rolling = geometry('door-rolling');
    const box = rolling.plan.find((p) => p.role === 'box')!;
    expect(openingHit(rolling, mid(box), 0.02)).toBe(false);
    expect(openingHit(geometry('door-swing'), { x: 2, y: 0.5 }, 0.02)).toBe(false);
  });
});
