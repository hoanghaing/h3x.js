import { GEOM_TOL } from '../constants';
import { signedArea } from '../geometry/polygon';
import { cross, sub, tidy } from '../geometry/vec';
import type { OpeningType, Vec2 } from '../types';
import type { OpeningPiece, SweepArea } from './geometry';

/** Face width of a frame member or mullion. */
const FRAME_WIDTH = 0.05;
const FRAME_DEPTH = 0.1;
const LEAF_DEPTH = 0.04;
const SHUTTER_DEPTH = 0.03;
const SASH_WIDTH = 0.04;
/** Depth of a sliding sash; three tracks of them fit in the frame. */
const SLIDING_SASH_DEPTH = 0.03;
const GLASS_DEPTH = 0.01;
/** How far two sliding panels on different tracks overlap. */
const PANEL_OVERLAP = 0.08;
/** Side of the square box of a rolling door. */
const BOX_SIZE = 0.3;
/** How far beyond the wall face an open awning sash is drawn. */
const AWNING_PROJECTION = 0.15;
/** A folding panel half folded stands at 45 degrees to the wall. */
const HALF_FOLD = Math.SQRT1_2;
/** Chords per quarter circle: within GEOM_TOL of the arc up to a 3 m leaf. */
const ARC_SEGMENTS = 32;

/**
 * An opening in its own coordinates, so each type is laid out once: `e` runs along the wall from
 * the hinge jamb (0) to the other jamb (w), `v` from the wall centre line toward the swing side.
 */
export interface LocalOpening {
  type: OpeningType;
  leaves: number;
  /** Share of the leaf at e = 0 of a double door. */
  split: number;
  w: number;
  /** Wall thickness. */
  t: number;
  z0: number;
  z1: number;
  at(e: number, v: number): Vec2;
}

type Role = OpeningPiece['role'];
type Span = [lo: number, hi: number];

const indices = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** A piece parallel to the wall, `v` from its centre line. */
function along(
  o: LocalOpening,
  role: Role,
  [lo, hi]: Span,
  v: number,
  depth = 0,
  [z0, z1]: Span = [o.z0, o.z1],
): OpeningPiece {
  return { role, a: o.at(lo, v), b: o.at(hi, v), depth, z0, z1 };
}

/** A plan line between two points. */
function line(o: LocalOpening, role: Role, a: Vec2, b: Vec2): OpeningPiece {
  return { role, a, b, depth: 0, z0: o.z0, z1: o.z1 };
}

const frameWidth = (o: LocalOpening): number => Math.min(FRAME_WIDTH, o.w / (4 * o.leaves));

/** Where the mullions stand. */
const divisionsOf = (o: LocalOpening): number[] =>
  indices(o.leaves - 1).map((i) => ((i + 1) * o.w) / o.leaves);

/** The spans between mullions, `end` in from each jamb. */
function bays(o: LocalOpening, end: number): Span[] {
  const half = frameWidth(o) / 2;
  const edges = [0, ...divisionsOf(o), o.w];
  return indices(o.leaves).map((i) => [
    i === 0 ? end : edges[i]! + half,
    i === o.leaves - 1 ? o.w - end : edges[i + 1]! - half,
  ]);
}

/** The sliding panels between the jambs, each overlapping a neighbour on another track. */
function slidingPanels(o: LocalOpening): Array<{ span: Span; v: number; depth: number }> {
  const n = o.leaves;
  const isWindow = o.type === 'window-sliding';
  const depth = Math.min(isWindow ? SLIDING_SASH_DEPTH : LEAF_DEPTH, o.t / 5);
  // Track offsets in panel depths. A door's tracks are on the swing side, its middle panels on
  // the outer one. A window has no side, so its pattern must look the same turned half round.
  const track = (i: number): number => {
    if (isWindow) return n === 3 ? 1 - i : i % 2 ? -0.5 : 0.5;
    return (n === 2 ? i === 1 : i > 0 && i < n - 1) ? 1.5 : 0.5;
  };
  const start = frameWidth(o);
  const width = (o.w - 2 * start) / n;
  const lap = Math.min(PANEL_OVERLAP, width / 3) / 2;
  return indices(n).map((i) => {
    const before = i > 0 && track(i - 1) !== track(i) ? lap : 0;
    const after = i < n - 1 && track(i + 1) !== track(i) ? lap : 0;
    return {
      span: [start + i * width - before, start + (i + 1) * width + after],
      v: track(i) * depth,
      depth,
    };
  });
}

/** The lengths of a double door's leaves. */
function doubleLeaves(o: LocalOpening): [big: number, small: number] {
  const big = tidy(o.split * o.w);
  return [big, tidy(o.w - big)];
}

function rollingBox(o: LocalOpening): OpeningPiece {
  const v = o.t / 2 + BOX_SIZE / 2;
  return along(o, 'box', [0, o.w], v, BOX_SIZE, [o.z1, o.z1 + BOX_SIZE]);
}

/** The drafting pose: swing leaves open, folding half folded, sliding on their tracks. */
export function planPose(o: LocalOpening): OpeningPiece[] {
  const { w, leaves: n } = o;
  const h = o.t / 2;
  const acrossWall = (e: number): OpeningPiece => line(o, 'frame', o.at(e, -h), o.at(e, h));
  const jambs = (): OpeningPiece[] => [0, w].map(acrossWall);
  const divisions = (): OpeningPiece[] => divisionsOf(o).map(acrossWall);
  const faces = (): OpeningPiece[] => [-h, h].map((v) => along(o, 'face', [0, w], v));
  const openLeaf = (hinge: number, length: number): OpeningPiece =>
    line(o, 'leaf', o.at(hinge, 0), o.at(hinge, length));

  switch (o.type) {
    case 'door-swing':
      return [openLeaf(0, w)];
    case 'door-double': {
      const [big, small] = doubleLeaves(o);
      return [openLeaf(0, big), openLeaf(w, small)];
    }
    case 'door-sliding': {
      const panels = slidingPanels(o);
      if (n === 1) {
        // Half slid toward e = 0, along the wall face and clear of it.
        const { depth } = panels[0]!;
        return [...jambs(), along(o, 'leaf', [-w / 2, w / 2], h + depth, depth)];
      }
      return [...jambs(), ...panels.map((p) => along(o, 'leaf', p.span, p.v, p.depth))];
    }
    case 'door-folding': {
      const step = (w / n) * HALF_FOLD;
      const vertex = (i: number): Vec2 => o.at(i * step, i % 2 ? step : 0);
      const zigzag = indices(n).map((i) => line(o, 'leaf', vertex(i), vertex(i + 1)));
      return [...jambs(), along(o, 'track', [0, w], 0), ...zigzag];
    }
    case 'door-rolling':
      return [...jambs(), along(o, 'shutter', [0, w], 0), rollingBox(o)];
    case 'opening':
      return jambs();
    case 'window-casement': {
      const open = bays(o, 0).map(([lo, hi], i) => {
        // The last of several is hinged at its far side; of 3 the other two at their near side,
        // of 4 the leaves pair up.
        const atNearSide = n === 1 || (i < n - 1 && (n % 2 === 1 || i % 2 === 0));
        return openLeaf(atNearSide ? lo : hi, hi - lo);
      });
      return [...faces(), ...divisions(), ...open];
    }
    case 'window-sliding':
      return [...faces(), ...slidingPanels(o).map((p) => along(o, 'leaf', p.span, p.v, p.depth))];
    case 'window-awning': {
      const out = h + AWNING_PROJECTION;
      return [...faces(), ...divisions(), ...bays(o, 0).map((bay) => along(o, 'leaf', bay, out))];
    }
    case 'window-fixed':
      return [
        along(o, 'face', [0, w], -h),
        along(o, 'glass', [0, w], 0),
        along(o, 'face', [0, w], h),
        ...divisions(),
      ];
  }
}

/** The shut pose, each piece a solid: frame, leaves and glass. An empty cut holds none. */
export function closedPose(o: LocalOpening): OpeningPiece[] {
  const { type, w, t, z0, z1 } = o;
  if (type === 'opening' || !(w > GEOM_TOL && z1 - z0 > GEOM_TOL)) return []; // also for NaN

  const isWindow = type.startsWith('window');
  const side = frameWidth(o);
  const rail = Math.min(FRAME_WIDTH, (z1 - z0) / 4);
  // The tracks of a sliding door need the whole reveal.
  const frameDepth = type === 'door-sliding' ? t : Math.min(FRAME_DEPTH, t);
  const leafDepth = Math.min(LEAF_DEPTH, frameDepth);
  const glassDepth = Math.min(GLASS_DEPTH, t / 5);
  const inner: Span = [side, w - side];
  const clear: Span = [isWindow ? z0 + rail : z0, z1 - rail];

  const member = (span: Span, height?: Span): OpeningPiece =>
    along(o, 'frame', span, 0, frameDepth, height);
  const frame = [member([0, side]), member([w - side, w]), member(inner, [z1 - rail, z1])];
  if (isWindow) frame.push(member(inner, [z0, z0 + rail]));
  const mullions = (): OpeningPiece[] =>
    divisionsOf(o).map((e) => member([e - side / 2, e + side / 2], clear));
  const panel = (span: Span, v = 0, depth = leafDepth): OpeningPiece =>
    along(o, 'leaf', span, v, depth, clear);
  const sash = ([lo, hi]: Span, v = 0, depth = leafDepth): OpeningPiece[] => {
    const [bottom, top] = clear;
    const m = Math.min(SASH_WIDTH, (hi - lo) / 4, (top - bottom) / 4);
    const between: Span = [lo + m, hi - m];
    return [
      along(o, 'leaf', [lo, lo + m], v, depth, clear),
      along(o, 'leaf', [hi - m, hi], v, depth, clear),
      along(o, 'leaf', between, v, depth, [bottom, bottom + m]),
      along(o, 'leaf', between, v, depth, [top - m, top]),
      along(o, 'glass', between, v, glassDepth, [bottom + m, top - m]),
    ];
  };

  switch (type) {
    case 'door-swing':
      return [...frame, panel(inner)];
    case 'door-double': {
      const meet = side + o.split * (w - 2 * side);
      return [...frame, panel([side, meet]), panel([meet, w - side])];
    }
    case 'door-sliding':
      return [...frame, ...slidingPanels(o).map((p) => panel(p.span, p.v, p.depth))];
    case 'door-folding': {
      const width = (w - 2 * side) / o.leaves;
      const panels = indices(o.leaves).map((i) =>
        panel([side + i * width, side + (i + 1) * width]),
      );
      return [...frame, ...panels];
    }
    case 'door-rolling': {
      const shutter = along(o, 'shutter', inner, 0, Math.min(SHUTTER_DEPTH, t), clear);
      return [...frame, shutter, rollingBox(o)];
    }
    case 'window-sliding':
      return [...frame, ...slidingPanels(o).flatMap((p) => sash(p.span, p.v, p.depth))];
    case 'window-casement':
    case 'window-awning':
      return [...frame, ...mullions(), ...bays(o, side).flatMap((bay) => sash(bay))];
    case 'window-fixed': {
      const panes = bays(o, side).map((bay) => along(o, 'glass', bay, 0, glassDepth, clear));
      return [...frame, ...mullions(), ...panes];
    }
  }
}

const counterClockwise = (points: Vec2[]): Vec2[] =>
  signedArea(points) < 0 ? points.reverse() : points;

/** The quarter circle a leaf hinged at `hinge` covers between open and shut at `closed`. */
function quarterCircle(o: LocalOpening, hinge: number, closed: number, r: number): SweepArea {
  const center = o.at(hinge, 0);
  const from = o.at(hinge, r);
  const to = o.at(closed, 0);
  const dir = closed < hinge ? -1 : 1;
  const between = indices(ARC_SEGMENTS - 1).map((i) => {
    const turn = ((i + 1) / ARC_SEGMENTS) * (Math.PI / 2);
    return o.at(hinge + dir * r * Math.sin(turn), r * Math.cos(turn));
  });
  return {
    points: counterClockwise([center, from, ...between, to]),
    arc: { center, r, from, to, ccw: cross(sub(from, center), sub(to, center)) > 0 },
  };
}

/** The floor area moving leaves need: swing, double and folding doors only. */
export function sweptAreas(o: LocalOpening): SweepArea[] {
  const { w } = o;
  if (o.type === 'door-swing') return [quarterCircle(o, 0, w, w)];
  if (o.type === 'door-double') {
    const [big, small] = doubleLeaves(o);
    return [quarterCircle(o, 0, big, big), quarterCircle(o, w, big, small)];
  }
  if (o.type === 'door-folding') {
    const panel = w / o.leaves;
    const band = [o.at(0, 0), o.at(w, 0), o.at(w, panel), o.at(0, panel)];
    return [{ points: counterClockwise(band) }];
  }
  return [];
}
