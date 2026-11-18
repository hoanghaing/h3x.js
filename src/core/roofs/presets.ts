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

/**
 * Which edges of `ring` slope under the preset's shape: hip = all; shed = the longest edge;
 * gable = edges whose direction is within 30 degrees (either sense) of the longest edge's
 * direction. Ties go to the first edge.
 */
function slopes(id: RoofPresetId, ring: Vec2[]): boolean[] {
  const n = ring.length;
  const shape = ROOF_PRESETS[id].shape;
  if (shape === 'hip' || shape === 'flat' || n === 0) return ring.map(() => true);
  const lens = ring.map((p, i) => len(p, ring[(i + 1) % n]!));
  let best = 0;
  lens.forEach((l, i) => {
    if (l > lens[best]!) best = i;
  });
  if (shape === 'shed') return lens.map((_, i) => i === best);
  const d = (i: number): Vec2 => {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    return { x: b.x - a.x, y: b.y - a.y };
  };
  const ref = d(best);
  return lens.map((l, i) => {
    if (i === best) return true;
    if (l === 0) return false;
    const v = d(i);
    const cos = Math.abs(ref.x * v.x + ref.y * v.y) / (lens[best]! * l);
    return cos >= Math.cos(GABLE_ANGLE) - 1e-9;
  });
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
