import { describe, expect, it } from 'vitest';
import { Box3, type BufferGeometry } from 'three';
import { roofGeometry, type RoofBody } from '../../src/core/roofs/geometry';
import type { Floor, Roof } from '../../src/core';
import {
  MaterialLibrary,
  buildPostsGeometry,
  buildRoofFrame,
  buildRoofGeometry,
} from '../../src/three';
import { irregularFixtures } from '../fixtures/irregular';
import { gableWallEdges, roofRoom, testRoof } from './helpers';

function body(r: Roof, f: Floor): RoofBody {
  const g = roofGeometry(r, f);
  expect(g.bodies).toHaveLength(1);
  return g.bodies[0]!;
}

function box(g: BufferGeometry): Box3 {
  g.computeBoundingBox();
  return g.boundingBox!;
}

const triangles = (g: BufferGeometry): number => g.getAttribute('position').count / 3;

const shed = (p: Partial<Roof> = {}): Roof =>
  testRoof({
    follow: false,
    rooms: undefined,
    points: [
      { x: 10, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 3 },
      { x: 10, y: 3 },
    ],
    edges: [{ kind: 'slope', pitch: 10 }, { kind: 'gable' }, { kind: 'gable' }, { kind: 'gable' }],
    pitch: 10,
    thickness: 0.02,
    material: 'glass',
    ...p,
  });

describe('buildRoofGeometry', () => {
  it('hip roof on a 4x4 room: underside at the wall tops, top raised by t / cos(pitch)', () => {
    const r = testRoof();
    const g = buildRoofGeometry(body(r, roofRoom()), r);
    const b = box(g);
    expect(b.min.y).toBeCloseTo(3, 5);
    expect(b.max.y).toBeCloseTo(3 + 2.1 + 0.1 / Math.cos(Math.PI / 4), 5);
    expect(b.min.x).toBeCloseTo(-0.1, 5);
    expect(b.max.x).toBeCloseTo(4.1, 5);
    expect(b.min.z).toBeCloseTo(-4.1, 5);
    expect(b.max.z).toBeCloseTo(0.1, 5);
  });

  it('overhang hangs the eaves below the wall tops', () => {
    const r = testRoof({ overhang: 0.5 });
    const b = box(buildRoofGeometry(body(r, roofRoom()), r));
    expect(b.min.y).toBeCloseTo(3 - 0.5, 5);
    expect(b.min.x).toBeCloseTo(-0.6, 5);
  });

  it('normals agree with the winding', () => {
    const r = testRoof({ overhang: 0.3 });
    const g = buildRoofGeometry(body(r, roofRoom()), r);
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i += 3) {
      const [ax, ay, az] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      const ux = pos.getX(i + 1) - ax;
      const uy = pos.getY(i + 1) - ay;
      const uz = pos.getZ(i + 1) - az;
      const vx = pos.getX(i + 2) - ax;
      const vy = pos.getY(i + 2) - ay;
      const vz = pos.getZ(i + 2) - az;
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const d = n[0]! * nrm.getX(i) + n[1]! * nrm.getY(i) + n[2]! * nrm.getZ(i);
      expect(d).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('gable roof leaves the gable triangle to the wall (no vertical gable face in the mesh)', () => {
    const f = roofRoom(6, 4);
    const r = testRoof({ wallEdges: gableWallEdges(f) });
    const g = buildRoofGeometry(body(r, f), r);
    const b = box(g);
    expect(b.max.y).toBeCloseTo(5.1 + 0.1 / Math.cos(Math.PI / 4), 5);
    // the gable face would span the whole height below the ridge at x = -0.1
    const pos = g.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) + 0.1) < 1e-6) {
        expect(pos.getY(i)).toBeGreaterThan(3 - 1e-6);
      }
    }
    let lowAtEnd = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getX(i) + 0.1) < 1e-6 && pos.getY(i) < 4) lowAtEnd++;
    }
    // only the thin fascia along the rake reaches low at the gable end, near the eaves
    expect(lowAtEnd).toBeGreaterThan(0);
  });

  it('flat roof: slab plus parapet boxes', () => {
    const r = testRoof({ kind: 'flat', parapet: 1.1, thickness: 0.12 });
    const b = box(buildRoofGeometry(body(r, roofRoom()), r));
    expect(b.min.y).toBeCloseTo(3, 5);
    expect(b.max.y).toBeCloseTo(3 + 0.12 + 1.1, 5);
    expect(b.min.x).toBeCloseTo(-0.1, 5);
  });

  it('a failed roof renders the flat fallback without throwing', () => {
    const r = shed({
      material: 'tile',
      edges: [{ kind: 'gable' }, { kind: 'gable' }, { kind: 'gable' }, { kind: 'gable' }],
    });
    const geo = roofGeometry(r, roofRoom());
    expect(geo.ok).toBe(false);
    let g!: BufferGeometry;
    expect(() => (g = buildRoofGeometry(geo.bodies[0]!, r))).not.toThrow();
    const b = box(g);
    expect(b.min.y).toBeCloseTo(3, 5);
    expect(b.max.y).toBeCloseTo(3.02, 5);
  });
});

/** Enclosed volume by the divergence theorem (outward winding). */
function meshVolume(g: BufferGeometry): number {
  const p = g.getAttribute('position');
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    const [ax, ay, az] = [p.getX(i), p.getY(i), p.getZ(i)];
    const [bx, by, bz] = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    const [cx, cy, cz] = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

/** Sum over non-vertical faces of plan area x thickness / cos(pitch). */
function expectedVolume(b: RoofBody, t: number): number {
  let v = 0;
  for (const f of b.faces) {
    const q = f.polygon;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    q.forEach((a, i) => {
      const c = q[(i + 1) % q.length]!;
      nx += (a.y - c.y) * (a.z + c.z);
      ny += (a.z - c.z) * (a.x + c.x);
      nz += (a.x - c.x) * (a.y + c.y);
    });
    const area = Math.abs(nz) / 2;
    if (area < 1e-9) continue;
    v += area * (t / (Math.abs(nz) / Math.hypot(nx, ny, nz)));
  }
  return v;
}

describe('buildRoofGeometry: closed solids', () => {
  const cases: [string, Floor, Roof][] = [
    ['hip with overhang', roofRoom(), testRoof({ overhang: 0.5 })],
    [
      'gable with rakes',
      roofRoom(6, 4),
      testRoof({ wallEdges: gableWallEdges(roofRoom(6, 4)), overhang: 0.5, gableOverhang: 0.3 }),
    ],
    ['mansard', roofRoom(8, 6), testRoof({ pitch: 70, breakHeight: 1.5, upperPitch: 30 })],
    ['flat with overhang', roofRoom(), testRoof({ kind: 'flat', overhang: 0.3 })],
    ...Object.entries(irregularFixtures).map(([name, make]): [string, Floor, Roof] => {
      const f = make();
      return [name, f, testRoof({ rooms: Object.keys(f.rooms), pitch: 30, overhang: 0.4 })];
    }),
  ];
  it.each(cases)('%s encloses its faces extruded by t / cos(pitch)', (_, f, r) => {
    const geo = roofGeometry(r, f);
    for (const b of geo.bodies) {
      const g = buildRoofGeometry(b, r);
      const want = expectedVolume(b, r.thickness);
      expect(Math.abs(meshVolume(g) - want)).toBeLessThan(want * 1e-4 + 1e-5);
    }
  });
});

describe('buildRoofFrame / buildPostsGeometry', () => {
  it('glass shed gets frame bars along the slope every metre', () => {
    const r = shed();
    const b = body(r, roofRoom());
    const frame = buildRoofFrame(b, r.thickness);
    expect(frame).not.toBeNull();
    // 4 m along the eaves: bars at about 1 m spacing (3 to 5 bars), 12 triangles each
    const bars = triangles(frame!) / 12;
    expect(bars).toBeGreaterThanOrEqual(3);
    expect(bars).toBeLessThanOrEqual(5);
    const fb = box(frame!);
    const rb = box(buildRoofGeometry(b, r));
    // bars sit on the top surface
    expect(fb.max.y).toBeGreaterThan(rb.max.y);
    expect(fb.max.y).toBeLessThan(rb.max.y + 0.05);
  });

  it('flat bodies have no frame', () => {
    const r = testRoof({ kind: 'flat', material: 'glass' });
    expect(buildRoofFrame(body(r, roofRoom()))).toBeNull();
  });

  it('posts: one box per post from the floor to the roof underside', () => {
    const r = shed({ supports: 'posts' });
    const b = body(r, roofRoom());
    expect(b.posts.length).toBeGreaterThanOrEqual(4);
    const g = buildPostsGeometry(b, 0.1)!;
    expect(g).not.toBeNull();
    expect(triangles(g)).toBe(b.posts.length * 12);
    const bb = box(g);
    expect(bb.min.y).toBeCloseTo(0, 5);
    expect(bb.min.x).toBeCloseTo(10 - 0.05, 5);
  });

  it('no posts: null', () => {
    const r = shed();
    expect(buildPostsGeometry(body(r, roofRoom()), 0.1)).toBeNull();
  });
});

describe('roof materials', () => {
  it('opaque and translucent roof materials', () => {
    const lib = new MaterialLibrary();
    expect(lib.roof('tile').name).toBe('roof-tile');
    expect(lib.roof('tile').transparent).toBe(false);
    expect(lib.roof('metal').name).toBe('roof-metal');
    expect(lib.roof('concrete').name).toBe('roof-concrete');
    const glass = lib.roof('glass');
    expect(glass.name).toBe('roof-glass');
    expect(glass.transparent).toBe(true);
    expect(glass.opacity).toBeCloseTo(0.35);
    expect(glass.depthWrite).toBe(false);
    const poly = lib.roof('polycarbonate');
    expect(poly.transparent).toBe(true);
    expect(poly.opacity).toBeCloseTo(0.5);
    expect(poly.depthWrite).toBe(false);
    expect(lib.roof('glass')).toBe(glass);
  });
});
