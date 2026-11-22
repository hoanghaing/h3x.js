import type { OutlineRing } from '../floors/outline';
import type { Id, RoofEdge, RoofMaterial, Vec2 } from '../types';

export type RoofPresetId =
  | 'thai'
  | 'japanese'
  | 'metal'
  | 'traditional'
  | 'gable'
  | 'hip'
  | 'shed'
  | 'mansard'
  | 'gambrel'
  | 'flat'
  | 'glass-frame'
  | 'poly-frame';

export interface RoofPreset {
  shape: 'hip' | 'gable' | 'shed' | 'flat';
  pitch?: number;
  breakHeight?: number;
  upperPitch?: number;
  overhang: number;
  thickness: number;
  material: RoofMaterial;
  parapet?: number;
  supports?: 'posts';
}

export const ROOF_PRESETS: Record<RoofPresetId, RoofPreset> = {
  thai: { shape: 'hip', pitch: 35, overhang: 0.8, thickness: 0.1, material: 'tile' },
  japanese: { shape: 'hip', pitch: 22, overhang: 0.9, thickness: 0.1, material: 'tile' },
  metal: { shape: 'shed', pitch: 12, overhang: 0.4, thickness: 0.05, material: 'metal' },
  traditional: { shape: 'gable', pitch: 30, overhang: 1.2, thickness: 0.12, material: 'tile' },
  gable: { shape: 'gable', pitch: 30, overhang: 0.5, thickness: 0.1, material: 'tile' },
  hip: { shape: 'hip', pitch: 30, overhang: 0.5, thickness: 0.1, material: 'tile' },
  shed: { shape: 'shed', pitch: 30, overhang: 0.5, thickness: 0.1, material: 'tile' },
  mansard: {
    shape: 'hip',
    pitch: 70,
    breakHeight: 1.5,
    upperPitch: 30,
    overhang: 0.3,
    thickness: 0.1,
    material: 'tile',
  },
  gambrel: {
    shape: 'gable',
    pitch: 60,
    breakHeight: 1.5,
    upperPitch: 30,
    overhang: 0.3,
    thickness: 0.1,
    material: 'tile',
  },
  flat: { shape: 'flat', overhang: 0, thickness: 0.12, material: 'concrete', parapet: 1.1 },
  'glass-frame': {
    shape: 'shed',
    pitch: 10,
    overhang: 0.2,
    thickness: 0.02,
    material: 'glass',
    supports: 'posts',
  },
  'poly-frame': {
    shape: 'shed',
    pitch: 10,
    overhang: 0.2,
    thickness: 0.02,
    material: 'polycarbonate',
    supports: 'posts',
  },
};

/** Pitch used when a preset has none (flat). */
const FALLBACK_PITCH = 30;
/** Gable preset: edges within this angle of the longest edge's direction slope. */
const GABLE_ANGLE = (30 * Math.PI) / 180;

function slopeOf(id: RoofPresetId): RoofEdge {
  const p = ROOF_PRESETS[id];
  const e: RoofEdge = { kind: 'slope', pitch: p.pitch ?? FALLBACK_PITCH };
  if (p.breakHeight !== undefined && p.upperPitch !== undefined) {
    e.breakHeight = p.breakHeight;
    e.upperPitch = p.upperPitch;
  }
  return e;
}

const len = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Consecutive edges within this angle of each other belong to one side (a run). */
const RUN_ANGLE = (2 * Math.PI) / 180;

/** Run index of each edge: consecutive collinear edges (wrapping around the ring) share one. */
function runsOf(ring: Vec2[]): number[] {
  const n = ring.length;
  const d = (i: number): Vec2 => {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const joined = (i: number, j: number): boolean => {
    const u = d(i);
    const v = d(j);
    const l = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    if (l === 0) return true;
    return u.x * v.x + u.y * v.y > 0 && Math.abs(u.x * v.y - u.y * v.x) / l <= Math.sin(RUN_ANGLE);
  };
  const run: number[] = [];
  let cur = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0 && !joined(i - 1, i)) cur++;
    run.push(cur);
  }
  if (cur > 0 && joined(n - 1, 0)) {
    for (let i = 0; i < n; i++) if (run[i] === cur) run[i] = 0;
  }
  return run;
}

/**
 * Which edges of `ring` slope under the preset's shape. Consecutive collinear edges form one
 * side (a wall split by an interior wall is still one eaves line); the longest side by summed
 * length decides. hip = all; shed = every edge of the longest side; gable = every edge of the
 * sides whose direction is within 30 degrees (either sense) of the longest side's direction.
 * Ties go to the first side.
 */
function slopes(id: RoofPresetId, ring: Vec2[]): boolean[] {
  const n = ring.length;
  const shape = ROOF_PRESETS[id].shape;
  if (shape === 'hip' || shape === 'flat' || n === 0) return ring.map(() => true);
  const run = runsOf(ring);
  const count = Math.max(...run) + 1;
  const total = new Array<number>(count).fill(0);
  ring.forEach((p, i) => {
    const r = run[i]!;
    total[r]! += len(p, ring[(i + 1) % n]!);
  });
  let best = 0;
  total.forEach((l, r) => {
    if (l > total[best]! + 1e-9) best = r;
  });
  if (shape === 'shed') return run.map((r) => r === best);
  // Direction of a run: from its first start to its last end (wrapped runs are contiguous mod n).
  const dir = (r: number): Vec2 => {
    const idx = run.map((x, i) => (x === r ? i : -1)).filter((i) => i >= 0);
    // The run's first edge is the one whose predecessor is not in the run.
    const startEdge = idx.find((i) => run[(i - 1 + n) % n] !== r) ?? idx[0]!;
    const endEdge = idx.find((i) => run[(i + 1) % n] !== r) ?? idx[idx.length - 1]!;
    const a = ring[startEdge]!;
    const b = ring[(endEdge + 1) % n]!;
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const ref = dir(best);
  const refLen = Math.hypot(ref.x, ref.y);
  const slopesRun = Array.from({ length: count }, (_, r) => {
    if (r === best) return true;
    const v = dir(r);
    const l = Math.hypot(v.x, v.y);
    if (l === 0 || refLen === 0) return false;
    return Math.abs(ref.x * v.x + ref.y * v.y) / (refLen * l) >= Math.cos(GABLE_ANGLE) - 1e-9;
  });
  return run.map((r) => slopesRun[r]!);
}

/** One edge spec per edge of `ring` (edge i = ring[i] to ring[i + 1]) for the preset's shape. */
export function presetEdges(id: RoofPresetId, ring: Vec2[]): RoofEdge[] {
  const slope = slopeOf(id);
  return slopes(id, ring).map((s) => (s ? structuredClone(slope) : { kind: 'gable' }));
}

/**
 * Edge specs keyed by wall id for a follow roof: the preset's `presetEdges` over `ring.points`,
 * mapped through `ring.walls`. A wall that owns several ring edges (bevels) takes the spec of
 * its longest edge.
 */
export function presetWallEdges(id: RoofPresetId, ring: OutlineRing): Record<Id, RoofEdge> {
  const edges = presetEdges(id, ring.points);
  const n = ring.points.length;
  const longest = new Map<Id, number>();
  const out: Record<Id, RoofEdge> = {};
  edges.forEach((e, i) => {
    const wall = ring.walls[i];
    if (wall === undefined) return;
    const l = len(ring.points[i]!, ring.points[(i + 1) % n]!);
    if (l > (longest.get(wall) ?? -1)) {
      longest.set(wall, l);
      out[wall] = e;
    }
  });
  return out;
}
