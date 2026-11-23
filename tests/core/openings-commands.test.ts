// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addOpening,
  applyOpeningPreset,
  moveOpening,
  openingClearances,
  openingGeometry,
  polygonOverlapArea,
  resizeOpening,
  setOpeningDistance,
  updateOpening,
  wallOutlines,
  type Command,
  type Floor,
  type Hinge,
  type Opening,
  type PresetResolver,
  type Vec2,
} from '../../src/core';
import { closestPointOnSegment } from '../../src/core/geometry/segment';
import { outlineClearances } from '../../src/core/openings/clearance';
import { add, distance, leftNormal, normalize, scale, sub } from '../../src/core/geometry/vec';
import { ctxFor, oneRoomFloor } from '../fixtures/floors';
import { irregularFixtures } from '../fixtures/irregular';
import { openingFloor } from '../fixtures/openings';

const ENDS = ['a', 'b'] as const;

const mk = (floor: Floor = oneRoomFloor(), presets?: PresetResolver): H3xDocument =>
  H3xDocument.fromProject(
    { version: 1, unit: 'm', meta: { name: 't', created: '' }, floors: [floor] },
    { presets },
  );

const rad = (deg: number): number => (deg * Math.PI) / 180;
const TILT = rad(37);
/** A point given along and across the measured wall of `meeting`, on the plan. */
const tilted = (x: number, y: number): Vec2 => ({
  x: x * Math.cos(TILT) - y * Math.sin(TILT),
  y: x * Math.sin(TILT) + y * Math.cos(TILT),
});

type Arm = [deg: number, thickness: number, length?: number];

/**
 * A slanted 6 m wall whose `end` is the node n, `arms` meeting it there (their angle from it),
 * and a 1 m opening centred 3 m from n.
 */
function meeting(arms: Arm[], { end = 'a' as Hinge, thickness = 0.2 } = {}): Floor {
  const f = openingFloor({ width: 1, offset: 3 });
  f.nodes = { n: { id: 'n', x: 0, y: 0 }, far: { id: 'far', ...tilted(6, 0) } };
  const a = end === 'a' ? 'n' : 'far';
  const b = end === 'a' ? 'far' : 'n';
  f.walls = { w: { id: 'w', a, b, thickness, height: 3.2 } };
  arms.forEach(([deg, t, length = 4], i) => {
    const id = `m${i}`;
    f.nodes[id] = { id, ...tilted(length * Math.cos(rad(deg)), length * Math.sin(rad(deg))) };
    f.walls[id] = { id, a: 'n', b: id, thickness: t, height: 3.2 };
  });
  return f;
}

/** The opening of `meeting` starts this far from its node. */
const JAMB = 2.5;

/** Where the inner face lines of two walls meeting at `deg` cross, along the first from the node. */
const crossing = (deg: number, own: number, other: number): number =>
  (other / 2 + (own / 2) * Math.cos(rad(deg))) / Math.sin(rad(deg));

/** The outline part of the clearances: the end margin is tested on its own. */
const faceAt = (f: Floor, end: Hinge): number => outlineClearances(f, f.openings.o1!)[end].face;

function expectPoint(actual: Vec2, expected: Vec2) {
  expect(distance(actual, expected)).toBeLessThan(1e-9);
}

/**
 * The drawn outlines as the judge: `until` is on one of them, `face` is how far it is from the
 * jamb, no meeting wall has any area in the wall's band up to there, and just beyond there one
 * has, or the wall's own outline has ended (a junction's fill, or a free end).
 */
function expectMatchesOutlines(f: Floor, o: Opening) {
  const outlines = wallOutlines(f);
  const wall = f.walls[o.wall]!;
  const a = f.nodes[wall.a]!;
  const dir = normalize(sub(f.nodes[wall.b]!, a));
  const half = scale(leftNormal(dir), wall.thickness / 2);
  const clearances = outlineClearances(f, o);
  for (const end of ENDS) {
    const { face, jamb, until } = clearances[end];
    const node = wall[end];
    const meets = Object.values(f.walls).filter(
      (w) => w.id !== wall.id && (w.a === node || w.b === node),
    );
    const onOutline = [wall, ...meets].some(({ id }) => {
      const ring = outlines[id]!;
      return ring.some(
        (p, i) => distance(until, closestPointOnSegment(until, p, ring[(i + 1) % 4]!).point) < 1e-7,
      );
    });
    expect(onOutline, `${wall.id} ${end}`).toBe(true);
    expect(distance(jamb, until)).toBeCloseTo(face, 8);

    const out = scale(dir, end === 'a' ? -1 : 1);
    const start = add(a, scale(dir, o.offset + (end === 'a' ? -o.width : o.width) / 2));
    /** The wall's band between both faces, from `from` to `to` metres out of the jamb. */
    const band = (from: number, to: number): Vec2[] => {
      const p = add(start, scale(out, from));
      const q = add(start, scale(out, to));
      return [add(p, half), add(q, half), sub(q, half), sub(p, half)];
    };
    const covered = (ring: Vec2[]): number =>
      meets.reduce((sum, { id }) => sum + polygonOverlapArea(ring, outlines[id]!), 0);
    expect(covered(band(0, face)), `${wall.id} ${end}`).toBeLessThan(1e-9);
    const beyond = band(face, face + 0.005);
    const notOwn = 0.005 * wall.thickness - polygonOverlapArea(beyond, outlines[wall.id]!);
    expect(covered(beyond) + notOwn, `${wall.id} ${end}`).toBeGreaterThan(1e-9);
  }
}

describe('updateOpening', () => {
  it.each<[string, Partial<Omit<Opening, 'id'>>]>([
    ['offset', { offset: 2 }],
    ['width', { width: 1.1 }],
    ['height', { height: 2.3 }],
    ['sill', { sill: 0.1 }],
    ['wall', { wall: 'w3' }],
    ['preset', { preset: 'door-double-01' }],
    ['type', { type: 'door-sliding' }],
    ['hinge', { hinge: 'b' }],
    ['swing', { swing: 'right' }],
    ['leaves', { leaves: 1 }],
    ['split', { split: 0.6 }],
  ])('patches %s and undoes it in one step', (_, patch) => {
    const doc = mk();
    const before = structuredClone(doc.floor.openings.o1);
    doc.execute(updateOpening('o1', patch));
    expect(doc.floor.openings.o1).toEqual({ ...before, ...patch });
    expect(doc.undo()).toBe(true);
    expect(doc.floor.openings.o1).toEqual(before);
    expect(doc.canUndo).toBe(false);
  });

  it('patches several fields in one step', () => {
    const doc = mk();
    doc.execute(updateOpening('o1', { wall: 'w2', offset: 2.5, width: 1, hinge: 'b' }));
    expect(doc.floor.openings.o1).toMatchObject({ wall: 'w2', offset: 2.5, width: 1, hinge: 'b' });
    doc.undo();
    expect(doc.floor.openings).toEqual(oneRoomFloor().openings);
    expect(doc.canUndo).toBe(false);
  });

  it('moving an opening leaves hinge, swing and type untouched', () => {
    const f = oneRoomFloor();
    Object.assign(f.openings.o1!, { hinge: 'b', swing: 'right', type: 'door-folding' });
    const doc = mk(f);
    doc.execute(moveOpening('o1', { offset: 2 }));
    expect(doc.floor.openings.o1).toEqual({ ...f.openings.o1, offset: 2 });
  });

  it('never changes the id', () => {
    const doc = mk();
    doc.execute(updateOpening('o1', { id: 'other', offset: 2 } as Partial<Opening>));
    expect(doc.floor.openings.o1).toMatchObject({ id: 'o1', offset: 2 });
  });

  it('makes no undo step when nothing changes', () => {
    const doc = mk();
    doc.execute(updateOpening('o1', { offset: 1.2, hinge: undefined }));
    expect(doc.canUndo).toBe(false);
  });

  it('is not-found for an unknown opening or wall', () => {
    const doc = mk();
    for (const cmd of [updateOpening('no', { sill: 1 }), updateOpening('o1', { wall: 'no' })]) {
      expect(doc.tryExecute(cmd)).toMatchObject({ ok: false, issues: [{ code: 'not-found' }] });
    }
  });

  it('repairs a loaded opening with height 0', () => {
    const f = oneRoomFloor();
    f.openings.o1!.height = 0;
    const doc = H3xDocument.fromXML(mk(f).toXML());
    expect(doc.floor.openings.o1!.height).toBe(0);
    doc.execute(updateOpening('o1', { height: 2.1 }));
    expect(doc.floor.openings.o1!.height).toBe(2.1);
  });
});

describe('addOpening', () => {
  it('takes every field as an override of the preset', () => {
    const doc = mk();
    const over = {
      width: 1.1,
      height: 2,
      sill: 0.2,
      type: 'door-double',
      hinge: 'b',
      swing: 'right',
      leaves: 2,
      split: 0.7,
    } as const;
    const cmd = addOpening({ wall: 'w3', preset: 'door-single-01', offset: 2, ...over });
    doc.execute(cmd);
    expect(doc.floor.openings[cmd.createdId]).toEqual({
      id: cmd.createdId,
      wall: 'w3',
      preset: 'door-single-01',
      offset: 2,
      ...over,
    });
  });
});

describe('resizeOpening', () => {
  it.each([
    [{ x: 4, y: 3 }, 'a', 1.6],
    [{ x: 4, y: 3 }, 'b', 0.7],
    [{ x: -3.1, y: 2.3 }, 'a', 0.8333333],
    [{ x: -1.7, y: -4.4 }, 'b', 1.4444444],
  ] as const)('on a wall to %o, moving %s to width %f keeps the other jamb', (b, end, width) => {
    const doc = mk(openingFloor({ offset: 1.987654321 }, { b }));
    const cut = () => openingGeometry(doc.floor, doc.floor.openings.o1!)!.cut;
    const before = cut();
    doc.execute(resizeOpening('o1', { end, width }));
    const after = cut();
    const still = end === 'a' ? [1, 2] : [0, 3];
    for (const i of still) expectPoint(after[i]!, before[i]!);
    expect(distance(after[0], after[1])).toBeCloseTo(width, 8);
    doc.undo();
    expect(cut()).toEqual(before);
  });

  it('is not-found for an unknown opening', () => {
    expect(mk().tryExecute(resizeOpening('no', { end: 'a', width: 1 }))).toMatchObject({
      ok: false,
      issues: [{ code: 'not-found' }],
    });
  });

  it('gives the same result when a drag replays it from the start', () => {
    const doc = mk(openingFloor());
    const drag = { coalesceKey: 'drag', restart: true };
    for (const width of [0.5, 2, 1.5]) doc.execute(resizeOpening('o1', { end: 'b', width }), drag);
    expect(doc.floor.openings.o1).toMatchObject({ offset: 2.15, width: 1.5 });
    doc.undo();
    expect(doc.floor.openings.o1).toMatchObject({ offset: 2, width: 1.2 });
  });
});

describe('openingClearances', () => {
  describe('stops where the wall accepts an opening (openingRange)', () => {
    /** w1 of oneRoomFloor with a free end at n1 (w4 gone), or w4 only 0.1 thick. */
    const freeEnd = (): Floor => {
      const f = oneRoomFloor();
      delete f.walls.w4;
      f.rooms = {};
      return f;
    };
    const thinPartition = (): Floor => {
      const f = oneRoomFloor();
      f.walls.w4!.thickness = 0.1;
      return f;
    };

    it.each([
      ['a free wall end', freeEnd],
      ['a 0.1 m meeting wall', thinPartition],
    ])('at %s: the end margin, and distance 0 is accepted', (_, floor) => {
      const f = floor();
      // Jamb a at 0.75; the outline would allow 0 or 0.05, the end margin is 0.1.
      const c = openingClearances(f, f.openings.o1!);
      expect(c.a.face).toBeCloseTo(0.65, 9);
      expect(c.a.until.x).toBeCloseTo(0.1, 9);
      expect(c.a.jamb.x).toBeCloseTo(0.75, 9);
      const doc = mk(f);
      expect(
        doc.tryExecute(setOpeningDistance('o1', { end: 'a', distance: 0, from: 'face' })),
      ).toEqual({ ok: true });
      expect(doc.floor.openings.o1!.offset).toBeCloseTo(0.55, 9);
      expect(openingClearances(doc.floor, doc.floor.openings.o1!).a.face).toBeCloseTo(0, 9);
      // Any nearer is out of the wall.
      const nearer = doc.tryExecute(updateOpening('o1', { offset: 0.54 }));
      expect(nearer.ok).toBe(false);
    });
  });

  describe.each([45, 60, 80, 90, 120])('a wall meeting at %i degrees', (deg) => {
    it.each([
      [0.2, 0.2],
      [0.2, 0.35],
      [0.2, 0.15],
      [0.3, 0.2],
    ])('%f thick, met by one %f thick', (own, other) => {
      const x = crossing(deg, own, other);
      for (const end of ENDS) {
        for (const mirror of [1, -1]) {
          const f = meeting([[mirror * deg, other]], { end, thickness: own });
          const c = outlineClearances(f, f.openings.o1!)[end];
          expect(c.face).toBeCloseTo(JAMB - x, 8);
          expect(c.axis).toBeCloseTo(JAMB, 8);
          expectPoint(c.jamb, tilted(JAMB, (mirror * own) / 2));
          expectPoint(c.until, tilted(x, (mirror * own) / 2));
          expectMatchesOutlines(f, f.openings.o1!);
        }
      }
    });
  });

  it.each([
    [20, 0.2],
    [15, 0.3],
    [10, 0.1],
  ])('at %i degrees, past the miter limit, stops at the drawn wall %f thick', (deg, other) => {
    for (const end of ENDS) {
      const f = meeting([[deg, other]], { end });
      expect(faceAt(f, end)).toBeCloseTo(JAMB - crossing(deg, 0.2, other), 8);
      expectMatchesOutlines(f, f.openings.o1!);
    }
  });

  it('stops at the square end of a thicker wall almost in line', () => {
    for (const end of ENDS) {
      const f = meeting([[170, 0.4]], { end, thickness: 0.1 });
      expect(faceAt(f, end)).toBeCloseTo(JAMB - 0.05 * Math.tan(rad(10)), 8);
    }
  });

  it.each<[string, Arm[], number]>([
    ['a free end', [], 0],
    ['a straight continuation', [[180, 0.2]], 0],
    ['a thicker continuation', [[180, 0.4]], 0],
    ['a thinner continuation', [[180, 0.1]], 0],
    [
      'the stem of a T',
      [
        [90, 0.3],
        [-90, 0.3],
      ],
      0.15,
    ],
    [
      'the bar of a T',
      [
        [180, 0.2],
        [90, 0.3],
      ],
      0.15,
    ],
    [
      'an X',
      [
        [90, 0.3],
        [180, 0.2],
        [-90, 0.3],
      ],
      0.15,
    ],
    [
      'a skew X',
      [
        [60, 0.3],
        [180, 0.2],
        [-120, 0.3],
      ],
      crossing(60, 0.2, 0.3),
    ],
    [
      'a Y with thin arms',
      [
        [135, 0.04],
        [-135, 0.04],
      ],
      // Both corners are behind the node; the crook of the arms, between the faces, is nearer.
      -0.02 / Math.sin(rad(45)),
    ],
  ])('at %s', (_, arms, x) => {
    for (const end of ENDS) {
      const f = meeting(arms, { end });
      expect(faceAt(f, end)).toBeCloseTo(JAMB - x, 8);
      expectMatchesOutlines(f, f.openings.o1!);
    }
  });

  it.each(Object.entries(irregularFixtures))('matches the outlines of %s', (_, make) => {
    const f = make();
    const base = openingFloor().openings.o1!;
    for (const wall of Object.values(f.walls)) {
      const offset = distance(f.nodes[wall.a]!, f.nodes[wall.b]!) / 2;
      expectMatchesOutlines(f, { ...base, wall: wall.id, offset, width: 0.2 });
    }
  });

  it('a neighbour opening ends the clear distance, not the distance to the node', () => {
    const f = openingFloor({ width: 1, offset: 5 }, { b: { x: 10, y: 0 } });
    const other = (id: string, offset: number, width: number) =>
      (f.openings[id] = { ...f.openings.o1!, id, offset, width });
    other('far', 1, 0.8);
    other('before', 2.5, 1); // its nearer jamb: 3
    other('after', 8, 2); // its nearer jamb: 7
    const c = openingClearances(f, f.openings.o1!);
    expect(c.a).toMatchObject({ face: 1.5, axis: 4.5 });
    expect(c.b).toMatchObject({ face: 1.5, axis: 4.5 });
    expect([c.a.jamb.x, c.a.until.x, c.b.jamb.x, c.b.until.x]).toEqual([4.5, 3, 5.5, 7]);
    for (const p of [c.a.jamb, c.a.until, c.b.jamb, c.b.until]) {
      expect(Math.abs(p.y)).toBe(0.1);
    }
  });

  it('ignores the openings of other walls', () => {
    const f = oneRoomFloor();
    f.openings.o2 = { ...f.openings.o1!, id: 'o2', wall: 'w2', offset: 0.6 };
    expect(openingClearances(f, f.openings.o1!).a.face).toBeCloseTo(0.65, 9);
  });

  it('measures to another wall that crosses the face beyond the joined corners', () => {
    const f = meeting([
      [150, 0.3],
      [320, 0.1],
    ]);
    // The thicker wall's end edge runs from (0.1268, 0.1) to (0.4123, -0.4113), so it crosses
    // the right face at 0.2385; the wall's own corner there is at 0.1970.
    expect(faceAt(f, 'a')).toBeCloseTo(JAMB - 0.2385, 3);
    expectMatchesOutlines(f, f.openings.o1!);
  });

  describe.each([
    // The far corner of a short thin wall that never reaches a face of the thick one.
    ['a short thin wall', 14, 0.05, 0.4, 0.4],
    // The corner of the square end of a thinner wall almost in line.
    ['a thinner wall almost in line', 175, 0.15, 4, 0.3],
  ] as const)('%s between the faces', (_, deg, other, length, own) => {
    const d = { x: Math.cos(rad(deg)), y: Math.sin(rad(deg)) };
    // That wall's right corner: at its far end, or at the node when it heads away.
    const reach = deg < 90 ? length : 0;
    const x = reach * d.x + (other / 2) * d.y;
    const y = reach * d.y - (other / 2) * d.x;

    it.each(ENDS)('counts at %s', (end) => {
      for (const mirror of [1, -1]) {
        const f = meeting([[mirror * deg, other, length]], { end, thickness: own });
        const c = outlineClearances(f, f.openings.o1!)[end];
        expect(c.face).toBeCloseTo(JAMB - x, 8);
        expectPoint(c.jamb, tilted(JAMB, mirror * y));
        expectPoint(c.until, tilted(x, mirror * y));
        expectMatchesOutlines(f, f.openings.o1!);
      }
    });

    it.each(ENDS)('a cut at distance 0 from it at %s does not overlap it', (end) => {
      const f = meeting([[deg, other, length]], { end, thickness: own });
      const ring = wallOutlines(f).m0!;
      // Flush with where the outline stops (nearer the node than the end margin allows).
      const o = f.openings.o1!;
      const face = outlineClearances(f, o)[end].face;
      const at = { ...o, offset: o.offset + (end === 'a' ? -face : face) };
      const overlap = (o: Opening) => polygonOverlapArea(openingGeometry(f, o)!.cut, ring);
      expect(overlap(at)).toBeLessThan(1e-9);
      // 5 mm further toward the node it does.
      const past = end === 'a' ? -0.005 : 0.005;
      expect(overlap({ ...at, offset: at.offset + past })).toBeGreaterThan(1e-9);
    });
  });

  it('stays on the left face where a tie reaches between the faces', () => {
    // A thinner continuation's end has both its corners between the faces, level with the node.
    const f = meeting([[180, 0.1]]);
    expectPoint(outlineClearances(f, f.openings.o1!).a.until, tilted(0, 0.1));
  });

  it('counts a corner between the faces at a crowded node', () => {
    const f = meeting(
      [
        [125, 0.2],
        [190, 0.22],
        [140, 0.3],
      ],
      { thickness: 0.4 },
    );
    expectMatchesOutlines(f, f.openings.o1!);
  });

  it('is negative where an opening reaches into a meeting wall', () => {
    const f = oneRoomFloor();
    f.openings.o1!.offset = 0.5;
    expect(openingClearances(f, f.openings.o1!).a.face).toBeCloseTo(-0.05, 9);
  });

  it('is not-found without the wall', () => {
    const f = oneRoomFloor();
    expect(() => openingClearances(f, { ...f.openings.o1!, wall: 'no' })).toThrow('does not exist');
  });
});

describe('setOpeningDistance', () => {
  /** A 10 m wall met by one 0.4 thick at a and one 0.3 thick at b, with o1 1 m wide at 5. */
  function row(neighbours: boolean): Floor {
    const f = openingFloor({ width: 1, offset: 5 }, { b: { x: 10, y: 0 } });
    f.nodes.p = { id: 'p', x: 0, y: 3 };
    f.nodes.q = { id: 'q', x: 10, y: 3 };
    f.walls.wp = { id: 'wp', a: 'a', b: 'p', thickness: 0.4, height: 3.2 };
    f.walls.wq = { id: 'wq', a: 'q', b: 'b', thickness: 0.3, height: 3.2 };
    if (neighbours) {
      f.openings.before = { ...f.openings.o1!, id: 'before', offset: 2.5 }; // up to 3
      f.openings.after = { ...f.openings.o1!, id: 'after', offset: 7.5 }; // from 7
    }
    return f;
  }

  it.each([
    ['a', 'face', false, 1.7], // 0.2 + 1 + 0.5
    ['b', 'face', false, 8.35], // 10 - 0.15 - 1 - 0.5
    ['a', 'axis', false, 1.5],
    ['b', 'axis', false, 8.5],
    ['a', 'face', true, 4.5], // 3 + 1 + 0.5
    ['b', 'face', true, 5.5], // 7 - 1 - 0.5
  ] as const)('1 m at %s, from %s, neighbours %s: centre %f', (end, from, neighbours, offset) => {
    const doc = mk(row(neighbours));
    doc.execute(setOpeningDistance('o1', { end, distance: 1, from }));
    expect(doc.floor.openings.o1!.offset).toBeCloseTo(offset, 9);
    expect(doc.floor.openings.o1!.width).toBe(1);
    doc.undo();
    expect(doc.floor.openings.o1!.offset).toBe(5);
  });

  it.each([
    ['a', 4.2],
    ['b', 5.8],
  ] as const)('measures the axis at %s whatever stands between', (end, offset) => {
    const doc = mk(row(true));
    doc.execute(setOpeningDistance('o1', { end, distance: 3.7, from: 'axis' }));
    expect(doc.floor.openings.o1!.offset).toBeCloseTo(offset, 9);
  });

  it.each([45, 60, 80, 90, 120])('0 at a wall meeting at %i degrees is on its face', (deg) => {
    const x = crossing(deg, 0.2, 0.35);
    for (const end of ENDS) {
      const f = meeting([[deg, 0.35]], { end });
      // The command alone: how near a meeting wall an opening may stand is for the validators.
      const cmd = setOpeningDistance('o1', { end, distance: 0, from: 'face' });
      const after = cmd.run(ctxFor(f))[0]!.after as Opening;
      expect(after.offset).toBeCloseTo(end === 'a' ? x + 0.5 : 6 - x - 0.5, 8);
    }
  });

  it.each(['face', 'axis'] as const)('rejects a negative distance from the %s', (from) => {
    for (const distance of [-0.01, NaN]) {
      const doc = mk(row(false));
      expect(doc.tryExecute(setOpeningDistance('o1', { end: 'a', distance, from }))).toMatchObject({
        ok: false,
        issues: [{ code: 'invalid-opening' }],
      });
      expect(doc.canUndo).toBe(false);
    }
  });

  it('rejects a clear distance with the next opening on the other side in the way', () => {
    const f = row(true);
    f.openings.before!.offset = 1.5;
    f.openings.o1!.offset = 3;
    f.openings.after!.offset = 5;
    const cmd = setOpeningDistance('o1', { end: 'a', distance: 5, from: 'face' });
    expect(mk(f).tryExecute(cmd)).toMatchObject({
      ok: false,
      issues: [{ code: 'opening-overlap', ids: ['o1', 'after'] }],
    });
  });

  it('gives the same result when a drag replays it from the start', () => {
    const doc = mk(row(false));
    const drag = { coalesceKey: 'drag', restart: true };
    for (const distance of [2, 0.5, 1]) {
      doc.execute(setOpeningDistance('o1', { end: 'a', distance, from: 'face' }), drag);
    }
    expect(doc.floor.openings.o1!.offset).toBeCloseTo(1.7, 9);
    doc.undo();
    expect(doc.floor.openings.o1!.offset).toBe(5);
  });
});

// 23 steps of a 0.05 grid, and a third: neither is round to 1e-9, as stored offsets need not be.
describe.each([23 * 0.05, 4 / 3])('an opening at %f that is not moved', (offset) => {
  type Edit = (end: Hinge, o: Opening, f: Floor, more?: number) => Command;
  const resize: Edit = (end, o, _, more = 0) => resizeOpening('o1', { end, width: o.width + more });
  const dimension =
    (from: 'face' | 'axis'): Edit =>
    (end, o, f, more = 0) => {
      const distance = openingClearances(f, o)[end][from] + more;
      return setOpeningDistance('o1', { end, distance, from });
    };

  describe.each([
    ['resizeOpening', resize],
    ['setOpeningDistance from the face', dimension('face')],
    ['setOpeningDistance from the axis', dimension('axis')],
  ] as const)('%s', (_, edit) => {
    /** A document with an edit to redo, so that a needless step shows on both stacks. */
    function start() {
      const floor = openingFloor({ offset });
      const doc = mk(floor);
      doc.execute(updateOpening('o1', { sill: 0.1 }));
      doc.undo();
      return { doc, floor, o: floor.openings.o1! };
    }

    function expectUntouched(doc: H3xDocument, o: Opening) {
      expect(doc.floor.openings.o1).toEqual(o);
      expect(doc.canUndo).toBe(false);
      expect(doc.canRedo).toBe(true);
    }

    it.each(ENDS)('to the value it has at %s changes nothing', (end) => {
      const { doc, floor, o } = start();
      let events = 0;
      doc.on('change', () => events++);
      doc.execute(edit(end, o, floor));
      expectUntouched(doc, o);
      expect(events).toBe(0);
    });

    it.each(ENDS)('dragged out and back at %s leaves no step', (end) => {
      const { doc, floor, o } = start();
      const drag = { coalesceKey: 'drag', restart: true };
      doc.execute(edit(end, o, floor, 0.2), drag);
      expect(doc.canUndo).toBe(true);
      doc.execute(edit(end, o, floor), drag);
      expectUntouched(doc, o);
    });
  });

  it.each(ENDS)('keeps it for a width that differs only by rounding at %s', (end) => {
    const doc = mk(openingFloor({ offset }));
    doc.execute(resizeOpening('o1', { end, width: 1.2 + 4e-16 }));
    expect(doc.floor.openings.o1).toMatchObject({ offset, width: 1.2 });
    expect(doc.canUndo).toBe(false);
  });
});

describe('applyOpeningPreset', () => {
  it('keeps id, wall, centre and orientation', () => {
    const f = oneRoomFloor();
    Object.assign(f.openings.o1!, { offset: 2, hinge: 'b', swing: 'right', leaves: 1 });
    const doc = mk(f);
    doc.execute(applyOpeningPreset('o1', 'door-double-unequal-01'));
    expect(doc.floor.openings.o1).toEqual({
      id: 'o1',
      wall: 'w1',
      preset: 'door-double-unequal-01',
      offset: 2,
      width: 1.2,
      height: 2.2,
      sill: 0,
      type: 'door-double',
      hinge: 'b',
      swing: 'right',
      split: 0.67,
    });
    doc.undo();
    expect(doc.floor.openings.o1).toEqual(f.openings.o1);
    expect(doc.canUndo).toBe(false);
  });

  it('takes the orientation and the sill a preset gives', () => {
    const doc = mk(oneRoomFloor(), () => ({
      mount: 'opening',
      footprint: { w: 0.8, d: 0.05, h: 1.2 },
      sill: 1,
      opening: { hinge: 'b', swing: 'right' },
    }));
    doc.execute(applyOpeningPreset('o1', 'host-window'));
    expect(doc.floor.openings.o1).toMatchObject({
      type: 'window-fixed',
      hinge: 'b',
      swing: 'right',
      width: 0.8,
      sill: 1,
    });
  });

  it('rejects an unknown opening or preset, and a preset of another mount', () => {
    const doc = mk(oneRoomFloor(), (id) =>
      id === 'sofa' ? { mount: 'floor', footprint: { w: 2, d: 1, h: 1 } } : undefined,
    );
    for (const [id, preset, code] of [
      ['no', 'window-01', 'not-found'],
      ['o1', 'no', 'unknown-preset'],
      ['o1', 'sofa', 'unknown-preset'],
    ] as const) {
      expect(doc.tryExecute(applyOpeningPreset(id, preset))).toMatchObject({
        ok: false,
        issues: [{ code }],
      });
    }
  });
});
