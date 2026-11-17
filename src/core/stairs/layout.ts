import type { Stair, Vec2 } from '../types';
import { MAX_RISER, STEP_MIN, STEP_TARGET } from './constants';

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

  // TODO(task 3): spiral stairs and winder turns for L / U.
  if (stair.type === 'spiral') return DOES_NOT_FIT;
  if (stair.type !== 'straight' && stair.turn === 'winder') return DOES_NOT_FIT;

  if (!(fw > 0) || fw > w + TOL) return DOES_NOT_FIT;
  let local: LocalLayout | null;
  if (stair.type === 'straight') local = n >= 2 ? straightLocal(w, d, fw, n, h) : null;
  else if (stair.type === 'U') local = uLandingLocal(w, d, fw, n, h);
  else local = lLandingLocal(w, d, fw, n, h);
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
