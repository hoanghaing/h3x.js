import { describe, expect, it } from 'vitest';
import { layoutStair } from '../../src/core/stairs/layout';
import type { StairLayout } from '../../src/core/stairs/layout';
import { signedArea } from '../../src/core/geometry/polygon';
import type { Stair, Vec2 } from '../../src/core/types';

const H = 3.35; // n = 19
const h = H / 19;
const bIdeal = 0.62 - 2 * h;

function stair(over: Partial<Stair>): Stair {
  return {
    id: 's1',
    x: 0,
    y: 0,
    width: 1.0,
    depth: 5.0,
    rotation: 0,
    type: 'straight',
    turn: 'landing',
    hand: 'right',
    flightWidth: 1.0,
    ...over,
  };
}

type OkLayout = Extract<StairLayout, { ok: true }>;
function ok(l: StairLayout): OkLayout {
  if (!l.ok) throw new Error(`expected ok layout, got ${l.reason}`);
  return l;
}
const xs = (o: Vec2[]): number[] => o.map((p) => p.x);
const ys = (o: Vec2[]): number[] => o.map((p) => p.y);
const minY = (o: Vec2[]): number => Math.min(...ys(o));
const maxY = (o: Vec2[]): number => Math.max(...ys(o));
const minX = (o: Vec2[]): number => Math.min(...xs(o));
const maxX = (o: Vec2[]): number => Math.max(...xs(o));
const cx = (o: Vec2[]): number => xs(o).reduce((a, b) => a + b, 0) / o.length;

function insideBay(l: OkLayout, w: number, d: number): void {
  for (const poly of [...l.steps, ...l.landings].map((s) => s.outline)) {
    expect(signedArea(poly)).toBeGreaterThan(0); // CCW
    for (const p of poly) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(w / 2 + 1e-9);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(d / 2 + 1e-9);
    }
  }
}

describe('layoutStair — straight', () => {
  it('lays out 19 risers with the ideal tread and slack at the bottom', () => {
    const l = ok(layoutStair(stair({}), H));
    expect(l.risers).toBe(19);
    expect(l.riserHeight).toBeCloseTo(0.176316, 6);
    expect(l.treadDepth).toBeCloseTo(0.267368, 6);
    expect(l.steps).toHaveLength(18);
    expect(l.landings).toHaveLength(0);
    expect(maxY(l.steps[17]!.outline)).toBeCloseTo(2.5, 9);
    expect(minY(l.steps[0]!.outline)).toBeCloseTo(-2.5 + (5.0 - 18 * bIdeal), 9);
    for (let i = 1; i < 18; i++) expect(l.steps[i]!.top).toBeGreaterThan(l.steps[i - 1]!.top);
    expect(l.steps[17]!.top).toBeCloseTo(18 * h, 9);
    expect(l.steps[0]!.top).toBeCloseTo(h, 9);
    expect(l.walkLine[0]!.y).toBeCloseTo(-2.5 + (5.0 - 18 * bIdeal), 9);
    expect(l.walkLine.at(-1)!.y).toBeCloseTo(2.5, 9);
    insideBay(l, 1.0, 5.0);
  });

  it('shrinks the tread down to 0.60 − 2h, then reports does-not-fit', () => {
    expect(ok(layoutStair(stair({ depth: 4.5 }), H)).treadDepth).toBeCloseTo(0.25, 9);
    expect(layoutStair(stair({ depth: 4.4 }), H)).toEqual({ ok: false, reason: 'does-not-fit' });
  });

  it('places a narrow flight against the hand side', () => {
    const r = ok(layoutStair(stair({ width: 2, flightWidth: 0.9, hand: 'right' }), H));
    expect(maxX(r.steps[0]!.outline)).toBeCloseTo(1, 9);
    expect(minX(r.steps[0]!.outline)).toBeCloseTo(0.1, 9);
    const lft = ok(layoutStair(stair({ width: 2, flightWidth: 0.9, hand: 'left' }), H));
    expect(minX(lft.steps[0]!.outline)).toBeCloseTo(-1, 9);
    insideBay(lft, 2, 5);
  });

  it('rejects a flight wider than the bay', () => {
    expect(layoutStair(stair({ flightWidth: 1.2 }), H)).toEqual({
      ok: false,
      reason: 'does-not-fit',
    });
  });
});

describe('layoutStair — U with landing', () => {
  const u = (over: Partial<Stair> = {}): Stair =>
    stair({ type: 'U', width: 2.2, depth: 4.5, flightWidth: 1.0, hand: 'right', ...over });

  it('splits 9 + 8 steps around one landing that fits the bay', () => {
    const l = ok(layoutStair(u(), H));
    expect(l.risers).toBe(19);
    expect(l.treadDepth).toBeCloseTo(bIdeal, 9);
    expect(l.steps).toHaveLength(17);
    expect(l.landings).toHaveLength(1);
    const f1 = l.steps.slice(0, 9);
    const f2 = l.steps.slice(9);
    // first flight: left side, starting at the −y edge
    expect(minY(f1[0]!.outline)).toBeCloseTo(-2.25, 9);
    for (const s of f1) expect(cx(s.outline)).toBeLessThan(0);
    // second flight: right side, ending on the −y edge
    expect(minY(f2[7]!.outline)).toBeCloseTo(-2.25, 9);
    for (const s of f2) expect(cx(s.outline)).toBeGreaterThan(0);
    // landing: depth ≥ flight width, from the first flight's top riser to the +y edge
    const land = l.landings[0]!;
    expect(maxY(land.outline)).toBeCloseTo(2.25, 9);
    const topRiser1 = maxY(f1[8]!.outline);
    expect(2.25 - topRiser1).toBeGreaterThanOrEqual(1.0);
    expect(land.top).toBeCloseTo(10 * h, 9);
    expect(f1[8]!.top).toBeCloseTo(9 * h, 9);
    expect(f2[0]!.top).toBeCloseTo(11 * h, 9);
    expect(f2[7]!.top).toBeCloseTo(18 * h, 9);
    // walk line from first riser to last
    expect(l.walkLine[0]!.y).toBeCloseTo(-2.25, 9);
    expect(l.walkLine[0]!.x).toBeLessThan(0);
    expect(l.walkLine.at(-1)!.y).toBeCloseTo(-2.25, 9);
    expect(l.walkLine.at(-1)!.x).toBeGreaterThan(0);
    insideBay(l, 2.2, 4.5);
  });

  it('mirrors for hand left', () => {
    const l = ok(layoutStair(u({ hand: 'left' }), H));
    for (const s of l.steps.slice(0, 9)) expect(cx(s.outline)).toBeGreaterThan(0);
    for (const s of l.steps.slice(9)) expect(cx(s.outline)).toBeLessThan(0);
    insideBay(l, 2.2, 4.5);
  });

  it('reports does-not-fit when the bay is too short', () => {
    expect(layoutStair(u({ depth: 3.2 }), H)).toEqual({ ok: false, reason: 'does-not-fit' });
  });

  it('reports does-not-fit when two flights do not fit side by side', () => {
    expect(layoutStair(u({ width: 1.9 }), H)).toEqual({ ok: false, reason: 'does-not-fit' });
  });
});

describe('layoutStair — L with landing', () => {
  const L = (hand: 'left' | 'right'): Stair =>
    stair({ type: 'L', width: 3.5, depth: 3.5, flightWidth: 1.0, hand });

  it('turns right: second flight along the +y edge toward +x, last riser on the side edge', () => {
    const l = ok(layoutStair(L('right'), H));
    expect(l.steps).toHaveLength(17);
    expect(l.landings).toHaveLength(1);
    const f1 = l.steps.slice(0, 9);
    const f2 = l.steps.slice(9);
    expect(minY(f1[0]!.outline)).toBeCloseTo(-1.75, 9);
    for (const s of f1) expect(cx(s.outline)).toBeLessThan(0);
    for (const s of f2) {
      expect(minY(s.outline)).toBeCloseTo(1.75 - 1.0, 9);
      expect(maxY(s.outline)).toBeCloseTo(1.75, 9);
    }
    for (let i = 1; i < 8; i++) expect(cx(f2[i]!.outline)).toBeGreaterThan(cx(f2[i - 1]!.outline));
    expect(maxX(f2[7]!.outline)).toBeCloseTo(1.75, 9);
    expect(l.walkLine.at(-1)!.x).toBeCloseTo(1.75, 9);
    expect(l.landings[0]!.top).toBeCloseTo(10 * h, 9);
    insideBay(l, 3.5, 3.5);
  });

  it('turns left: second flight toward −x', () => {
    const l = ok(layoutStair(L('left'), H));
    const f2 = l.steps.slice(9);
    for (const s of l.steps.slice(0, 9)) expect(cx(s.outline)).toBeGreaterThan(0);
    for (let i = 1; i < 8; i++) expect(cx(f2[i]!.outline)).toBeLessThan(cx(f2[i - 1]!.outline));
    expect(minX(f2[7]!.outline)).toBeCloseTo(-1.75, 9);
    insideBay(l, 3.5, 3.5);
  });
});

describe('layoutStair — rotation and errors', () => {
  const rotAbout = (p: Vec2, c: Vec2, a: number): Vec2 => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return {
      x: c.x + dx * Math.cos(a) - dy * Math.sin(a),
      y: c.y + dx * Math.sin(a) + dy * Math.cos(a),
    };
  };
  const close = (a: Vec2[], b: Vec2[]): void => {
    expect(a).toHaveLength(b.length);
    a.forEach((p, i) => {
      expect(Math.abs(p.x - b[i]!.x)).toBeLessThan(1e-9);
      expect(Math.abs(p.y - b[i]!.y)).toBeLessThan(1e-9);
    });
  };

  for (const angle of [Math.PI / 2, Math.PI / 6]) {
    it(`rotation ${angle.toFixed(4)} rotates every point about the bay centre`, () => {
      const c = { x: 3, y: -2 };
      const base = ok(layoutStair(stair({ ...c }), H));
      const rot = ok(layoutStair(stair({ ...c, rotation: angle }), H));
      const r = (pts: Vec2[]): Vec2[] => pts.map((p) => rotAbout(p, c, angle));
      base.steps.forEach((s, i) => close(rot.steps[i]!.outline, r(s.outline)));
      close(rot.walkLine, r(base.walkLine));
      close(rot.opening, r(base.opening));
      close(base.opening, [
        { x: 2.5, y: -4.5 },
        { x: 3.5, y: -4.5 },
        { x: 3.5, y: 0.5 },
        { x: 2.5, y: 0.5 },
      ]);
    });
  }

  it('returns no-rise for NaN or non-positive rise', () => {
    expect(layoutStair(stair({}), NaN)).toEqual({ ok: false, reason: 'no-rise' });
    expect(layoutStair(stair({}), 0)).toEqual({ ok: false, reason: 'no-rise' });
    expect(layoutStair(stair({}), -1)).toEqual({ ok: false, reason: 'no-rise' });
  });
});
