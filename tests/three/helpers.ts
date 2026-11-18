import { Vector3, type BufferGeometry } from 'three';
import type { Floor, Roof } from '../../src/core';
import { floorOutline } from '../../src/core/floors/outline';
import { presetWallEdges } from '../../src/core/roofs/presets';
import { oneRoomFloor } from '../fixtures/floors';

function groupRange(geom: BufferGeometry, groupIndex: number): { start: number; count: number } {
  const g = geom.groups.find((x) => x.materialIndex === groupIndex);
  if (!g) throw new Error(`no group ${groupIndex}`);
  return { start: g.start, count: g.count };
}

function vertexIndex(geom: BufferGeometry, i: number): number {
  return geom.index ? geom.index.getX(i) : i;
}

/** Total triangle area of the given material group. */
export function groupArea(geom: BufferGeometry, groupIndex: number): number {
  const pos = geom.getAttribute('position');
  const { start, count } = groupRange(geom, groupIndex);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let area = 0;
  for (let i = start; i < start + count; i += 3) {
    a.fromBufferAttribute(pos, vertexIndex(geom, i));
    b.fromBufferAttribute(pos, vertexIndex(geom, i + 1));
    c.fromBufferAttribute(pos, vertexIndex(geom, i + 2));
    area += new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
  }
  return area;
}

/** Vertex normals of the given material group. */
export function groupNormals(geom: BufferGeometry, groupIndex: number): Vector3[] {
  const nrm = geom.getAttribute('normal');
  const { start, count } = groupRange(geom, groupIndex);
  const out: Vector3[] = [];
  for (let i = start; i < start + count; i++) {
    out.push(new Vector3().fromBufferAttribute(nrm, vertexIndex(geom, i)));
  }
  return out;
}

/** Geometric (winding) normals of each triangle in the given material group. */
export function groupFaceNormals(geom: BufferGeometry, groupIndex: number): Vector3[] {
  const pos = geom.getAttribute('position');
  const { start, count } = groupRange(geom, groupIndex);
  const out: Vector3[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = start; i < start + count; i += 3) {
    a.fromBufferAttribute(pos, vertexIndex(geom, i));
    b.fromBufferAttribute(pos, vertexIndex(geom, i + 1));
    c.fromBufferAttribute(pos, vertexIndex(geom, i + 2));
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.lengthSq() > 1e-18) out.push(n.normalize());
  }
  return out;
}

/** oneRoomFloor resized to w x d (centre lines), storey and walls 3 m high, no openings. */
export function roofRoom(w = 4, d = 4): Floor {
  const f = oneRoomFloor();
  f.wallHeight = 3;
  f.openings = {};
  for (const wall of Object.values(f.walls)) wall.height = 3;
  f.nodes.n2 = { id: 'n2', x: w, y: 0 };
  f.nodes.n3 = { id: 'n3', x: w, y: d };
  f.nodes.n4 = { id: 'n4', x: 0, y: d };
  return f;
}

/** A follow roof over room r1: hip at 45 degrees, no overhang, 0.1 thick, tile. */
export function testRoof(p: Partial<Roof> = {}): Roof {
  return {
    id: 'R1',
    kind: 'pitched',
    follow: true,
    rooms: ['r1'],
    pitch: 45,
    base: 0,
    overhang: 0,
    gableOverhang: 0,
    thickness: 0.1,
    material: 'tile',
    ...p,
  };
}

/** The gable preset's gable walls of room r1 (slope walls keep the roof pitch). */
export function gableWallEdges(f: Floor): Roof['wallEdges'] {
  const ring = floorOutline(f, ['r1'])[0]!;
  return Object.fromEntries(
    Object.entries(presetWallEdges('gable', ring)).filter(([, e]) => e.kind === 'gable'),
  );
}
