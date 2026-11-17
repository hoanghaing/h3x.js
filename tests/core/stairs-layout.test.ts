import { describe, expect, it } from 'vitest';
import { layoutStair } from '../../src/core/stairs/layout';
import type { StairLayout } from '../../src/core/stairs/layout';
import { pointInPolygon, signedArea } from '../../src/core/geometry/polygon';
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

const bMin = 0.6 - 2 * h;
const isAxisRect = (o: Vec2[]): boolean =>
  o.length === 4 &&
  o.every((p, i) => {
    const q = o[(i + 1) % 4]!;
    return Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.y - q.y) < 1e-9;
  });
const hasVertex = (o: Vec2[], v: Vec2): boolean =>
  o.some((p) => Math.abs(p.x - v.x) < 1e-9 && Math.abs(p.y - v.y) < 1e-9);
/** Length of the walking line inside each polygon, sampled every 0.5 mm. */
function walkDepths(walk: Vec2[], polys: Vec2[][]): number[] {
  const out = polys.map(() => 0);
  const ds = 0.0005;
  for (let i = 1; i < walk.length; i++) {
    const a = walk[i - 1]!;
    const b = walk[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const k = Math.ceil(len / ds);
    for (let j = 0; j < k; j++) {
      const t = (j + 0.5) / k;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      polys.forEach((poly, m) => {
        if (pointInPolygon(p, poly)) out[m]! += len / k;
      });
    }
  }
  return out;
}

describe('layoutStair — L with winders', () => {
  const L = (over: Partial<Stair> = {}): Stair =>
    stair({ type: 'L', turn: 'winder', width: 2.6, depth: 3.2, flightWidth: 0.9, ...over });

  it('turns the corner with 3 winders radiating from the inner corner', () => {
    const l = ok(layoutStair(L(), H));
    expect(l.steps).toHaveLength(18);
    expect(l.landings).toHaveLength(0);
    const winders = l.steps.filter((s) => !isAxisRect(s.outline));
    expect(winders).toHaveLength(3);
    const inner = { x: -1.3 + 0.9, y: 1.6 - 0.9 };
    for (const w of winders) expect(hasVertex(w.outline, inner)).toBe(true);
    const first = l.steps.indexOf(winders[0]!);
    expect(l.steps.slice(first, first + 3)).toEqual(winders);
    const depths = walkDepths(
      l.walkLine,
      winders.map((w) => w.outline),
    );
    for (const d of depths) expect(d).toBeGreaterThanOrEqual(bMin - 1e-3);
    // last riser on the side edge, slack at the bottom of the first flight
    expect(maxX(l.steps[17]!.outline)).toBeCloseTo(1.3, 9);
    expect(l.walkLine.at(-1)!.x).toBeCloseTo(1.3, 9);
    expect(minY(l.steps[0]!.outline)).toBeGreaterThan(-1.6 - 1e-9);
    expect(l.walkLine[0]!.y).toBeCloseTo(minY(l.steps[0]!.outline), 9);
    l.steps.forEach((s, i) => expect(s.top).toBeCloseTo((i + 1) * h, 9));
    insideBay(l, 2.6, 3.2);
  });

  it('mirrors for hand left', () => {
    const l = ok(layoutStair(L({ hand: 'left' }), H));
    const winders = l.steps.filter((s) => !isAxisRect(s.outline));
    expect(winders).toHaveLength(3);
    for (const w of winders) expect(hasVertex(w.outline, { x: 0.4, y: 0.7 })).toBe(true);
    expect(minX(l.steps[17]!.outline)).toBeCloseTo(-1.3, 9);
    insideBay(l, 2.6, 3.2);
  });

  it('reports does-not-fit when 15 flight treads cannot fit the two legs (2.6 × 3.0)', () => {
    // legs of 2.1 m and 1.7 m hold at most 8 + 6 treads of 0.60 − 2h
    expect(layoutStair(L({ depth: 3.0 }), H)).toEqual({ ok: false, reason: 'does-not-fit' });
  });

  it('reports does-not-fit when the winders are too shallow on the walking line', () => {
    // the flights fit, but a 0.45 m turn (+ a remainder < b) splits into 3 winders < 0.60 − 2h
    expect(layoutStair(L({ width: 3.0, depth: 3.5, flightWidth: 0.45 }), H)).toEqual({
      ok: false,
      reason: 'does-not-fit',
    });
  });
});

describe('layoutStair — U with winders', () => {
  const U = (over: Partial<Stair> = {}): Stair =>
    stair({ type: 'U', turn: 'winder', width: 2.0, depth: 3.2, flightWidth: 0.9, ...over });

  it('turns 180° with 6 winders, slack at the bottom, last riser on the −y edge', () => {
    const l = ok(layoutStair(U(), H));
    expect(l.steps).toHaveLength(18);
    expect(l.landings).toHaveLength(0);
    const winders = l.steps.filter((s) => !isAxisRect(s.outline));
    expect(winders).toHaveLength(6);
    const first = l.steps.indexOf(winders[0]!);
    expect(l.steps.slice(first, first + 6)).toEqual(winders);
    for (const w of winders.slice(0, 2)) {
      expect(hasVertex(w.outline, { x: -0.1, y: 0.7 })).toBe(true);
    }
    for (const w of winders.slice(4)) expect(hasVertex(w.outline, { x: 0.1, y: 0.7 })).toBe(true);
    const depths = walkDepths(
      l.walkLine,
      winders.map((w) => w.outline),
    );
    for (const d of depths) expect(d).toBeGreaterThanOrEqual(bMin - 1e-3);
    expect(minY(l.steps[0]!.outline)).toBeGreaterThan(-1.6 + 0.01);
    for (const s of l.steps.slice(0, first)) expect(cx(s.outline)).toBeLessThan(0);
    for (const s of l.steps.slice(first + 6)) expect(cx(s.outline)).toBeGreaterThan(0);
    expect(minY(l.steps[17]!.outline)).toBeCloseTo(-1.6, 9);
    expect(l.walkLine.at(-1)!.y).toBeCloseTo(-1.6, 9);
    expect(l.walkLine.at(-1)!.x).toBeGreaterThan(0);
    l.steps.forEach((s, i) => expect(s.top).toBeCloseTo((i + 1) * h, 9));
    insideBay(l, 2.0, 3.2);
  });

  it('handles a zero well (both inner corners coincide)', () => {
    const l = ok(layoutStair(U({ width: 1.8 }), H));
    const winders = l.steps.filter((s) => !isAxisRect(s.outline));
    expect(winders).toHaveLength(6);
    for (const w of winders.slice(0, 5)) expect(hasVertex(w.outline, { x: 0, y: 0.7 })).toBe(true);
    insideBay(l, 1.8, 3.2);
  });

  it('reports does-not-fit in a 1.8 × 2.0 bay', () => {
    expect(layoutStair(U({ width: 1.8, depth: 2.0 }), H)).toEqual({
      ok: false,
      reason: 'does-not-fit',
    });
  });
});

describe('layoutStair — spiral', () => {
  const S = (over: Partial<Stair> = {}): Stair =>
    stair({ type: 'spiral', width: 1.8, depth: 1.8, ...over });
  const angle = (o: Vec2[]): number => {
    const c = o.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return Math.atan2(c.y, c.x);
  };
  const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const onCircle = (r: number) => (p: Vec2) => Math.abs(Math.hypot(p.x, p.y) - r) < 1e-9;

  for (const hand of ['left', 'right'] as const) {
    it(`lays out 18 wedges around the centre, hand ${hand}`, () => {
      const l = ok(layoutStair(S({ hand }), H));
      expect(l.steps).toHaveLength(18);
      expect(l.landings).toHaveLength(0);
      expect(l.treadDepth).toBeCloseTo(bIdeal, 9);
      for (const s of l.steps) {
        expect(signedArea(s.outline)).toBeGreaterThan(0);
        expect(s.outline.filter(onCircle(0.075))).toHaveLength(2);
        expect(s.outline.filter(onCircle(0.9)).length).toBe(s.outline.length - 2);
      }
      // the first wedge starts on the −y side
      expect(hasVertex(l.steps[0]!.outline, { x: 0, y: -0.9 })).toBe(true);
      const sign = hand === 'left' ? 1 : -1;
      for (let i = 1; i < 18; i++) {
        const da = wrap(angle(l.steps[i]!.outline) - angle(l.steps[i - 1]!.outline));
        expect(sign * da).toBeCloseTo(bIdeal / 0.6, 6);
      }
      l.steps.forEach((s, i) => expect(s.top).toBeCloseTo((i + 1) * h, 9));
      // walking line at r = 0.6, from the first riser
      expect(l.walkLine.every(onCircle(0.6))).toBe(true);
      expect(l.walkLine[0]!.x).toBeCloseTo(0, 9);
      expect(l.walkLine[0]!.y).toBeCloseTo(-0.6, 9);
      expect(l.opening).toHaveLength(4);
    });
  }

  it('reports does-not-fit when one turn rises less than 2.1 m (1.2 × 1.2)', () => {
    expect(layoutStair(S({ width: 1.2, depth: 1.2 }), H)).toEqual({
      ok: false,
      reason: 'does-not-fit',
    });
  });

  it('uses the smaller bay side as the diameter (1.8 × 2.4)', () => {
    const l = ok(layoutStair(S({ depth: 2.4 }), H));
    const r = Math.max(...l.steps.flatMap((s) => s.outline.map((p) => Math.hypot(p.x, p.y))));
    expect(r).toBeCloseTo(0.9, 9);
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

describe('layoutStair property sweep', () => {
  it('ok layouts are finite, inside the bay, CCW, evenly risen and within the step rule', () => {
    const okCount: Record<string, number> = {};
    const problems: string[] = [];
    const cx = 3;
    const cy = -2;
    const finite = (q: Vec2): boolean => Number.isFinite(q.x) && Number.isFinite(q.y);
    for (const type of ['straight', 'L', 'U', 'spiral'] as const)
      for (const turn of ['landing', 'winder'] as const)
        for (const hand of ['left', 'right'] as const)
          for (const rotation of [0, Math.PI / 2, Math.PI / 6])
            for (const rise of [2.8, 3.35, 4.2])
              for (const width of [1.8, 2.4, 3.5])
                for (const depth of [2.5, 3.5, 5])
                  for (const flightWidth of [0.8, 1.0]) {
                    const s: Stair = {
                      id: 's',
                      x: cx,
                      y: cy,
                      width,
                      depth,
                      rotation,
                      type,
                      turn,
                      hand,
                      flightWidth,
                    };
                    const l = layoutStair(s, rise);
                    if (!l.ok) continue;
                    okCount[type] = (okCount[type] ?? 0) + 1;
                    const bad = (what: string): void => {
                      problems.push(`${what}: ${JSON.stringify({ ...s, rise })}`);
                    };
                    const rh = l.riserHeight;
                    if (l.treadDepth < 0.6 - 2 * rh - 1e-9 || l.treadDepth > 0.62 - 2 * rh + 1e-9) {
                      bad(`treadDepth ${l.treadDepth}`);
                    }
                    if (!l.walkLine.every(finite)) bad('walkLine NaN');
                    const c = Math.cos(rotation);
                    const sn = Math.sin(rotation);
                    const pieces = [...l.steps, ...l.landings].sort((a, b) => a.top - b.top);
                    pieces.forEach((p, i) => {
                      if (Math.abs(p.top - (i + 1) * rh) > 1e-9) bad(`piece ${i} top ${p.top}`);
                      if (!p.outline.every(finite)) bad(`piece ${i} NaN`);
                      else if (!(signedArea(p.outline) > 0)) bad(`piece ${i} not CCW`);
                      const outside = p.outline.some((q) => {
                        const dx = q.x - cx;
                        const dy = q.y - cy;
                        const lx = dx * c + dy * sn;
                        const ly = -dx * sn + dy * c;
                        return Math.abs(lx) > width / 2 + 1e-9 || Math.abs(ly) > depth / 2 + 1e-9;
                      });
                      if (outside) bad(`piece ${i} outside the bay`);
                    });
                  }
    expect(problems.slice(0, 10)).toEqual([]);
    for (const type of ['straight', 'L', 'U', 'spiral'])
      expect(okCount[type] ?? 0).toBeGreaterThan(0);
  });
});
