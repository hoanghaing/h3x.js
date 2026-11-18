import { describe, expect, it } from 'vitest';
import {
  gableProfile,
  roofFaceArea,
  roofGeometry,
  type RoofBody,
  type RoofFace,
} from '../../src/core/roofs/geometry';
import { presetEdges, presetWallEdges } from '../../src/core/roofs/presets';
import { floorOutline } from '../../src/core/floors/outline';
import { closestPointOnSegment } from '../../src/core/geometry/segment';
import { signedArea } from '../../src/core/geometry/polygon';
import { MITER_LIMIT } from '../../src/core/constants';
import { oneRoomFloor } from '../fixtures/floors';
import { acuteFloor, courtyardFloor, irregularFixtures, lFloor } from '../fixtures/irregular';
import type { Floor, Roof, Vec2 } from '../../src/core/types';

/** oneRoomFloor resized to w x d (centre lines), wall height 3, no openings. */
function room(w = 4, d = 4): Floor {
  const f = oneRoomFloor();
  f.wallHeight = 3;
  f.openings = {};
  f.nodes.n2 = { id: 'n2', x: w, y: 0 };
  f.nodes.n3 = { id: 'n3', x: w, y: d };
  f.nodes.n4 = { id: 'n4', x: 0, y: d };
  return f;
}

function roof(p: Partial<Roof> = {}): Roof {
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

function body(r: Roof, f: Floor): RoofBody {
  const g = roofGeometry(r, f);
  expect(g.ok).toBe(true);
  expect(g.bodies).toHaveLength(1);
  return g.bodies[0]!;
}

/** The gable preset's gable walls only (slope walls keep the roof pitch). */
const gableWalls = (ring: Parameters<typeof presetWallEdges>[1]): Roof['wallEdges'] =>
  Object.fromEntries(
    Object.entries(presetWallEdges('gable', ring)).filter(([, e]) => e.kind === 'gable'),
  );

const slopes = (b: RoofBody): RoofFace[] => b.faces.filter((f) => f.slope);
const vertical = (f: RoofFace): boolean => {
  const xs = f.polygon.map((p) => ({ x: p.x, y: p.y }));
  return Math.abs(signedArea(xs)) < 1e-9;
};
const kinds = (b: RoofBody, k: string) => b.lines.filter((l) => l.kind === k);
const maxZ = (b: RoofBody): number =>
  Math.max(...b.faces.flatMap((f) => f.polygon.map((p) => p.z)));

function bbox(pts: Vec2[]): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  };
}

function distToRing(p: Vec2, ring: Vec2[]): number {
  return Math.min(
    ...ring.map((a, i) => {
      const { point } = closestPointOnSegment(p, a, ring[(i + 1) % ring.length]!);
      return Math.hypot(point.x - p.x, point.y - p.y);
    }),
  );
}

describe('roofGeometry: pitched', () => {
  it('hips a 4x4 room into a pyramid', () => {
    const b = body(roof(), room());
    expect(maxZ(b)).toBeCloseTo(3 + 2.1, 9);
    expect(slopes(b)).toHaveLength(4);
    expect(kinds(b, 'hip')).toHaveLength(4);
    expect(kinds(b, 'ridge')).toHaveLength(0);
    expect(kinds(b, 'eave')).toHaveLength(4);
    for (const f of slopes(b)) {
      expect(f.pitch).toBe(45);
      expect(f.wallId).toBeDefined();
    }
    for (const l of kinds(b, 'hip')) expect(Math.max(l.a.z, l.b.z)).toBeCloseTo(5.1, 9);
  });

  it('gables the short walls of a 6x4 room', () => {
    const f = room(6, 4);
    const ring = floorOutline(f, ['r1'])[0]!;
    const r = roof({ wallEdges: gableWalls(ring) });
    f.roofs.R1 = r;
    const b = body(r, f);
    const v = b.faces.filter((x) => !x.slope && vertical(x));
    expect(v).toHaveLength(2);
    expect(v.map((x) => x.wallId).sort()).toEqual(['w2', 'w4']);
    expect(kinds(b, 'ridge')).toHaveLength(1);
    expect(kinds(b, 'hip')).toHaveLength(0);
    expect(kinds(b, 'rake').length).toBeGreaterThanOrEqual(2);

    const prof = gableProfile(f, 'w2')!;
    expect(prof).not.toBeNull();
    const top = prof.reduce((m, p) => (p.y > m.y ? p : m));
    expect(top.y).toBeCloseTo(5.1, 9);
    expect(top.x).toBeCloseTo(2, 9);
    expect(prof[0]!.y).toBeCloseTo(3, 9);
    expect(prof[prof.length - 1]!.y).toBeCloseTo(3, 9);
    expect(gableProfile(f, 'w1')).toBeNull();
  });

  it('gableProfile is null without a roof on the floor', () => {
    expect(gableProfile(room(), 'w2')).toBeNull();
  });

  it('gableProfile matches an independent gable edge on the outer wall face', () => {
    const f = room(6, 4);
    const points = [
      { x: -0.1, y: -0.1 },
      { x: 6.1, y: -0.1 },
      { x: 6.1, y: 4.1 },
      { x: -0.1, y: 4.1 },
    ];
    f.roofs.R1 = roof({
      follow: false,
      rooms: undefined,
      points,
      edges: presetEdges('gable', points),
    });
    const prof = gableProfile(f, 'w2')!;
    // presetEdges carries the gable preset's own pitch (30 degrees).
    expect(Math.max(...prof.map((p) => p.y))).toBeCloseTo(3 + 2.1 * Math.tan(Math.PI / 6), 9);
  });

  it('extends slopes down to the overhang', () => {
    const b = body(roof({ overhang: 0.5 }), room());
    const eaves = kinds(b, 'eave');
    expect(eaves).toHaveLength(4);
    for (const l of eaves) {
      expect(l.a.z).toBeCloseTo(2.5, 9);
      expect(l.b.z).toBeCloseTo(2.5, 9);
    }
    expect(kinds(b, 'hip')).toHaveLength(4);
    const o = bbox(b.outline[0]!);
    const g = bbox(b.overhangOutline[0]!);
    expect(g.x0).toBeCloseTo(o.x0 - 0.5, 9);
    expect(g.y0).toBeCloseTo(o.y0 - 0.5, 9);
    expect(g.x1).toBeCloseTo(o.x1 + 0.5, 9);
    expect(g.y1).toBeCloseTo(o.y1 + 0.5, 9);
    // The surface still covers the whole overhang outline in plan.
    const plan = b.faces
      .filter((x) => !vertical(x))
      .reduce((s, x) => s + Math.abs(signedArea(x.polygon)), 0);
    expect(plan).toBeCloseTo(5.2 * 5.2, 6);
  });

  it('covers gable overhangs with rake strips (watertight in plan)', () => {
    const f = room(6, 4);
    const ring = floorOutline(f, ['r1'])[0]!;
    const b = body(roof({ wallEdges: gableWalls(ring), overhang: 0.5, gableOverhang: 0.3 }), f);
    const g = bbox(b.overhangOutline[0]!);
    expect(g.x1 - g.x0).toBeCloseTo(6.2 + 0.6, 9);
    expect(g.y1 - g.y0).toBeCloseTo(4.2 + 1.0, 9);
    const plan = b.faces
      .filter((x) => !vertical(x))
      .reduce((s, x) => s + Math.abs(signedArea(x.polygon)), 0);
    expect(plan).toBeCloseTo(6.8 * 5.2, 6);
    expect(kinds(b, 'ridge')).toHaveLength(1);
    const ridge = kinds(b, 'ridge')[0]!;
    expect(Math.abs(ridge.a.x - ridge.b.x)).toBeCloseTo(6.8, 9);
    for (const l of kinds(b, 'rake')) {
      expect(Math.min(Math.abs(l.a.x - g.x0), Math.abs(l.a.x - g.x1))).toBeLessThan(1e-9);
    }
  });

  it('covers the overhang outline exactly for sheds and slanted gables', () => {
    const f = room(6, 4);
    const cases: { points: Vec2[]; edges: Roof['edges'] }[] = [
      {
        points: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 4 },
          { x: 0, y: 4 },
        ],
        edges: [
          { kind: 'slope', pitch: 20 },
          { kind: 'gable' },
          { kind: 'gable' },
          { kind: 'gable' },
        ],
      },
      {
        points: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 5, y: 4 },
          { x: 1, y: 4 },
        ],
        edges: [
          { kind: 'slope', pitch: 30 },
          { kind: 'gable' },
          { kind: 'slope', pitch: 45 },
          { kind: 'gable' },
        ],
      },
    ];
    for (const c of cases) {
      const r = roof({
        follow: false,
        rooms: undefined,
        overhang: 0.5,
        gableOverhang: 0.3,
        ...c,
      });
      const b = body(r, f);
      const plan = b.faces.reduce((s, x) => s + signedArea(x.polygon), 0);
      expect(plan).toBeCloseTo(signedArea(b.overhangOutline[0]!), 6);
    }
  });

  it('sloped area is plan area / cos(pitch)', () => {
    const b = body(roof(), room());
    const sum = slopes(b).reduce((s, x) => s + roofFaceArea(x), 0);
    expect(Math.abs(sum - (4.2 * 4.2) / Math.cos(Math.PI / 4))).toBeLessThan(1e-6);
  });

  it('builds the acute fixture with a bounded overhang outline', () => {
    const f = acuteFloor();
    const r = roof({ rooms: Object.keys(f.rooms), overhang: 0.5 });
    const b = body(r, f);
    for (const p of b.overhangOutline[0]!) {
      expect(distToRing(p, b.outline[0]!)).toBeLessThanOrEqual(0.5 * MITER_LIMIT + 1e-9);
    }
  });

  it('makes the light well of courtyardFloor a hole of the roof body', () => {
    const f = courtyardFloor();
    const b = body(roof({ rooms: Object.keys(f.rooms), overhang: 0 }), f);
    expect(b.outline).toHaveLength(2);
    expect(signedArea(b.outline[1]!)).toBeLessThan(0);
    const outer = Math.abs(signedArea(b.outline[0]!));
    const hole = Math.abs(signedArea(b.outline[1]!));
    const plan = slopes(b).reduce((s, x) => s + Math.abs(signedArea(x.polygon)), 0);
    expect(plan).toBeCloseTo(outer - hole, 6);
    // Faces rise away from the well: hole edges at eaves height.
    expect(Math.min(...b.faces.flatMap((x) => x.polygon.map((p) => p.z)))).toBeCloseTo(3, 9);
    expect(kinds(b, 'valley').length).toBeGreaterThan(0);
  });

  it('valleys at the reflex corner of an L', () => {
    const f = lFloor();
    const b = body(roof({ rooms: Object.keys(f.rooms) }), f);
    expect(kinds(b, 'valley')).toHaveLength(1);
    expect(kinds(b, 'hip').length).toBeGreaterThanOrEqual(5);
  });

  it('builds every irregular fixture as a hip roof', () => {
    for (const [name, make] of Object.entries(irregularFixtures)) {
      const f = make();
      const g = roofGeometry(roof({ rooms: Object.keys(f.rooms), overhang: 0.5 }), f);
      expect(g.ok, name).toBe(true);
      expect(g.bodies.length, name).toBeGreaterThan(0);
    }
  });

  it('breaks a mansard slope into lower and upper pitches', () => {
    const b = body(roof({ pitch: 70, breakHeight: 1.5, upperPitch: 30 }), room(8, 8));
    const pitches = new Set(slopes(b).map((x) => x.pitch));
    expect(pitches).toEqual(new Set([70, 30]));
  });

  it('honours base and floor elevation', () => {
    const f = room();
    f.elevation = 3.5;
    const b = body(roof({ base: 0.2 }), f);
    expect(Math.min(...b.faces.flatMap((x) => x.polygon.map((p) => p.z)))).toBeCloseTo(6.7, 9);
    expect(maxZ(b)).toBeCloseTo(6.7 + 2.1, 9);
  });

  it('one body per disjoint loop of a follow roof', () => {
    const f = room();
    for (const n of Object.values(structuredClone(f.nodes))) {
      f.nodes[`b${n.id}`] = { id: `b${n.id}`, x: n.x + 10, y: n.y };
    }
    for (const w of Object.values(structuredClone(f.walls))) {
      f.walls[`b${w.id}`] = { ...w, id: `b${w.id}`, a: `b${w.a}`, b: `b${w.b}` };
    }
    f.rooms.rb = { id: 'rb', name: '', walls: ['bw1', 'bw2', 'bw3', 'bw4'] };
    const g = roofGeometry(roof({ rooms: ['r1', 'rb'] }), f);
    expect(g.ok).toBe(true);
    expect(g.bodies).toHaveLength(2);
  });

  it('two roofs on one floor do not affect each other', () => {
    const f = room();
    const a = roof();
    const alone = roofGeometry(a, f);
    f.roofs.R2 = roof({
      id: 'R2',
      follow: false,
      rooms: undefined,
      points: [
        { x: 6, y: 0 },
        { x: 9, y: 0 },
        { x: 9, y: 4 },
        { x: 6, y: 4 },
      ],
      edges: presetEdges('hip', [
        { x: 6, y: 0 },
        { x: 9, y: 0 },
        { x: 9, y: 4 },
        { x: 6, y: 4 },
      ]),
    });
    f.roofs.R1 = a;
    expect(roofGeometry(a, f)).toEqual(alone);
  });
});

describe('roofGeometry: flat and posts', () => {
  it('flat roof with a parapet', () => {
    const b = body(roof({ kind: 'flat', parapet: 1.1, thickness: 0.12 }), room());
    expect(b.faces).toHaveLength(1);
    expect(b.faces[0]!.slope).toBe(false);
    for (const p of b.faces[0]!.polygon) expect(p.z).toBeCloseTo(3, 9);
    expect(b.parapets).toHaveLength(4);
    for (const p of b.parapets) {
      expect(p.bottom).toBeCloseTo(3.12, 9);
      expect(p.top).toBeCloseTo(3 + 0.12 + 1.1, 9);
    }
    expect(b.posts).toHaveLength(0);
  });

  it('flat roof without parapet grows by the overhang', () => {
    const b = body(roof({ kind: 'flat', overhang: 0.3 }), room());
    expect(b.parapets).toHaveLength(0);
    const g = bbox(b.faces[0]!.polygon);
    expect(g.x1 - g.x0).toBeCloseTo(4.8, 9);
  });

  it('flat roof over a courtyard keeps the light well open', () => {
    const f = courtyardFloor();
    const b = body(roof({ kind: 'flat', rooms: Object.keys(f.rooms) }), f);
    const outer = Math.abs(signedArea(b.outline[0]!));
    const hole = Math.abs(signedArea(b.outline[1]!));
    const plan = b.faces.reduce((s, x) => s + Math.abs(signedArea(x.polygon)), 0);
    expect(plan).toBeCloseTo(outer - hole, 6);
  });

  it('glass roof on posts over an empty floor', () => {
    const f = room();
    f.walls = {};
    f.rooms = {};
    f.nodes = {};
    const points = [
      { x: 10, y: 10 },
      { x: 13, y: 10 },
      { x: 13, y: 14 },
      { x: 10, y: 14 },
    ];
    const r = roof({
      follow: false,
      rooms: undefined,
      points,
      edges: presetEdges('glass-frame', points),
      pitch: 10,
      material: 'glass',
      supports: 'posts',
      postSpacing: 3,
    });
    const b = body(r, f);
    const posts = b.posts;
    for (const c of points) {
      expect(posts.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 1e-9)).toBe(true);
    }
    expect(posts).toHaveLength(6);
    for (const p of posts) expect(p.bottom).toBe(0);
    // Along each edge consecutive posts are at most 3 m apart.
    points.forEach((a, i) => {
      const c = points[(i + 1) % 4]!;
      const len = Math.hypot(c.x - a.x, c.y - a.y);
      const on = posts
        .filter((p) => Math.abs((c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x)) / len < 1e-9)
        .map((p) => Math.hypot(p.x - a.x, p.y - a.y))
        .filter((t) => t >= -1e-9 && t <= len + 1e-9)
        .sort((x, y) => x - y);
      for (let k = 1; k < on.length; k++) expect(on[k]! - on[k - 1]!).toBeLessThanOrEqual(3 + 1e-9);
    });
    // Low eaves edge at wall-top level, the high edge raised by the slope.
    const tops = posts.map((p) => p.top);
    expect(Math.min(...tops)).toBeCloseTo(3, 9);
    expect(Math.max(...tops)).toBeCloseTo(3 + 3 * Math.tan((10 * Math.PI) / 180), 9);
  });

  it('no posts where walls stand under the roof', () => {
    const b = body(roof({ supports: 'posts' }), room());
    expect(b.posts).toHaveLength(0);
  });
});
