import { signedArea } from '../geometry/polygon';
import { closestPointOnSegment } from '../geometry/segment';
import { distance } from '../geometry/vec';
import type { Stair, Vec2 } from '../types';
import {
  MAX_RISER,
  SPIRAL_COLUMN_DIAMETER,
  SPIRAL_MIN_TURN_RISE,
  STEP_MIN,
  STEP_TARGET,
  WINDERS_PER_QUARTER,
} from './constants';

export interface StairPiece {
  /** Plan polygon, world coordinates, counter-clockwise. */
  outline: Vec2[];
  /** Height of the walking surface above the stair's floor. */
  top: number;
}

export type StairLayout =
  | { ok: false; reason: 'does-not-fit' | 'no-rise' }
  | {
      ok: true;
      risers: number;
      riserHeight: number;
      treadDepth: number;
      steps: StairPiece[]; // plan polygons, world coords; top above floor
      landings: StairPiece[];
      walkLine: Vec2[]; // from first riser to last
      opening: Vec2[]; // bay rectangle, world coords
    };

const TOL = 1e-9;
const DOES_NOT_FIT = { ok: false, reason: 'does-not-fit' } as const;

/** Axis-aligned rectangle, counter-clockwise. */
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Drops repeated and collinear vertices (degenerate notches of a stepped landing). */
function clean(poly: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (!q || Math.abs(p.x - q.x) > TOL || Math.abs(p.y - q.y) > TOL) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (
    out.length > 1 &&
    first &&
    last &&
    Math.abs(first.x - last.x) <= TOL &&
    Math.abs(first.y - last.y) <= TOL
  ) {
    out.pop();
  }
  return out.filter((p, i) => {
    const a = out[(i - 1 + out.length) % out.length]!;
    const b = out[(i + 1) % out.length]!;
    return Math.abs((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) > TOL;
  });
}

/**
 * Largest tread b ≤ STEP_TARGET − 2h with b × treads ≤ available for every constraint, or null when
 * even STEP_MIN − 2h does not fit.
 */
function chooseTread(h: number, limits: [available: number, treads: number][]): number | null {
  let b = STEP_TARGET - 2 * h;
  for (const [available, treads] of limits) {
    if (treads > 0) b = Math.min(b, available / treads);
    else if (available < -TOL) return null;
  }
  return b >= STEP_MIN - 2 * h - TOL && b > 0 ? b : null;
}

interface LocalLayout {
  treadDepth: number;
  steps: StairPiece[];
  landings: StairPiece[];
  walkLine: Vec2[];
}

/** One flight against the +x side (hand right), slack at the bottom, last riser on the +y edge. */
function straightLocal(w: number, d: number, fw: number, n: number, h: number): LocalLayout | null {
  const treads = n - 1;
  const b = chooseTread(h, [[d, treads]]);
  if (b === null) return null;
  const x0 = w / 2 - fw;
  const x1 = w / 2;
  const yStart = d / 2 - treads * b;
  const steps = Array.from({ length: treads }, (_, i) => ({
    outline: rect(x0, yStart + i * b, x1, yStart + (i + 1) * b),
    top: (i + 1) * h,
  }));
  const mid = (x0 + x1) / 2;
  return {
    treadDepth: b,
    steps,
    landings: [],
    walkLine: [
      { x: mid, y: yStart },
      { x: mid, y: d / 2 },
    ],
  };
}

/** Treads per flight for a landing turn: (n − 1) − 1, split evenly, first flight takes the extra. */
function splitFlights(n: number): [number, number] {
  const treads = n - 2;
  const n1 = Math.ceil(treads / 2);
  return [n1, treads - n1];
}

/**
 * U with a landing, turning right: first flight on the −x side climbing +y from the −y edge, landing
 * across the +y end, second flight on the +x side back toward −y ending on the −y edge.
 */
function uLandingLocal(w: number, d: number, fw: number, n: number, h: number): LocalLayout | null {
  if (2 * fw > w + TOL) return null;
  const [n1, n2] = splitFlights(n);
  if (n2 < 1) return null;
  const b = chooseTread(h, [[d - fw, n1]]);
  if (b === null) return null;
  const bottom = -d / 2;
  const left0 = -w / 2;
  const left1 = -w / 2 + fw;
  const right0 = w / 2 - fw;
  const right1 = w / 2;
  const y1 = bottom + n1 * b; // first flight's top riser = landing edge on the left
  const y2 = bottom + n2 * b; // second flight's first riser = landing edge on the right
  const steps: StairPiece[] = [];
  for (let i = 0; i < n1; i++) {
    steps.push({
      outline: rect(left0, bottom + i * b, left1, bottom + (i + 1) * b),
      top: (i + 1) * h,
    });
  }
  for (let k = 0; k < n2; k++) {
    steps.push({
      outline: rect(right0, y2 - (k + 1) * b, right1, y2 - k * b),
      top: (n1 + 2 + k) * h,
    });
  }
  const landing = clean([
    { x: left0, y: y1 },
    { x: right0, y: y1 },
    { x: right0, y: y2 },
    { x: right1, y: y2 },
    { x: right1, y: d / 2 },
    { x: left0, y: d / 2 },
  ]);
  const midY = (y1 + d / 2) / 2;
  const c1 = (left0 + left1) / 2;
  const c2 = (right0 + right1) / 2;
  return {
    treadDepth: b,
    steps,
    landings: [{ outline: landing, top: (n1 + 1) * h }],
    walkLine: [
      { x: c1, y: bottom },
      { x: c1, y: midY },
      { x: c2, y: midY },
      { x: c2, y: bottom },
    ],
  };
}

/**
 * L with a landing, turning right: first flight on the −x side climbing +y from the −y edge, landing
 * in the (−x, +y) corner, second flight along the +y edge toward +x ending on the +x edge.
 */
function lLandingLocal(w: number, d: number, fw: number, n: number, h: number): LocalLayout | null {
  if (fw > d + TOL) return null;
  const [n1, n2] = splitFlights(n);
  if (n2 < 1) return null;
  const b = chooseTread(h, [
    [d - fw, n1],
    [w - fw, n2],
  ]);
  if (b === null) return null;
  const bottom = -d / 2;
  const top = d / 2;
  const left0 = -w / 2;
  const left1 = -w / 2 + fw;
  const band0 = top - fw;
  const y1 = bottom + n1 * b; // first flight's top riser
  const x2 = w / 2 - n2 * b; // second flight's first riser
  const steps: StairPiece[] = [];
  for (let i = 0; i < n1; i++) {
    steps.push({
      outline: rect(left0, bottom + i * b, left1, bottom + (i + 1) * b),
      top: (i + 1) * h,
    });
  }
  for (let k = 0; k < n2; k++) {
    steps.push({ outline: rect(x2 + k * b, band0, x2 + (k + 1) * b, top), top: (n1 + 2 + k) * h });
  }
  // The walking area of both flights at the turn: grows along each flight to absorb the slack.
  const landing = clean([
    { x: left0, y: y1 },
    { x: left1, y: y1 },
    { x: left1, y: band0 },
    { x: x2, y: band0 },
    { x: x2, y: top },
    { x: left0, y: top },
  ]);
  const c1 = (left0 + left1) / 2;
  const c2 = (band0 + top) / 2;
  return {
    treadDepth: b,
    steps,
    landings: [{ outline: landing, top: (n1 + 1) * h }],
    walkLine: [
      { x: c1, y: bottom },
      { x: c1, y: c2 },
      { x: w / 2, y: c2 },
    ],
  };
}

/** Arc length of a polyline. */
function polyLength(line: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < line.length; i++) len += distance(line[i - 1]!, line[i]!);
  return len;
}

/** Point at arc length `s` along a polyline (clamped to its ends). */
function pointAt(line: Vec2[], s: number): Vec2 {
  let rest = s;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = distance(a, b);
    if (rest <= len || i === line.length - 1) {
      const t = len > TOL ? Math.min(1, Math.max(0, rest / len)) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= len;
  }
  return line[0]!;
}

/** Nearest point of a polyline to `p` and its arc-length parameter. */
function project(line: Vec2[], p: Vec2): { point: Vec2; t: number } {
  let best = { point: line[0]!, t: 0 };
  let bestD = Infinity;
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!;
    const b = line[i]!;
    const len = distance(a, b);
    const c = closestPointOnSegment(p, a, b);
    const dd = distance(c.point, p);
    if (dd < bestD - TOL) {
      bestD = dd;
      best = { point: c.point, t: acc + c.t * len };
    }
    acc += len;
  }
  return best;
}

/** Vertices of a polyline whose arc-length parameter lies strictly inside (t0, t1). */
function verticesBetween(line: Vec2[], t0: number, t1: number): Vec2[] {
  const out: Vec2[] = [];
  let acc = 0;
  for (let i = 0; i < line.length; i++) {
    if (i > 0) acc += distance(line[i - 1]!, line[i]!);
    if (acc > t0 + TOL && acc < t1 - TOL) out.push(line[i]!);
  }
  return out;
}

/**
 * Winder outlines of a turn. `walk` is the walking line through the turn (flight centre lines, at
 * flightWidth / 2 from the inner edge), `inner` the inner edge of the turn (the inner corner, plus
 * the well side and any remainder of the second flight) and `outer` the bay boundary around it,
 * all in climbing order. The walking line is split into `count` equal treads; each riser runs from
 * the nearest inner point (the inner corner inside a corner square, so winders radiate from it)
 * through the walking line to the bay boundary at twice that distance.
 */
function winderOutlines(outer: Vec2[], inner: Vec2[], walk: Vec2[], count: number): Vec2[][] {
  const len = polyLength(walk);
  const risers = Array.from({ length: count + 1 }, (_, k) => {
    const q = pointAt(walk, (k * len) / count);
    const i = project(inner, q);
    const o = { x: 2 * q.x - i.point.x, y: 2 * q.y - i.point.y };
    return { inner: i, outer: { point: o, t: project(outer, o).t } };
  });
  return risers.slice(0, count).map((r0, k) => {
    const r1 = risers[k + 1]!;
    const poly = clean([
      r0.inner.point,
      r0.outer.point,
      ...verticesBetween(outer, r0.outer.t, r1.outer.t),
      r1.outer.point,
      r1.inner.point,
      ...verticesBetween(inner, r0.inner.t, r1.inner.t).reverse(),
    ]);
    return signedArea(poly) < 0 ? poly.reverse() : poly;
  });
}

/**
 * Tread split for a winder turn: n1 treads in the first flight (slack at its bottom) and n2 in the
 * second (ending on the far bay edge); the second flight's remainder e = len2 − n2·b (< b) joins
 * the winders, whose walking-line depth (turnWalk + e) / winders must stay ≥ STEP_MIN − 2h.
 * Largest b wins; ties go to the longer second flight.
 */
function splitWinderFlights(
  h: number,
  treads: number,
  len1: number,
  len2: number,
  turnWalk: number,
  winders: number,
): { b: number; n1: number; n2: number } | null {
  const bMin = STEP_MIN - 2 * h;
  let best: { b: number; n1: number; n2: number } | null = null;
  for (let n2 = treads - 1; n2 >= 1; n2--) {
    const n1 = treads - n2;
    const hi = Math.min(
      STEP_TARGET - 2 * h,
      len2 / n2,
      len1 / n1,
      (turnWalk + len2 - winders * bMin) / n2,
    );
    const lo = Math.max(bMin, len2 / (n2 + 1));
    if (hi > 0 && hi >= lo - TOL && (!best || hi > best.b + TOL)) best = { b: hi, n1, n2 };
  }
  return best;
}

const withTops = (outlines: Vec2[][], h: number): StairPiece[] =>
  outlines.map((outline, i) => ({ outline, top: (i + 1) * h }));

/**
 * L with winders, turning right: first flight on the −x side climbing +y (slack at its bottom),
 * 3 winders in the (−x, +y) corner radiating from the inner corner, second flight along the +y
 * edge toward +x ending on the +x edge.
 */
function lWinderLocal(w: number, d: number, fw: number, n: number, h: number): LocalLayout | null {
  if (fw > d + TOL) return null;
  const split = splitWinderFlights(
    h,
    n - 1 - WINDERS_PER_QUARTER,
    d - fw,
    w - fw,
    fw,
    WINDERS_PER_QUARTER,
  );
  if (!split) return null;
  const { b, n1, n2 } = split;
  const left = -w / 2;
  const px = left + fw; // inner corner
  const py = d / 2 - fw;
  const e = w - fw - n2 * b; // second flight remainder, joins the winders
  const x2 = px + e; // second flight's first riser
  const yStart = py - n1 * b;
  const c1 = left + fw / 2;
  const c2 = d / 2 - fw / 2;
  const outlines: Vec2[][] = [];
  for (let i = 0; i < n1; i++) outlines.push(rect(left, yStart + i * b, px, yStart + (i + 1) * b));
  outlines.push(
    ...winderOutlines(
      [
        { x: left, y: py },
        { x: left, y: d / 2 },
        { x: x2, y: d / 2 },
      ],
      [
        { x: px, y: py },
        { x: x2, y: py },
      ],
      [
        { x: c1, y: py },
        { x: c1, y: c2 },
        { x: x2, y: c2 },
      ],
      WINDERS_PER_QUARTER,
    ),
  );
  for (let k = 0; k < n2; k++) outlines.push(rect(x2 + k * b, py, x2 + (k + 1) * b, d / 2));
  return {
    treadDepth: b,
    steps: withTops(outlines, h),
    landings: [],
    walkLine: [
      { x: c1, y: yStart },
      { x: c1, y: c2 },
      { x: w / 2, y: c2 },
    ],
  };
}

/**
 * U with winders, turning right: first flight on the −x side climbing +y (slack at its bottom),
 * 6 winders across the +y end (3 radiating from each inner corner of the well; the corners
 * coincide when the well is 0), second flight on the +x side back toward −y ending on the −y edge.
 */
function uWinderLocal(w: number, d: number, fw: number, n: number, h: number): LocalLayout | null {
  if (2 * fw > w + TOL || fw > d + TOL) return null;
  const winders = 2 * WINDERS_PER_QUARTER;
  const split = splitWinderFlights(h, n - 1 - winders, d - fw, d - fw, w, winders);
  if (!split) return null;
  const { b, n1, n2 } = split;
  const left = -w / 2;
  const right = w / 2;
  const px1 = left + fw;
  const px2 = right - fw;
  const py = d / 2 - fw;
  const e = d - fw - n2 * b;
  const y2 = py - e; // second flight's first riser
  const yStart = py - n1 * b;
  const c1 = left + fw / 2;
  const c2 = right - fw / 2;
  const cy = d / 2 - fw / 2;
  const outlines: Vec2[][] = [];
  for (let i = 0; i < n1; i++) outlines.push(rect(left, yStart + i * b, px1, yStart + (i + 1) * b));
  outlines.push(
    ...winderOutlines(
      [
        { x: left, y: py },
        { x: left, y: d / 2 },
        { x: right, y: d / 2 },
        { x: right, y: y2 },
      ],
      [
        { x: px1, y: py },
        { x: px2, y: py },
        { x: px2, y: y2 },
      ],
      [
        { x: c1, y: py },
        { x: c1, y: cy },
        { x: c2, y: cy },
        { x: c2, y: y2 },
      ],
      winders,
    ),
  );
  for (let k = 0; k < n2; k++) outlines.push(rect(px2, y2 - (k + 1) * b, right, y2 - k * b));
  return {
    treadDepth: b,
    steps: withTops(outlines, h),
    landings: [],
    walkLine: [
      { x: c1, y: yStart },
      { x: c1, y: cy },
      { x: c2, y: cy },
      { x: c2, y: -d / 2 },
    ],
  };
}

const ARC_STEP = Math.PI / 18; // 10°

/** Points of an arc of radius r from angle a0 to a1, one segment per ≤ 10°. */
function arc(r: number, a0: number, a1: number): Vec2[] {
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / ARC_STEP - TOL));
  return Array.from({ length: segs + 1 }, (_, j) => {
    const a = a0 + ((a1 - a0) * j) / segs;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  });
}
/**
 * Spiral, hand right: centred, diameter min(w, d), wedges from the centre column to the outer
 * radius climbing clockwise from the −y side. Tread b = STEP_TARGET − 2h on the walking line at
 * 2/3 of the radius; one full turn must rise at least SPIRAL_MIN_TURN_RISE.
 */
function spiralLocal(w: number, d: number, n: number, h: number): LocalLayout | null {
  const r = Math.min(w, d) / 2;
  const rc = SPIRAL_COLUMN_DIAMETER / 2;
  if (r <= rc) return null;
  const rw = (2 * r) / 3;
  const b = STEP_TARGET - 2 * h;
  const theta = b / rw;
  if (((2 * Math.PI) / theta) * h < SPIRAL_MIN_TURN_RISE - TOL) return null;
  const start = -Math.PI / 2;
  const outlines = Array.from({ length: n - 1 }, (_, k) => {
    const a0 = start - k * theta;
    const a1 = a0 - theta; // clockwise; counter-clockwise outline runs a1 → a0 outside
    return [
      ...arc(r, a1, a0),
      { x: rc * Math.cos(a0), y: rc * Math.sin(a0) },
      { x: rc * Math.cos(a1), y: rc * Math.sin(a1) },
    ];
  });
  return {
    treadDepth: b,
    steps: withTops(outlines, h),
    landings: [],
    walkLine: arc(rw, start, start - (n - 1) * theta),
  };
}

/**
 * Lays out the steps of a stair climbing `rise` (elevation above − elevation of its floor). Built
 * in the local frame (origin at the bay centre, +y = first flight's climb, hand right), mirrored
 * for hand left, then rotated by `stair.rotation` and moved to the bay centre.
 */
export function layoutStair(stair: Stair, rise: number): StairLayout {
  if (!Number.isFinite(rise) || rise <= 0) return { ok: false, reason: 'no-rise' };
  const { width: w, depth: d, flightWidth: fw } = stair;
  if (!(w > 0) || !(d > 0)) return DOES_NOT_FIT;
  const n = Math.ceil(rise / MAX_RISER - TOL);
  const h = rise / n;

  let local: LocalLayout | null;
  if (stair.type === 'spiral') local = n >= 2 ? spiralLocal(w, d, n, h) : null;
  else if (!(fw > 0) || fw > w + TOL) local = null;
  else if (stair.type === 'straight') local = n >= 2 ? straightLocal(w, d, fw, n, h) : null;
  else if (stair.type === 'U') {
    local = stair.turn === 'winder' ? uWinderLocal(w, d, fw, n, h) : uLandingLocal(w, d, fw, n, h);
  } else {
    local = stair.turn === 'winder' ? lWinderLocal(w, d, fw, n, h) : lLandingLocal(w, d, fw, n, h);
  }
  if (!local) return DOES_NOT_FIT;

  const mirror = stair.hand === 'left';
  const cos = Math.cos(stair.rotation);
  const sin = Math.sin(stair.rotation);
  const toWorld = (p: Vec2): Vec2 => {
    const x = mirror ? -p.x : p.x;
    return { x: stair.x + x * cos - p.y * sin, y: stair.y + x * sin + p.y * cos };
  };
  // Mirroring flips orientation; reverse to keep polygons counter-clockwise.
  const poly = (o: Vec2[]): Vec2[] => {
    const pts = o.map(toWorld);
    return mirror ? pts.reverse() : pts;
  };
  const piece = (s: StairPiece): StairPiece => ({ outline: poly(s.outline), top: s.top });

  return {
    ok: true,
    risers: n,
    riserHeight: h,
    treadDepth: local.treadDepth,
    steps: local.steps.map(piece),
    landings: local.landings.map(piece),
    walkLine: local.walkLine.map(toWorld),
    opening: rect(-w / 2, -d / 2, w / 2, d / 2).map((p) => ({
      x: stair.x + p.x * cos - p.y * sin,
      y: stair.y + p.x * sin + p.y * cos,
    })),
  };
}
