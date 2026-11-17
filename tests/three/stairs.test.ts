import { Box3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  addFloor,
  addStair,
  H3xDocument,
  layoutStair,
  removeStair,
  setFloorHeight,
  stairRise,
  type Floor,
  type Project,
  type Stair,
  type Vec2,
} from '../../src/core';
import {
  buildFloorGeometry,
  buildHandrailGeometry,
  buildSlabGeometry,
  buildStairGeometry,
  H3xScene,
} from '../../src/three';
import { handrailPath } from '../../src/three/stairs';
import { twoRoomFloor } from '../fixtures/floors';

/** One 8 x 6 room (walls 0.2 thick), ground floor. */
function bigRoomFloor(): Floor {
  const f = twoRoomFloor();
  f.nodes = {
    n1: { id: 'n1', x: 0, y: 0 },
    n2: { id: 'n2', x: 8, y: 0 },
    n3: { id: 'n3', x: 8, y: 6 },
    n4: { id: 'n4', x: 0, y: 6 },
  };
  const wall = (id: string, a: string, b: string) => ({ id, a, b, thickness: 0.2, height: 3.2 });
  f.walls = {
    w1: wall('w1', 'n1', 'n2'),
    w2: wall('w2', 'n2', 'n3'),
    w3: wall('w3', 'n3', 'n4'),
    w4: wall('w4', 'n4', 'n1'),
  };
  f.rooms = { r1: { id: 'r1', walls: ['w1', 'w2', 'w3', 'w4'], name: '' } };
  return f;
}

/** Two-storey document; the ground floor `f1` is active, the copied upper floor is returned too. */
function twoStorey(ground: Floor = bigRoomFloor()): { doc: H3xDocument; upper: Floor } {
  const project = { name: 'p', floors: [ground] } as unknown as Project;
  const doc = H3xDocument.fromProject(project);
  doc.execute(addFloor({ position: 'above' }));
  return { doc, upper: doc.floorAbove('f1') as Floor };
}

const STRAIGHT = { x: 4, y: 3, width: 1, depth: 5, type: 'straight' as const, flightWidth: 1 };

/** Is there a horizontal triangle of `geom` over plan point (x, y)? */
function hasTriangleAt(geom: BufferGeometry, x: number, y: number): boolean {
  const pos = geom.getAttribute('position');
  const px = x;
  const pz = -y;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i);
    const az = pos.getZ(i);
    const bx = pos.getX(i + 1);
    const bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2);
    const cz = pos.getZ(i + 2);
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-12) continue;
    const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d;
    const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return true;
  }
  return false;
}

function allFinite(geom: BufferGeometry): boolean {
  const arr = geom.getAttribute('position').array as ArrayLike<number>;
  for (let i = 0; i < arr.length; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}

/** Every directed edge has its reverse (closed, consistently wound triangle soup). */
function isClosed(geom: BufferGeometry): boolean {
  const pos = geom.getAttribute('position');
  const key = (i: number) =>
    [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1e4)).join(',');
  const edges = new Map<string, number>();
  for (let i = 0; i < pos.count; i += 3) {
    const k = [key(i), key(i + 1), key(i + 2)];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
    for (let j = 0; j < 3; j++) {
      const e = k[j] + '>' + k[(j + 1) % 3];
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const [e, n] of edges) {
    const [a, b] = e.split('>');
    if ((edges.get(b + '>' + a) ?? 0) !== n) return false;
  }
  return true;
}

/** Signed volume of a closed triangle soup (positive when normals face outward). */
function volume(geom: BufferGeometry): number {
  const p = geom.getAttribute('position');
  let v = 0;
  for (let i = 0; i < p.count; i += 3) {
    const [ax, ay, az] = [p.getX(i), p.getY(i), p.getZ(i)];
    const [bx, by, bz] = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)];
    const [cx, cy, cz] = [p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)];
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

function okLayout(stair: Stair, floor: Floor, above: Floor) {
  const l = layoutStair(stair, stairRise(floor, above));
  if (!l.ok) throw new Error('layout not ok: ' + l.reason);
  return l;
}

const stair = (s: Partial<Stair>): Stair => ({
  id: 's',
  x: 4,
  y: 3,
  width: 1,
  depth: 5,
  rotation: 0,
  type: 'straight',
  turn: 'landing',
  hand: 'right',
  flightWidth: 1,
  ...s,
});

describe('buildStairGeometry', () => {
  it('spans floor to the top tread and stays inside the bay', () => {
    const { doc, upper } = twoStorey();
    const floor = doc.floorById('f1') as Floor;
    const l = okLayout(stair({}), floor, upper);
    const g = buildStairGeometry(l, floor);
    const box = new Box3().setFromBufferAttribute(g.getAttribute('position') as never);
    expect(box.min.y).toBeCloseTo(floor.elevation, 6);
    expect(box.max.y).toBeCloseTo(floor.elevation + (l.risers - 1) * l.riserHeight, 6);
    expect(box.min.x).toBeGreaterThanOrEqual(3.5 - 1e-6);
    expect(box.max.x).toBeLessThanOrEqual(4.5 + 1e-6);
    expect(box.min.z).toBeGreaterThanOrEqual(-5.5 - 1e-6);
    expect(box.max.z).toBeLessThanOrEqual(-0.5 + 1e-6);
    expect(isClosed(g)).toBe(true);
    expect(volume(g)).toBeGreaterThan(0);
  });

  const variants: [string, Partial<Stair>][] = [
    ['straight left', { hand: 'left', flightWidth: 0.9 }],
    ['L landing', { type: 'L', width: 3, depth: 3.5, flightWidth: 0.9 }],
    ['L winder', { type: 'L', turn: 'winder', width: 3, depth: 3.5, flightWidth: 0.9 }],
    ['U landing', { type: 'U', width: 2, depth: 3.5, flightWidth: 0.9 }],
    ['U winder left', { type: 'U', turn: 'winder', hand: 'left', width: 2, depth: 3 }],
    ['spiral', { type: 'spiral', width: 2.2, depth: 2.2, rotation: 0.3 }],
  ];
  for (const [name, s] of variants) {
    it(`${name}: closed, outward, finite, with a handrail`, () => {
      const { doc, upper } = twoStorey();
      const floor = doc.floorById('f1') as Floor;
      const st = stair({ flightWidth: s.type === 'U' ? 0.9 : 1, ...s });
      const l = okLayout(st, floor, upper);
      const g = buildStairGeometry(l, floor);
      expect(allFinite(g)).toBe(true);
      expect(isClosed(g)).toBe(true);
      expect(volume(g)).toBeGreaterThan(0);
      const rail = buildHandrailGeometry(l, floor)!;
      expect(rail).not.toBeNull();
      expect(allFinite(rail)).toBe(true);
      const box = new Box3().setFromBufferAttribute(rail.getAttribute('position') as never);
      const rise = stairRise(floor, upper);
      expect(box.max.y).toBeGreaterThan(floor.elevation + rise + 0.8);
      expect(box.max.y).toBeLessThan(floor.elevation + rise + 1.0);
      expect(box.min.y).toBeGreaterThan(floor.elevation + 0.8);
    });
  }
});

describe('buildHandrailGeometry', () => {
  it.each([
    ['spiral', 'landing', 2.0, 2.0, 3.3],
    ['spiral', 'landing', 1.8, 1.8, 3.6],
    ['straight', 'landing', 1.2, 5, 3.3],
    ['L', 'landing', 3.5, 5, 3.3],
    ['L', 'winder', 2.6, 3.4, 3.3],
    ['U', 'landing', 2.2, 4.5, 3.3],
    ['U', 'winder', 2.2, 3.6, 3.6],
  ] as const)('%s %s %s x %s at rise %s: rail heights never drop', (type, turn, w, d, rise) => {
    const s: Stair = {
      id: 's',
      x: 0,
      y: 0,
      width: w,
      depth: d,
      rotation: 0,
      type,
      turn,
      hand: 'right',
      flightWidth: 0.9,
    };
    const l = layoutStair(s, rise);
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    const pts = handrailPath(l, { elevation: 0 } as Floor)!;
    expect(pts.length).toBeGreaterThan(1);
    for (let i = 1; i < pts.length; i++)
      expect(pts[i]!.y).toBeGreaterThanOrEqual(pts[i - 1]!.y - 1e-9);
    expect(pts[pts.length - 1]!.y - pts[0]!.y).toBeGreaterThan(rise - 2 * l.riserHeight);
  });

  it('runs along the well side of a U stair', () => {
    const { doc, upper } = twoStorey();
    const floor = doc.floorById('f1') as Floor;
    const l = okLayout(stair({ type: 'U', width: 2, depth: 3.5, flightWidth: 0.9 }), floor, upper);
    const rail = buildHandrailGeometry(l, floor)!;
    const box = new Box3().setFromBufferAttribute(rail.getAttribute('position') as never);
    // flights at x 3..3.9 and 4.1..5: the rail stays 0.05 m inside the well edges
    expect(box.min.x).toBeGreaterThan(3.8);
    expect(box.max.x).toBeLessThan(4.2);
  });
});

describe('slab and floor openings', () => {
  it('cuts a convex opening fully inside the slab and the room floor', () => {
    const f = { ...bigRoomFloor(), elevation: 3.35 };
    const bay: Vec2[] = [
      { x: 3.5, y: 0.5 },
      { x: 4.5, y: 0.5 },
      { x: 4.5, y: 5.5 },
      { x: 3.5, y: 5.5 },
    ];
    const slab = buildSlabGeometry(f, [bay])!;
    expect(hasTriangleAt(slab, 4, 3)).toBe(false);
    expect(hasTriangleAt(slab, 5, 3)).toBe(true);
    // watertight with outward normals: (outline - opening) x thickness
    expect(volume(slab)).toBeCloseTo((8.2 * 6.2 - 5) * 0.15, 4);
    const room = buildFloorGeometry(f, f.rooms.r1!, [bay])!;
    expect(hasTriangleAt(room, 4, 3)).toBe(false);
    expect(hasTriangleAt(room, 3, 3)).toBe(true);
  });

  it('clips an opening crossing the outline without NaN (slab stays watertight)', () => {
    const f = bigRoomFloor();
    const bay: Vec2[] = [
      { x: 7, y: 2 },
      { x: 9, y: 2 },
      { x: 9, y: 4 },
      { x: 7, y: 4 },
    ];
    const slab = buildSlabGeometry(f, [bay])!;
    expect(allFinite(slab)).toBe(true);
    expect(hasTriangleAt(slab, 7.5, 3)).toBe(false);
    expect(hasTriangleAt(slab, 6.5, 3)).toBe(true);
    // the opening reaches 1.1 m into the slab (outline at x = 8.1)
    expect(volume(slab)).toBeCloseTo((8.2 * 6.2 - 1.1 * 2) * 0.15, 4);
  });
});

describe('H3xScene stairs', () => {
  it('builds a stair mesh and a hole in the floor above', () => {
    const { doc, upper } = twoStorey();
    const cmd = addStair(STRAIGHT);
    doc.execute(cmd);
    const scene = new H3xScene(doc);
    const mesh = scene.getStairMesh(cmd.createdId, 'f1')!;
    expect(mesh).toBeDefined();
    expect(mesh.userData).toEqual({ h3xKind: 'stair', h3xId: cmd.createdId, h3xFloorId: 'f1' });
    const slab = scene.getSlabMesh(upper.id)!.geometry;
    expect(hasTriangleAt(slab, 4, 3)).toBe(false);
    expect(hasTriangleAt(slab, 5, 3)).toBe(true);
    const room = Object.keys(upper.rooms)[0]!;
    expect(hasTriangleAt(scene.getFloorMesh(room, upper.id)!.geometry, 4, 3)).toBe(false);
    // the ground floor itself is not cut
    expect(hasTriangleAt(scene.getSlabMesh('f1')!.geometry, 4, 3)).toBe(true);
  });

  it('the hole follows a rotated bay (rotation π/6)', () => {
    const { doc, upper } = twoStorey();
    doc.execute(addStair({ ...STRAIGHT, rotation: Math.PI / 6 }));
    const scene = new H3xScene(doc);
    const slab = scene.getSlabMesh(upper.id)!.geometry;
    expect(hasTriangleAt(slab, 3, 4.73)).toBe(false); // inside the rotated bay only
    expect(hasTriangleAt(slab, 4.4, 0.7)).toBe(true); // inside the unrotated bay only
  });

  it('a bay straddling a room boundary cuts slab and both rooms without NaN; no stair mesh when it does not fit', () => {
    const { doc, upper } = twoStorey(twoRoomFloor());
    const cmd = addStair({ x: 4, y: 2, width: 1.2, depth: 3.6, type: 'straight', flightWidth: 1 });
    let scene!: H3xScene;
    doc.execute(cmd);
    expect(() => (scene = new H3xScene(doc))).not.toThrow();
    expect(scene.getStairMesh(cmd.createdId, 'f1')).toBeUndefined();
    const slab = scene.getSlabMesh(upper.id)!.geometry;
    expect(allFinite(slab)).toBe(true);
    expect(hasTriangleAt(slab, 4, 2)).toBe(false);
    expect(hasTriangleAt(slab, 2, 2)).toBe(true);
    const rooms = Object.keys(upper.rooms);
    expect(rooms).toHaveLength(2);
    for (const r of rooms) {
      const g = scene.getFloorMesh(r, upper.id)!.geometry;
      expect(allFinite(g)).toBe(true);
      expect(hasTriangleAt(g, 3.7, 2) || hasTriangleAt(g, 4.3, 2)).toBe(false);
    }
  });

  it('removeStair then undo brings the hole and the stair mesh back', () => {
    const { doc, upper } = twoStorey();
    const cmd = addStair(STRAIGHT);
    doc.execute(cmd);
    const scene = new H3xScene(doc);
    doc.execute(removeStair(cmd.createdId));
    expect(scene.getStairMesh(cmd.createdId, 'f1')).toBeUndefined();
    expect(hasTriangleAt(scene.getSlabMesh(upper.id)!.geometry, 4, 3)).toBe(true);
    doc.undo();
    expect(scene.getStairMesh(cmd.createdId, 'f1')).toBeDefined();
    expect(hasTriangleAt(scene.getSlabMesh(upper.id)!.geometry, 4, 3)).toBe(false);
  });

  it('adding a stair rebuilds the floor above (hole appears)', () => {
    const { doc, upper } = twoStorey();
    const scene = new H3xScene(doc);
    expect(hasTriangleAt(scene.getSlabMesh(upper.id)!.geometry, 4, 3)).toBe(true);
    doc.execute(addStair(STRAIGHT));
    expect(hasTriangleAt(scene.getSlabMesh(upper.id)!.geometry, 4, 3)).toBe(false);
  });

  it('setFloorHeight on the stair floor rebuilds the stair', () => {
    const { doc } = twoStorey();
    const cmd = addStair(STRAIGHT);
    doc.execute(cmd);
    const scene = new H3xScene(doc);
    const mesh = scene.getStairMesh(cmd.createdId, 'f1')!;
    const old = mesh.geometry;
    doc.execute(setFloorHeight('f1', 3.0));
    const now = scene.getStairMesh(cmd.createdId, 'f1')!;
    expect(now.geometry).not.toBe(old);
    const box = new Box3().setFromObject(now);
    const l = okLayout(
      doc.floorById('f1')!.stairs[cmd.createdId]!,
      doc.floorById('f1') as Floor,
      doc.floorAbove('f1') as Floor,
    );
    expect(box.max.y).toBeCloseTo((l.risers - 1) * l.riserHeight, 5);
  });

  it('adding / removing the floor above draws / drops the stair (neighbour change)', () => {
    const project = { name: 'p', floors: [bigRoomFloor()] } as unknown as Project;
    const doc = H3xDocument.fromProject(project);
    const cmd = addStair(STRAIGHT);
    doc.execute(cmd);
    const scene = new H3xScene(doc);
    expect(scene.getStairMesh(cmd.createdId, 'f1')).toBeUndefined();
    doc.execute(addFloor({ position: 'above' }));
    expect(scene.getStairMesh(cmd.createdId, 'f1')).toBeDefined();
    doc.undo();
    expect(scene.getStairMesh(cmd.createdId, 'f1')).toBeUndefined();
  });

  it('a stair on the top floor draws no stair mesh', () => {
    const project = { name: 'p', floors: [bigRoomFloor()] } as unknown as Project;
    const doc = H3xDocument.fromProject(project);
    const cmd = addStair(STRAIGHT);
    doc.execute(cmd);
    const scene = new H3xScene(doc);
    expect(scene.getStairMesh(cmd.createdId)).toBeUndefined();
  });
});
