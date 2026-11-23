import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import type { Floor, Opening, OpeningGeometry, OpeningPiece, Vec2 } from '../core';
import { toWorld } from './coords';
import { TriangleSink } from './triangulate';

/** The meshes of one opening, each optional but the pick. */
export interface OpeningParts {
  /** Frame members, mullions and the box of a rolling door. */
  frame?: BufferGeometry;
  /** Door leaves, sash members and shutters. */
  leaf?: BufferGeometry;
  glass?: BufferGeometry;
  /** A box filling the cut, for an invisible material: what a ray hits to pick the opening. */
  pick: BufferGeometry;
}

const EPS = 1e-9;

const PART_OF: Record<OpeningPiece['role'], 'frame' | 'leaf' | 'glass' | null> = {
  frame: 'frame',
  box: 'frame',
  leaf: 'leaf',
  shutter: 'leaf',
  glass: 'glass',
  // Drafting lines only; the shut pose has none.
  track: null,
  face: null,
};

/**
 * The 3D parts of an opening from its geometry, shut, at the floor elevation. Every piece of
 * `g.closed` becomes a box; `opening` and an empty cut give only the pick.
 */
export function buildOpeningParts(
  floor: Readonly<Floor>,
  _opening: Opening,
  g: OpeningGeometry,
): OpeningParts {
  const sinks = { frame: new TriangleSink(), leaf: new TriangleSink(), glass: new TriangleSink() };
  const y = floor.elevation;
  for (const piece of g.closed) {
    const part = PART_OF[piece.role];
    if (!part) continue;
    const ring = pieceRing(piece);
    if (ring) box(sinks[part], ring, y + piece.z0, y + piece.z1);
  }
  const pick = new TriangleSink();
  box(pick, g.cut, y + g.z0, y + g.z1, true);

  const out: OpeningParts = { pick: toGeometry(pick) };
  for (const part of ['frame', 'leaf', 'glass'] as const) {
    if (sinks[part].vertexCount > 0) out[part] = toGeometry(sinks[part]);
  }
  return out;
}

/** The plan rectangle of a solid piece; null when it has no area or no height. */
function pieceRing(p: OpeningPiece): Vec2[] | null {
  const dx = p.b.x - p.a.x;
  const dy = p.b.y - p.a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > EPS && p.depth > EPS && p.z1 - p.z0 > EPS)) return null;
  const nx = (-dy / len) * (p.depth / 2);
  const ny = (dx / len) * (p.depth / 2);
  return [
    { x: p.a.x - nx, y: p.a.y - ny },
    { x: p.b.x - nx, y: p.b.y - ny },
    { x: p.b.x + nx, y: p.b.y + ny },
    { x: p.a.x + nx, y: p.a.y + ny },
  ];
}

/**
 * A prism over a plan quad between two world heights: 12 triangles wound outward. `always`
 * emits it even when flat (the pick of an empty cut stays a valid, if empty, target).
 */
function box(sink: TriangleSink, quad: Vec2[], y0: number, y1: number, always = false): void {
  let area = 0;
  quad.forEach((a, i) => {
    const b = quad[(i + 1) % quad.length]!;
    area += a.x * b.y - b.x * a.y;
  });
  if (!always && !(Math.abs(area) > EPS * EPS)) return;
  const ring = area < 0 ? [...quad].reverse() : quad;
  const bot = ring.map((p) => toWorld(p, y0));
  const top = ring.map((p) => toWorld(p, y1));
  const [b0, b1, b2, b3] = bot as [Vector3, Vector3, Vector3, Vector3];
  const [t0, t1, t2, t3] = top as [Vector3, Vector3, Vector3, Vector3];
  sink.quad(t0, t1, t2, t3, new Vector3(0, 1, 0));
  sink.quad(b0, b1, b2, b3, new Vector3(0, -1, 0));
  ring.forEach((a, i) => {
    const j = (i + 1) % ring.length;
    const b = ring[j]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // The right of a→b in a counter-clockwise plan ring, in world axes (x, 0, -y).
    const out = new Vector3((b.y - a.y) / len, 0, (b.x - a.x) / len);
    sink.quad(bot[i]!, bot[j]!, top[j]!, top[i]!, out);
  });
}

function toGeometry(sink: TriangleSink): BufferGeometry {
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}
