// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addColumn,
  addOpening,
  addWall,
  applyOpeningPreset,
  checkOpening,
  dropNode,
  mergeNodes,
  moveColumn,
  moveNode,
  moveOpening,
  openingGeometry,
  polygonOverlapArea,
  pushPullWall,
  removeNode,
  resizeOpening,
  setOpeningDistance,
  setWallLength,
  splitWall,
  updateOpening,
  validatePlacements,
  wallOutlines,
  type Column,
  type Command,
  type Floor,
  type Hinge,
  type Issue,
  type Opening,
  type PresetResolver,
  type Stair,
  type Vec2,
} from '../../src/core';
import { GEOM_TOL } from '../../src/core/constants';
import { inRange, openingFitRange, openingRange } from '../../src/core/validate/layout';
import { oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';
import { openingFloor } from '../fixtures/openings';

const ENDS = ['a', 'b'] as const;

const mk = (floor: Floor, presets?: PresetResolver, above: Floor[] = []): H3xDocument =>
  H3xDocument.fromProject(
    { version: 1, unit: 'm', meta: { name: 't', created: '' }, floors: [floor, ...above] },
    { presets },
  );

const codes = (issues: Issue[]): string[] => issues.map((i) => i.code);

/** The codes a command is rejected with, none when it passes. */
function rejection(doc: H3xDocument, cmd: Command): string[] {
  const r = doc.tryExecute(cmd);
  return r.ok ? [] : codes(r.issues);
}

function addWallTo(f: Floor, id: string, from: string | Vec2, to: Vec2, thickness = 0.2): void {
  const node = (key: string, p: Vec2): string => {
    f.nodes[key] = { id: key, ...p };
    return key;
  };
  const a = typeof from === 'string' ? from : node(`${id}a`, from);
  f.walls[id] = { id, a, b: node(`${id}b`, to), thickness, height: 3.2 };
}

function withColumn(f: Floor, c: Partial<Column>): Floor {
  f.columns.c = { id: 'c', x: 0, y: 0, shape: 'square', width: 0.2, rotation: 0, ...c };
  return f;
}

function withOpening(f: Floor, id: string, over: Partial<Opening>): Floor {
  f.openings[id] = { ...f.openings.o1!, id, ...over };
  return f;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Where the inner face lines of two walls meeting at `deg` cross, along the first from the node. */
const crossing = (deg: number, own: number, other: number): number =>
  (other / 2 + (own / 2) * Math.cos(rad(deg))) / Math.sin(rad(deg));

/** A 4 m wall along x, met at `end` by walls at `arms` degrees from it, with o1 0.9 wide. */
function corner(
  end: Hinge,
  arms: Array<[deg: number, thickness: number]>,
  { offset = 2, thickness = 0.2 } = {},
): Floor {
  const f = openingFloor({ width: 0.9, offset }, { thickness });
  const from = f.nodes[end]!;
  const inward = end === 'a' ? 1 : -1;
  arms.forEach(([deg, t], i) => {
    const to = { x: from.x + inward * 3 * Math.cos(rad(deg)), y: 3 * Math.sin(rad(deg)) };
    addWallTo(f, `m${i}`, end, to, t);
  });
  return f;
}

/** The wall's band that o1 asks for, whether or not its cut can have it. */
function askedBand(f: Floor, o: Opening): Vec2[] {
  const h = f.walls.w!.thickness / 2;
  const lo = o.offset - o.width / 2;
  const hi = o.offset + o.width / 2;
  return [
    { x: lo, y: -h },
    { x: hi, y: -h },
    { x: hi, y: h },
    { x: lo, y: h },
  ];
}

function overlapWithMeeting(f: Floor, ring: Vec2[]): number {
  return Object.entries(wallOutlines(f))
    .filter(([id]) => id !== 'w')
    .reduce((sum, [, outline]) => sum + polygonOverlapArea(ring, outline), 0);
}

describe('opening issues block opening edits', () => {
  it.each<[string, () => Floor, Parameters<typeof updateOpening>[1]]>([
    ['opening-out-of-wall', () => openingFloor(), { offset: 0.5 }],
    [
      'opening-overlap',
      () => withOpening(openingFloor({ width: 0.8, offset: 1 }), 'o2', { offset: 3 }),
      { offset: 2.5 },
    ],
    ['opening-too-tall', () => openingFloor(), { sill: 1.2 }],
    ['opening-hits-column', () => withColumn(openingFloor(), { x: 1.2 }), { offset: 1.8 }],
    ['invalid-opening', () => openingFloor(), { height: 0 }],
  ])('%s', (code, make, patch) => {
    const doc = mk(make());
    expect(doc.validatePlacements()).toEqual([]);
    const before = structuredClone(doc.floor);
    expect(rejection(doc, updateOpening('o1', patch))).toContain(code);
    expect(codes(doc.preview(updateOpening('o1', patch)))).toContain(code);
    expect(doc.floor).toEqual(before);
    expect(doc.canUndo).toBe(false);
  });

  it('opening-hits-column blocks adding and resizing too', () => {
    const doc = mk(withColumn(openingFloor(), { x: 3.4 }));
    const add = addOpening({ wall: 'w', preset: 'door-single-01', offset: 3.3 });
    expect(rejection(doc, add)).toContain('opening-hits-column');
    expect(rejection(doc, resizeOpening('o1', { end: 'b', width: 2.2 }))).toEqual([
      'opening-hits-column',
    ]);
  });
});

describe('opening issues are reported after other edits', () => {
  const reported = (doc: H3xDocument, code: string) =>
    doc.validatePlacements().filter((i) => i.code === code);

  it('opening-out-of-wall: a corner made skew', () => {
    const doc = mk(corner('a', [[90, 0.2]], { offset: 0.56 }));
    expect(doc.validatePlacements()).toEqual([]);
    expect(rejection(doc, moveNode('m0b', { x: 2, y: 2 }))).toEqual([]);
    expect(doc.floor.openings.o1!.offset).toBe(0.56);
    expect(reported(doc, 'opening-out-of-wall')).toMatchObject([{ ids: ['o1', 'w'] }]);
    expect(codes(doc.validateLayout())).toContain('opening-out-of-wall');
  });

  it('opening-overlap: a node drag fits two openings into each other', () => {
    const doc = mk(withOpening(openingFloor({ offset: 3.2 }), 'o2', { width: 0.8, offset: 1 }));
    expect(doc.validatePlacements()).toEqual([]);
    expect(rejection(doc, moveNode('b', { x: 2.4, y: 0 }))).toEqual([]);
    expect(reported(doc, 'opening-overlap')).not.toEqual([]);
  });

  it('opening-too-tall: a wall made lower', () => {
    const doc = mk(openingFloor());
    const lower: Command = {
      label: 'lower',
      run: ({ floor }) => {
        const w = floor.walls.w!;
        return [{ kind: 'wall', id: 'w', before: { ...w }, after: { ...w, height: 2 } }];
      },
    };
    expect(rejection(doc, lower)).toEqual([]);
    expect(reported(doc, 'opening-too-tall')).toMatchObject([{ ids: ['o1', 'w'] }]);
  });

  it('opening-hits-column: a column moved onto a door', () => {
    const doc = mk(withColumn(openingFloor(), { x: 0.5 }));
    expect(rejection(doc, moveColumn('c', { x: 2 }))).toEqual([]);
    expect(reported(doc, 'opening-hits-column')).toMatchObject([{ ids: ['o1', 'c'] }]);
    expect(doc.floor.openings.o1!.offset).toBe(2);
  });

  it('opening-hits-column: a column added on a door', () => {
    const doc = mk(openingFloor());
    expect(rejection(doc, addColumn({ x: 2, y: 0, shape: 'round', width: 0.2 }))).toEqual([]);
    expect(reported(doc, 'opening-hits-column')).toHaveLength(1);
  });

  it.each([{ height: 0 }, { height: -2 }, { sill: -1 }])(
    'invalid-opening: loaded with %o, through a wall edit',
    (bad) => {
      const doc = H3xDocument.fromXML(mk(openingFloor(bad)).toXML());
      expect(reported(doc, 'invalid-opening')).toMatchObject([{ ids: ['o1'] }]);
      expect(rejection(doc, moveNode('b', { x: 4.5, y: 0 }))).toEqual([]);
      expect(reported(doc, 'invalid-opening')).toHaveLength(1);
    },
  );
});

describe('opening-hits-column', () => {
  // The cut of o1 runs from x = 1.4 to 2.6 between y = -0.1 and 0.1.
  const half = Math.SQRT1_2 * 0.3;
  it.each<[string, Partial<Column>, boolean]>([
    ['square inside', { x: 2 }, true],
    ['square touching a face', { x: 2, y: 0.2 }, false],
    ['square touching a jamb', { x: 1.3 }, false],
    ['square 0.04 mm into a face: 1.2e-5', { x: 2, y: 0.25 - 4e-5, width: 0.3 }, true],
    ['square 0.03 mm into a face: 0.9e-5', { x: 2, y: 0.25 - 3e-5, width: 0.3 }, false],
    ['oblong turned along the wall', { x: 2, y: 0.2, width: 0.4, depth: 0.1 }, false],
    [
      'oblong turned across the wall',
      { x: 2, y: 0.2, width: 0.4, depth: 0.1, rotation: 1.2 },
      true,
    ],
    ['round touching a face', { x: 2, y: 0.25, shape: 'round', width: 0.3 }, false],
    ['round beside a corner', { x: 1.286, y: 0.214, shape: 'round', width: 0.3 }, false],
    ['round over a corner', { x: 1.31, y: 0.19, shape: 'round', width: 0.3 }, true],
    ['diamond touching a face', { x: 2, y: 0.1 + half, width: 0.3, rotation: Math.PI / 4 }, false],
    ['diamond beside a corner', { x: 1.28, y: 0.22, width: 0.3, rotation: Math.PI / 4 }, false],
    ['diamond over a corner', { x: 1.31, y: 0.19, width: 0.3, rotation: Math.PI / 4 }, true],
  ])('%s', (_, column, hits) => {
    const f = withColumn(openingFloor({ type: 'opening' }), column);
    expect(codes(checkOpening(f, f.openings.o1!))).toEqual(hits ? ['opening-hits-column'] : []);
  });
});

describe('opening-swing-blocked', () => {
  // o1 is hinged at (1.4, 0) and sweeps a quarter circle of 1.2 m to the left.
  const stair = (over: Partial<Stair>): Stair => ({
    id: 's',
    x: 2,
    y: 1.2,
    width: 1,
    depth: 1,
    rotation: 0,
    type: 'straight',
    turn: 'landing',
    hand: 'right',
    flightWidth: 0.9,
    ...over,
  });
  const blockers = (f: Floor, of = 'o1'): string[] =>
    validatePlacements(f, testPresets)
      .filter((i) => i.code === 'opening-swing-blocked' && i.ids[0] === of)
      .map((i) => i.ids[1]!);
  /** A wall at x = 2.8, up the plan, with o2 on it from y = 0.8 to 1.6 opening to -x. */
  const beside = (over: Partial<Opening>): Floor => {
    const f = openingFloor();
    addWallTo(f, 'v', { x: 2.8, y: 0.2 }, { x: 2.8, y: 2.2 });
    return withOpening(f, 'o2', { wall: 'v', offset: 1, width: 0.8, ...over });
  };

  it('a wall', () => {
    const f = openingFloor();
    addWallTo(f, 'v', { x: 1, y: 0.8 }, { x: 3, y: 0.8 });
    expect(blockers(f)).toEqual(['v']);
  });

  it('a column', () => {
    expect(blockers(withColumn(openingFloor(), { x: 1.8, y: 0.7 }))).toEqual(['c']);
  });

  it('a column in the box round the quarter circle, not in the circle', () => {
    expect(blockers(withColumn(openingFloor(), { x: 2.5, y: 1.1 }))).toEqual([]);
  });

  it('a stair', () => {
    const f = openingFloor();
    f.stairs.s = stair({});
    expect(blockers(f)).toEqual(['s']);
  });

  it('a stair as drawn for the floor above, not its bay', () => {
    const f = openingFloor();
    // The bay is x = 1.5 … 3.5; the one flight of it stands at 2.6 … 3.5.
    f.stairs.s = stair({ x: 2.5, y: 2.9, width: 2, depth: 5.4 });
    expect(blockers(f)).toEqual(['s']);
    const above = { ...openingFloor(), id: 'up', level: 1, openings: {} };
    expect(mk(f, testPresets, [above]).validatePlacements()).toEqual([]);
  });

  it('the moving leaf of another door, both ways', () => {
    const f = beside({});
    expect(blockers(f)).toEqual(['o2']);
    expect(blockers(f, 'o2')).toEqual(['o1']);
  });

  it('the open leaf of a window, at the same height only', () => {
    const casement = { type: 'window-casement', leaves: 1 } as const;
    expect(blockers(beside({ ...casement, sill: 0.9, height: 1.4 }))).toEqual(['o2']);
    expect(blockers(beside({ ...casement, sill: 2.2, height: 0.6 }))).toEqual([]);
  });

  it('the panel of a sliding door along the face', () => {
    const next = (hinge: Hinge) =>
      withOpening(openingFloor({}, { b: { x: 5, y: 0 } }), 'o2', {
        type: 'door-sliding',
        leaves: 1,
        offset: 3.2,
        width: 0.8,
        hinge,
      });
    expect(blockers(next('a'))).toEqual(['o2']); // slid to x = 2.4 … 3.2
    expect(blockers(next('b'))).toEqual([]); // slid to x = 3.2 … 4
  });

  it('an open leaf along the edge of the sweep only touches', () => {
    const f = withOpening(openingFloor({ hinge: 'b' }, { b: { x: 5, y: 0 } }), 'o2', {
      type: 'window-casement',
      leaves: 1,
      hinge: 'a',
      offset: 3.1,
      width: 1,
    });
    expect(blockers(f)).toEqual([]);
  });

  it('two doors side by side only touch', () => {
    const f = withOpening(openingFloor({ hinge: 'b' }, { b: { x: 5, y: 0 } }), 'o2', {
      hinge: 'a',
      offset: 3.2,
    });
    expect(validatePlacements(f, testPresets)).toEqual([]);
  });

  it.each([
    ['door-swing', {}],
    ['door-double', { split: 0.67 }],
    ['door-folding', { leaves: 4 }],
  ] as const)('%s passes its own wall and leaves', (type, over) => {
    for (const swing of ['left', 'right'] as const) {
      const f = openingFloor({ type, ...over, swing });
      expect(validatePlacements(f, testPresets)).toEqual([]);
    }
  });

  it.each([oneRoomFloor, twoRoomFloor])('passes a corner at the 0.1 m margin (%o)', (make) => {
    for (const hinge of ENDS) {
      for (const swing of ['left', 'right'] as const) {
        const f = make();
        const offset = hinge === 'a' ? 0.55 : 4 - 0.55;
        f.openings = { o1: { ...oneRoomFloor().openings.o1!, hinge, swing, offset } };
        expect(validatePlacements(f, testPresets)).toEqual([]);
      }
    }
  });

  it('a folding door needs its whole width by one panel deep', () => {
    // 4 panels of 0.3: the band is x = 1.4 … 2.6, y = 0 … 0.3.
    const at = (x: number, y: number) =>
      blockers(withColumn(openingFloor({ type: 'door-folding', leaves: 4 }), { x, y }));
    expect(at(1.5, 0.35)).toEqual(['c']);
    expect(at(2.5, 0.35)).toEqual(['c']);
    expect(at(2, 0.4)).toEqual([]);
  });

  it.each([
    [0.0004, false], // 0.8e-4 m²
    [0.0006, true], // 1.2e-4 m²
  ])('%f m into the band: blocked %s', (into, blocked) => {
    const f = withColumn(openingFloor({ type: 'door-folding', leaves: 4 }), {
      x: 2,
      y: 0.4 - into,
    });
    expect(blockers(f)).toEqual(blocked ? ['c'] : []);
  });

  it('the box of a rolling door is no sweep and adds no height', () => {
    const f = withColumn(openingFloor({ type: 'door-rolling', height: 3.1 }), { x: 2, y: 0.25 });
    expect(validatePlacements(f, testPresets)).toEqual([]);
  });

  it('never blocks', () => {
    const f = withColumn(openingFloor({ swing: 'right' }), { x: 1.8, y: 0.7 });
    const doc = mk(f);
    expect(rejection(doc, updateOpening('o1', { swing: 'left' }))).toEqual([]);
    expect(rejection(doc, moveOpening('o1', { offset: 2.05 }))).toEqual([]);
    expect(checkOpening(doc.floor as Floor, doc.floor.openings.o1!)).toEqual([]);
    expect(codes(doc.validatePlacements())).toEqual(['opening-swing-blocked']);
    const add = addOpening({ wall: 'w', preset: 'door-single-01', offset: 0.8 });
    expect(rejection(doc, add)).toEqual([]);
  });
});

describe('an opening that is already flagged', () => {
  const flagged: Array<[string, () => Floor]> = [
    ['opening-out-of-wall', () => openingFloor({ offset: 0.5 })],
    ['opening-overlap', () => withOpening(openingFloor(), 'o2', { offset: 2.5 })],
    ['opening-too-tall', () => openingFloor({ sill: 1.2 })],
    ['opening-hits-column', () => withColumn(openingFloor(), { x: 2 })],
    ['invalid-opening', () => openingFloor({ height: 0 })],
  ];

  describe.each(flagged)('%s', (code, make) => {
    it.each([
      { type: 'door-sliding' },
      { hinge: 'b' },
      { swing: 'right' },
      { leaves: 2 },
      { split: 0.6 },
      { type: 'window-awning', hinge: 'b', swing: 'right', leaves: 3, split: 0.7 },
    ] as const)('can still change %o', (patch) => {
      const doc = mk(make());
      expect(codes(doc.validatePlacements())).toContain(code);
      expect(rejection(doc, updateOpening('o1', patch))).toEqual([]);
      expect(doc.floor.openings.o1).toMatchObject(patch);
    });

    it.each([
      { type: 'door-flying' },
      { hinge: 'c' },
      { swing: 'up' },
      { type: 'door-sliding', leaves: 5 },
      { split: 1 },
    ])('cannot change to %o', (patch) => {
      const doc = mk(make());
      expect(rejection(doc, updateOpening('o1', patch as Partial<Opening>))).toEqual([
        'invalid-opening',
      ]);
    });

    it('is still blocked with any other change', () => {
      const doc = mk(make());
      const cmd = updateOpening('o1', { hinge: 'b', preset: 'other' });
      expect(rejection(doc, cmd)).toContain(code);
    });
  });

  it('a drag through orientations compares with where it started', () => {
    const doc = mk(openingFloor({ sill: 1.2 }));
    const drag = { coalesceKey: 'drag', restart: true };
    for (const hinge of ['b', 'a', 'b'] as const) {
      expect(doc.tryExecute(updateOpening('o1', { hinge }), drag).ok).toBe(true);
    }
  });

  it('loaded with a bad height and sill can be repaired', () => {
    const doc = H3xDocument.fromXML(mk(openingFloor({ height: 0, sill: -1 })).toXML());
    expect(rejection(doc, updateOpening('o1', { height: 2.1, sill: 0 }))).toEqual([]);
    expect(doc.validatePlacements()).toEqual([]);
  });
});

describe('opening values', () => {
  const unsavable = [
    { width: 0 },
    { width: -1 },
    { width: 0.00004 }, // saved as 0
    { width: null },
    { height: 0 },
    { height: -2 },
    { height: 0.00004 },
    { height: null },
    { sill: -0.1 },
    { sill: null },
    { offset: null },
    { preset: null },
    { preset: 7 },
    { wall: ['w'] },
    { type: null },
    { hinge: null },
    { swing: null },
    { leaves: null },
    { leaves: 0 },
    { split: null },
    { split: [0.6] },
    { split: 0.99999 }, // saved as 1
  ];

  it.each(unsavable)('updateOpening stores no %o', (patch) => {
    const doc = mk(openingFloor());
    const xml = doc.toXML();
    expect(rejection(doc, updateOpening('o1', patch as Partial<Opening>))).toContain(
      'invalid-opening',
    );
    expect(doc.toXML()).toBe(xml);
  });

  it.each(
    (['offset', 'width', 'height', 'sill', 'leaves', 'split'] as const).flatMap((key) =>
      [NaN, Infinity].map((value) => [key, value] as const),
    ),
  )('updateOpening stores no %s of %f', (key, value) => {
    const doc = mk(openingFloor());
    const xml = doc.toXML();
    expect(rejection(doc, updateOpening('o1', { [key]: value }))).toEqual(['invalid-number']);
    expect(doc.toXML()).toBe(xml);
  });

  it.each([0, -1, null])('resizeOpening stores no width of %o', (width) => {
    const doc = mk(openingFloor());
    const cmd = resizeOpening('o1', { end: 'a', width: width as number });
    expect(rejection(doc, cmd)).toContain('invalid-opening');
    expect(doc.floor.openings.o1!.width).toBe(1.2);
  });

  const badPresets = [
    [{ type: 'door-flying' }, {}],
    [{ type: null, hinge: 'c' }, {}],
    [{ type: 'door-sliding', leaves: 9 }, {}],
    [{ leaves: 1.5 }, {}],
    [{ type: 'door-double', split: 1 }, {}],
    [{}, { w: 0 }],
    [{}, { w: -0.9 }],
    [{}, { h: 0 }],
    [{}, { h: null }],
  ] as const;

  it.each(badPresets)('preset defaults %o %o are invalid-opening', (opening, size) => {
    const presets = (() => ({
      mount: 'opening',
      footprint: { w: 0.5, d: 0.05, h: 2, ...size },
      opening,
    })) as unknown as PresetResolver;
    for (const make of [
      () => addOpening({ wall: 'w', preset: 'host', offset: 0.5 + 0.2 }),
      () => applyOpeningPreset('o1', 'host'),
    ]) {
      const doc = mk(openingFloor({ offset: 2.5 }), presets);
      const before = structuredClone(doc.floor);
      expect(rejection(doc, make())).toContain('invalid-opening');
      expect(doc.floor).toEqual(before);
    }
  });

  it.each(['c', null, undefined])('an end of %o is invalid-opening', (value) => {
    const end = value as Hinge;
    for (const cmd of [
      resizeOpening('o1', { end, width: 1 }),
      resizeOpening('o1', { end, width: 1.2 }),
      setOpeningDistance('o1', { end, distance: 1, from: 'face' }),
    ]) {
      expect(rejection(mk(openingFloor()), cmd)).toEqual(['invalid-opening']);
    }
  });

  it.each([null, Infinity])('a distance of %o is invalid-opening', (distance) => {
    const cmd = setOpeningDistance('o1', { end: 'a', distance: distance as number, from: 'axis' });
    expect(rejection(mk(openingFloor()), cmd)).toEqual(['invalid-opening']);
  });

  it.each([{ width: NaN }, { height: NaN }, { sill: NaN }])('%o has no closed pose', (bad) => {
    const f = openingFloor({ type: 'window-casement', ...bad });
    expect(openingGeometry(f, f.openings.o1!)!.closed).toEqual([]);
  });

  it('reports a leaf count that cannot be drawn, without drawing it', () => {
    const f = withColumn(openingFloor({ type: 'door-swing', leaves: Infinity }), { x: 2 });
    expect(codes(validatePlacements(f, testPresets))).toEqual(['invalid-opening']);
  });
});

describe('openingRange', () => {
  describe.each([45, 60, 80, 90])('a wall meeting at %i degrees', (deg) => {
    it.each([
      [0.2, 0.2],
      [0.2, 0.35],
      [0.3, 0.1],
    ])('%f thick, met by one %f thick', (own, other) => {
      for (const end of ENDS) {
        for (const mirror of [1, -1]) {
          const f = corner(end, [[mirror * deg, other]], { thickness: own });
          const o = f.openings.o1!;
          const { lo, hi } = openingRange(f, o);
          const near = Math.max(0.1, crossing(deg, own, other)) + 0.45;
          expect(lo).toBeCloseTo(end === 'a' ? near : 0.55, 9);
          expect(hi).toBeCloseTo(end === 'b' ? 4 - near : 3.45, 9);
          for (const offset of [lo, hi]) {
            const at = { ...o, offset };
            expect(checkOpening(f, at)).toEqual([]);
            expect(overlapWithMeeting(f, askedBand(f, at))).toBeLessThanOrEqual(1e-6);
            expect(overlapWithMeeting(f, openingGeometry(f, at)!.cut)).toBeLessThanOrEqual(1e-6);
          }
          const past = { ...o, offset: end === 'a' ? lo - 0.002 : hi + 0.002 };
          expect(codes(checkOpening(f, past))).toEqual(['opening-out-of-wall']);
        }
      }
    });
  });

  it.each([0.1, 0.2, 0.4])('at 90 degrees, met by %f, is what auto-fit uses', (t) => {
    for (const end of ENDS) {
      const f = corner(end, [[90, t]]);
      const range = openingRange(f, f.openings.o1!);
      const fit = openingFitRange(f, f.openings.o1!);
      expect(range.lo).toBeCloseTo(fit.lo, 12);
      expect(range.hi).toBeCloseTo(fit.hi, 12);
    }
  });

  it('is the margin at a free end and before a thicker wall in line', () => {
    const f = corner('b', [[180, 0.4]]);
    const { lo, hi } = openingRange(f, f.openings.o1!);
    expect(lo).toBeCloseTo(0.55, 9);
    expect(hi).toBeCloseTo(3.45, 9);
  });

  it('is empty without the wall or a node of it', () => {
    const f = openingFloor();
    const o = f.openings.o1!;
    expect(inRange(2, openingRange(f, { ...o, wall: 'no' }))).toBe(false);
    delete f.nodes.b;
    expect(inRange(2, openingRange(f, o))).toBe(false);
  });

  it.each(ENDS)('an opening set flush at %s stays valid through save and load', (end) => {
    for (const deg of [20, 45, 60, 73]) {
      const doc = mk(corner(end, [[deg, 0.23]]));
      expect(rejection(doc, setOpeningDistance('o1', { end, distance: 0, from: 'face' }))).toEqual(
        [],
      );
      const again = H3xDocument.fromXML(doc.toXML());
      expect(checkOpening(again.floor as Floor, again.floor.openings.o1!)).toEqual([]);
    }
  });

  it.each([
    ['a', 0.55],
    ['b', 3.45],
  ] as const)('an older file outside it at %s loads as it was and is reported', (end, offset) => {
    const doc = H3xDocument.fromXML(mk(corner(end, [[45, 0.2]], { offset })).toXML());
    const o = doc.floor.openings.o1!;
    expect(o.offset).toBe(offset);
    expect(inRange(o.offset, openingFitRange(doc.floor as Floor, o))).toBe(true);
    expect(codes(doc.validateLayout())).toContain('opening-out-of-wall');
    expect(codes(doc.validatePlacements())).toContain('opening-out-of-wall');
    expect(H3xDocument.fromXML(doc.toXML()).floor.openings.o1!.offset).toBe(offset);
  });

  it('leaves the cut at most the tolerance to take at each end', () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let checked = 0;
    let acute = 0;
    for (let i = 0; i < 300; i++) {
      const end = random() < 0.5 ? 'a' : 'b';
      const arms = Array.from({ length: 1 + Math.floor(random() * 3) }, () => {
        const deg = random() < 0.5 ? 8 + random() * 82 : 90 + random() * 100;
        return [random() < 0.5 ? deg : -deg, 0.05 + random() * 0.4] as [number, number];
      });
      const f = corner(end, arms, { thickness: 0.05 + random() * 0.4 });
      const o = { ...f.openings.o1!, width: 0.3 + random() * 0.6 };
      const { lo, hi } = openingRange(f, o);
      if (hi < lo) continue;
      if (arms.some(([deg]) => Math.abs(deg) < 90)) acute++;
      // The ends, between them, and what the tolerance of the range still lets pass.
      const slack = GEOM_TOL * 0.999;
      for (const offset of [lo, hi, lo + random() * (hi - lo), lo - slack, hi + slack]) {
        const at = { ...o, offset };
        expect(inRange(offset, { lo, hi })).toBe(true);
        const [p0, p1] = openingGeometry(f, at)!.cut;
        const outside = Math.max(lo - offset, offset - hi, 0);
        const allowed = GEOM_TOL + outside + 1e-9;
        expect(p0.x - (offset - o.width / 2), `${i}`).toBeLessThanOrEqual(allowed);
        expect(offset + o.width / 2 - p1.x, `${i}`).toBeLessThanOrEqual(allowed);
        if (outside === 0) {
          expect(overlapWithMeeting(f, askedBand(f, at)), `${i}`).toBeLessThanOrEqual(1e-6);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(acute).toBeGreaterThan(100);
  });
});

// Auto-fit and the split checks keep an opening that half the thickness of a meeting wall allows,
// whatever its angle, or that the outlines allow.
describe('layout edits near a skew corner', () => {
  const skew = (end: Hinge, offset: number) => corner(end, [[45, 0.2]], { offset });
  const draw = (to: Vec2, from: Vec2 = { x: 0, y: 0 }, thickness = 0.2) =>
    addWall({ from: { at: from }, to: { at: to }, thickness });

  function rightAngle(): Floor {
    return corner('a', [[90, 0.2]], { offset: 0.55 });
  }
  function inLine(offset: number): Floor {
    const f = openingFloor({ wall: 'next', width: 0.9, offset });
    addWallTo(f, 'next', 'b', { x: 6, y: 0 });
    addWallTo(f, 'm', 'nextb', { x: 4, y: 2 });
    return f;
  }
  function mergeTarget(): Floor {
    const f = openingFloor({ width: 0.9, offset: 0.9 });
    addWallTo(f, 't', { x: 1, y: 0 }, { x: 3, y: 2 });
    return f;
  }
  function dropTarget(): Floor {
    const f = openingFloor({ width: 0.9, offset: 1.6 });
    addWallTo(f, 't', { x: -1, y: -2 }, { x: 3, y: 2 });
    return f;
  }
  function slid(): Floor {
    const f = skew('b', 3.45);
    addWallTo(f, 'v', 'a', { x: 0, y: 2 });
    return f;
  }

  it.each<[string, () => Floor, () => Command, number]>([
    ['shorter from the far end', () => skew('a', 0.55), () => setWallLength('w', 3), 0.55],
    [
      'shorter from node a',
      () => skew('b', 3.45),
      () => setWallLength('w', 3, { anchor: 'b' }),
      2.45,
    ],
    ['far node moved', () => skew('a', 0.55), () => moveNode('b', { x: 3, y: 0 }), 0.55],
    ['corner made skew', rightAngle, () => moveNode('m0b', { x: 3, y: 3 }), 0.55],
    [
      'skew wall drawn at the end',
      () => openingFloor({ width: 0.9, offset: 0.55 }),
      () => draw({ x: 2, y: 2 }),
      0.55,
    ],
    [
      'skew wall drawn onto it',
      () => openingFloor({ width: 0.9, offset: 1.55 }),
      () => draw({ x: 3, y: 2 }, { x: 1, y: 0 }),
      0.55,
    ],
    ['split', () => skew('a', 0.55), () => splitWall('w', { x: 2.5, y: 0 }), 0.55],
    ['merged', () => inLine(1.45), () => removeNode('b'), 5.45],
    ['node dropped', dropTarget, () => dropNode('a', { wall: 't', at: { x: 1, y: 0 } }), 0.6],
    ['neighbour pushed', slid, () => pushPullWall('v', -1), 2.45],
    [
      // Its outline stops 0.115 from the node, half its thickness is 0.15 and the jamb is at 0.13.
      'a thick wall drawn at an obtuse angle, clear of the jamb',
      () => openingFloor({ width: 0.9, offset: 0.58 }),
      () => draw({ x: -1.5, y: 1.5 * Math.sqrt(3) }, { x: 0, y: 0 }, 0.3),
      0.58,
    ],
  ])('%s: offset as fitted', (_, make, cmd, offset) => {
    const doc = mk(make());
    expect(rejection(doc, cmd())).toEqual([]);
    expect(doc.floor.openings.o1!.offset).toBeCloseTo(offset, 9);
  });

  // Moving node b turns the skew wall to 86.7 degrees: its outline stops 0.1059 from b.
  const nearlySquare =
    2 -
    crossing((Math.acos(0.12132 / Math.hypot(0.12132, 2.12132)) * 180) / Math.PI, 0.2, 0.2) -
    0.45;

  it.each<[string, () => Floor, () => Command, number]>([
    ['shorter into the corner', () => skew('b', 2), () => setWallLength('w', 2), nearlySquare],
    [
      'merged and fitted',
      () => inLine(1.8),
      () => removeNode('b'),
      6 - crossing(45, 0.2, 0.2) - 0.45,
    ],
    ['node merged', mergeTarget, () => mergeNodes('ta', 'a'), crossing(45, 0.2, 0.2) + 0.45],
  ])('%s: moved only as far as it must, to where it is valid', (_, make, cmd, offset) => {
    const doc = mk(make());
    expect(rejection(doc, cmd())).toEqual([]);
    const o = doc.floor.openings.o1!;
    expect(o.offset).toBeCloseTo(offset, 4);
    expect(checkOpening(doc.floor as Floor, o)).toEqual([]);
  });

  it('a wall edit that must move an opening leaves it valid where it can be', () => {
    let seed = 11;
    const random = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let forced = 0;
    for (let i = 0; i < 200; i++) {
      const end = random() < 0.5 ? 'a' : 'b';
      const deg = 15 + random() * 150;
      const f = corner(end, [[random() < 0.5 ? deg : -deg, 0.05 + random() * 0.4]], {
        offset: 0.6 + random() * 2.8,
        thickness: 0.05 + random() * 0.4,
      });
      const doc = mk(f);
      const before = doc.floor.openings.o1!.offset;
      const anchor = random() < 0.5 ? 'a' : 'b';
      const length = 1.2 + random() * 2.6;
      if (rejection(doc, setWallLength('w', length, { anchor })).length > 0) continue;
      const o = doc.floor.openings.o1!;
      const shifted = anchor === 'b' ? before + length - 4 : before;
      const { lo, hi } = openingRange(doc.floor as Floor, o);
      if (Math.abs(o.offset - shifted) < 1e-9 || hi < lo) continue;
      forced++;
      expect(codes(checkOpening(doc.floor as Floor, o)), `${i}`).toEqual([]);
    }
    expect(forced).toBeGreaterThan(30);
  });

  it('an opening at the end the outlines allow before a thicker wall in line stays put', () => {
    // Half the thick wall is 0.2, the margin 0.1: the opening ends 0.1 from the node.
    const doc = mk(corner('b', [[180, 0.4]], { offset: 3.45 }));
    expect(doc.validatePlacements()).toEqual([]);
    expect(rejection(doc, setWallLength('w', 3.8, { anchor: 'b' }))).toEqual([]);
    expect(doc.floor.openings.o1!.offset).toBeCloseTo(3.25, 9); // only shifted with node a
    expect(doc.validatePlacements()).toEqual([]);
  });

  it.each<[string, () => Floor, () => Command]>([
    [
      'a wall drawn 0.05 from the jamb',
      () => openingFloor({ width: 0.9, offset: 1.55 }),
      () => draw({ x: 3.05, y: 2 }, { x: 1.05, y: 0 }),
    ],
    [
      // Its outline stops 0.115 from the node, the jamb is at 0.11.
      'a thick wall drawn at an obtuse angle into the jamb',
      () => openingFloor({ width: 0.9, offset: 0.56 }),
      () => draw({ x: -1.5, y: 1.5 * Math.sqrt(3) }, { x: 0, y: 0 }, 0.3),
    ],
  ])('%s: rejected', (_, make, cmd) => {
    expect(rejection(mk(make()), cmd())).toEqual(['split-cuts-opening']);
  });
});

describe('sample layouts', () => {
  const load = (name: string) =>
    H3xDocument.fromXML(readFileSync(`examples/layouts/${name}`, 'utf8'), { presets: testPresets });

  it('the basement door of townhouse-3f stands clear of the column', () => {
    const doc = load('townhouse-3f.xml');
    expect(doc.floorById('fb')!.openings['d-p1']!.offset).toBe(1.2);
    expect(doc.floorById('f1')!.openings['d-p1']!.offset).toBe(2.5);
  });

  it.each(['nha-ong-4x16.h3x', 'townhouse-3f.xml', 'townhouse-trapezoid.xml'])(
    '%s has no blocking opening issue',
    (name) => {
      const doc = load(name);
      for (const f of doc.project.floors) {
        for (const o of Object.values(f.openings)) {
          expect(checkOpening(f, o), `${f.id}/${o.id}`).toEqual([]);
        }
      }
    },
  );
});
