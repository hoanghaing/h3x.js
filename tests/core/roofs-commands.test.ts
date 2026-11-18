// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { H3xValidationError } from '../../src/core/errors';
import { addWall, splitWall } from '../../src/core/commands/structure';
import {
  addRoof,
  detachRoof,
  fitRoofToWalls,
  removeRoof,
  setRoofEdge,
  updateRoof,
  validateRoofParams,
} from '../../src/core/commands/roofs';
import { formatRoofEdge, parseRoofEdge } from '../../src/core/roofs/edges';
import { ROOF_PRESETS, presetEdges, presetWallEdges } from '../../src/core/roofs/presets';
import { floorOutline } from '../../src/core/floors/outline';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';
import { courtyardFloor } from '../fixtures/irregular';
import type { Floor, Roof } from '../../src/core/types';

function doc(floor: Floor = twoRoomFloor()): H3xDocument {
  return H3xDocument.fromProject({
    version: 1,
    unit: 'm',
    meta: { name: '', created: '' },
    floors: [floor],
  });
}

/** Two separate one-room buildings: r1 at the origin, rb 10 m to the right. */
function twoBuildings(): Floor {
  const a = oneRoomFloor();
  a.openings = {};
  const f = structuredClone(a);
  for (const n of Object.values(a.nodes)) {
    f.nodes[`b${n.id}`] = { id: `b${n.id}`, x: n.x + 10, y: n.y };
  }
  for (const w of Object.values(a.walls)) {
    f.walls[`b${w.id}`] = { ...w, id: `b${w.id}`, a: `b${w.a}`, b: `b${w.b}` };
  }
  f.rooms.rb = { id: 'rb', name: '', walls: ['bw1', 'bw2', 'bw3', 'bw4'] };
  return f;
}

const codeOf = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof H3xValidationError ? e.issues[0]!.code : 'other';
  }
  return undefined;
};

const rect = (w: number, h: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const sample = (): Roof => ({
  id: 'x',
  kind: 'pitched',
  follow: true,
  rooms: [],
  pitch: 30,
  base: 0,
  overhang: 0.5,
  gableOverhang: 0.3,
  thickness: 0.1,
  material: 'tile',
});

describe('roof edge grammar', () => {
  it('parses and formats gable, slope and broken slope', () => {
    expect(parseRoofEdge('gable')).toEqual({ kind: 'gable' });
    expect(parseRoofEdge('slope:35')).toEqual({ kind: 'slope', pitch: 35 });
    expect(parseRoofEdge('slope:70/1.5/30')).toEqual({
      kind: 'slope',
      pitch: 70,
      breakHeight: 1.5,
      upperPitch: 30,
    });
    for (const s of ['gable', 'slope:35', 'slope:70/1.5/30']) {
      expect(formatRoofEdge(parseRoofEdge(s))).toBe(s);
    }
  });

  it('throws on bad grammar', () => {
    const bad = [
      '',
      'hip',
      'slope:',
      'slope:0',
      'slope:90',
      'slope:x',
      'slope:30/1',
      'slope:30/0/20',
      'slope:30/1/95',
    ];
    for (const s of bad) expect(() => parseRoofEdge(s), s).toThrow(Error);
  });
});

describe('roof presets', () => {
  it('holds the spec values', () => {
    expect(ROOF_PRESETS.thai).toMatchObject({
      shape: 'hip',
      pitch: 35,
      overhang: 0.8,
      material: 'tile',
    });
    expect(ROOF_PRESETS.mansard).toMatchObject({ pitch: 70, breakHeight: 1.5, upperPitch: 30 });
    expect(ROOF_PRESETS.flat).toMatchObject({ shape: 'flat', parapet: 1.1, material: 'concrete' });
    expect(ROOF_PRESETS['glass-frame']).toMatchObject({ supports: 'posts', thickness: 0.02 });
  });

  it('gable preset: the two 6 m sides slope, the 4 m ends are gables', () => {
    const e = presetEdges('gable', rect(6, 4));
    expect(e.map((x) => x.kind)).toEqual(['slope', 'gable', 'slope', 'gable']);
  });

  it('shed preset: one slope on a 6 m edge', () => {
    const e = presetEdges('shed', rect(6, 4));
    expect(e.filter((x) => x.kind === 'slope')).toHaveLength(1);
    expect(e[0]!.kind).toBe('slope');
  });

  it('hip preset: all slope at the preset pitch, with the break for mansard', () => {
    expect(presetEdges('thai', rect(6, 4))).toEqual(Array(4).fill({ kind: 'slope', pitch: 35 }));
    expect(presetEdges('mansard', rect(6, 4))[0]).toEqual({
      kind: 'slope',
      pitch: 70,
      breakHeight: 1.5,
      upperPitch: 30,
    });
  });

  it('gable on a split outline: the long sides slope even where interior walls cut them', () => {
    const m = presetWallEdges('gable', floorOutline(twoRoomFloor())[0]!);
    const kinds = (ids: string[]): string[] => ids.map((w) => m[w]!.kind);
    expect(kinds(['w1', 'w2', 'w4', 'w5'])).toEqual(['slope', 'slope', 'slope', 'slope']);
    expect(
      Object.keys(m)
        .filter((w) => m[w]!.kind === 'gable')
        .sort(),
    ).toEqual(['w3', 'w6']);
  });

  it('shed on a split outline: both pieces of one long side slope, the rest gable', () => {
    const m = presetWallEdges('shed', floorOutline(twoRoomFloor())[0]!);
    const sloped = Object.keys(m)
      .filter((w) => m[w]!.kind === 'slope')
      .sort();
    expect(sloped.join()).toMatch(/^(w1,w2|w4,w5)$/);
  });

  it('presetEdges treats a side split by a collinear vertex as one', () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 4.1 },
      { x: 0, y: 4.1 },
    ];
    expect(presetEdges('gable', ring).map((e) => e.kind)).toEqual([
      'slope',
      'slope',
      'gable',
      'slope',
      'gable',
    ]);
    expect(presetEdges('shed', ring).map((e) => e.kind)).toEqual([
      'slope',
      'slope',
      'gable',
      'gable',
      'gable',
    ]);
  });

  it('presetWallEdges maps ring edges to walls', () => {
    const ring = floorOutline(oneRoomFloor())[0]!;
    const m = presetWallEdges('gable', ring);
    expect(Object.keys(m).sort()).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(
      Object.values(m)
        .map((x) => x.kind)
        .sort(),
    ).toEqual(['gable', 'gable', 'slope', 'slope']);
  });
});

describe('validateRoofParams', () => {
  it('accepts a follow roof with no rooms', () => {
    expect(validateRoofParams(sample())).toEqual([]);
  });

  it('rejects bad values with invalid-roof', () => {
    const bad: Partial<Roof>[] = [
      { rooms: undefined },
      { pitch: 95 },
      { pitch: NaN },
      { overhang: -1 },
      { thickness: 0 },
      { material: 'wood' as never },
      { supports: 'beams' as never },
      { kind: 'dome' as never },
      { follow: false, points: rect(1, 1).slice(0, 2), edges: [] },
      { follow: false, points: rect(2, 2), edges: [{ kind: 'gable' }] },
      {
        follow: false,
        points: rect(2, 2),
        edges: Array(4).fill({ kind: 'gable' }),
        holes: [rect(1, 1)],
        holeEdges: [[{ kind: 'gable' }]],
      },
    ];
    for (const b of bad) {
      const issues = validateRoofParams({ ...sample(), ...b });
      expect(issues.length, JSON.stringify(b)).toBeGreaterThan(0);
      expect(issues[0]!.code).toBe('invalid-roof');
    }
  });
});

describe('roof commands', () => {
  it('addRoof with a preset applies its values; undo removes it', () => {
    const d = doc();
    const cmd = addRoof({ preset: 'thai', follow: true, rooms: ['r1'] });
    d.execute(cmd);
    expect(d.floor.roofs[cmd.createdId]).toMatchObject({
      kind: 'pitched',
      follow: true,
      pitch: 35,
      overhang: 0.8,
      material: 'tile',
      preset: 'thai',
      rooms: ['r1'],
    });
    d.undo();
    expect(d.floor.roofs[cmd.createdId]).toBeUndefined();
  });

  it('explicit input overrides the preset; the flat preset makes a flat roof', () => {
    const d = doc();
    const c = addRoof({ preset: 'flat', overhang: 0.2, rooms: ['r1'] });
    d.execute(c);
    expect(d.floor.roofs[c.createdId]).toMatchObject({ kind: 'flat', overhang: 0.2, parapet: 1.1 });
  });

  it('a gable preset on a follow roof stores the gable walls', () => {
    const d = doc(oneRoomFloor());
    const c = addRoof({ preset: 'gable', rooms: ['r1'] });
    d.execute(c);
    const we = d.floor.roofs[c.createdId]!.wallEdges!;
    expect(Object.values(we).every((e) => e.kind === 'gable')).toBe(true);
    expect(Object.keys(we)).toHaveLength(2);
  });

  it('an independent preset roof gets edges from presetEdges', () => {
    const d = doc();
    const c = addRoof({ preset: 'gable', points: rect(6, 4) });
    d.execute(c);
    const r = d.floor.roofs[c.createdId]!;
    expect(r.follow).toBe(false);
    expect(r.edges!.map((e) => e.kind)).toEqual(['slope', 'gable', 'slope', 'gable']);
  });

  it('rejects mismatched edges with invalid-roof and changes nothing', () => {
    const d = doc();
    const code = codeOf(() =>
      d.execute(
        addRoof({
          follow: false,
          points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 3 },
          ],
          edges: [{ kind: 'gable' }, { kind: 'gable' }],
        }),
      ),
    );
    expect(code).toBe('invalid-roof');
    expect(Object.keys(d.floor.roofs)).toHaveLength(0);
  });

  it('updateRoof patches and validates', () => {
    const d = doc();
    const c = addRoof({ rooms: ['r1'] });
    d.execute(c);
    d.execute(updateRoof(c.createdId, { pitch: 40, material: 'metal' }));
    expect(d.floor.roofs[c.createdId]).toMatchObject({ pitch: 40, material: 'metal' });
    expect(codeOf(() => d.execute(updateRoof(c.createdId, { pitch: 100 })))).toBe('invalid-roof');
    expect(codeOf(() => d.execute(updateRoof('nope', { pitch: 40 })))).toBe('not-found');
  });

  it('removeRoof removes and undo restores', () => {
    const d = doc();
    const c = addRoof({ rooms: ['r1'] });
    d.execute(c);
    d.execute(removeRoof(c.createdId));
    expect(d.floor.roofs[c.createdId]).toBeUndefined();
    d.undo();
    expect(d.floor.roofs[c.createdId]).toBeDefined();
  });

  it('setRoofEdge sets wallEdges for a wall; a split gives both halves the override', () => {
    const d = doc();
    const c = addRoof({ rooms: ['r1', 'r2'] });
    d.execute(c);
    d.execute(setRoofEdge(c.createdId, { wallId: 'w2' }, { kind: 'gable' }));
    expect(d.floor.roofs[c.createdId]!.wallEdges).toEqual({ w2: { kind: 'gable' } });
    d.execute(splitWall('w2', { x: 6, y: 0 }));
    const we = d.floor.roofs[c.createdId]!.wallEdges!;
    expect(Object.keys(we)).toHaveLength(2);
    expect(Object.values(we).every((e) => e.kind === 'gable')).toBe(true);
    d.undo();
    expect(Object.keys(d.floor.roofs[c.createdId]!.wallEdges!)).toEqual(['w2']);
  });

  it('a wall added across an overridden wall splits it and keeps the override', () => {
    const d = doc();
    const c = addRoof({ rooms: ['r1', 'r2'], wallEdges: { w2: { kind: 'gable' } } });
    d.execute(c);
    d.execute(
      addWall({ from: { at: { x: 6, y: -1 } }, to: { at: { x: 6, y: 1 } }, thickness: 0.1 }),
    );
    expect(Object.keys(d.floor.roofs[c.createdId]!.wallEdges!)).toHaveLength(2);
  });

  it('setRoofEdge by index on an independent roof, holes included', () => {
    const d = doc();
    const c = addRoof({
      points: rect(6, 4),
      edges: Array(4).fill({ kind: 'slope', pitch: 30 }),
      holes: [
        [
          { x: 2, y: 1 },
          { x: 2, y: 3 },
          { x: 4, y: 3 },
          { x: 4, y: 1 },
        ],
      ],
    });
    d.execute(c);
    d.execute(setRoofEdge(c.createdId, { index: 1 }, { kind: 'gable' }));
    d.execute(setRoofEdge(c.createdId, { index: 2, hole: 0 }, { kind: 'gable' }));
    const r = d.floor.roofs[c.createdId]!;
    expect(r.edges![1]!.kind).toBe('gable');
    expect(r.holeEdges![0]!.map((e) => e.kind)).toEqual(['slope', 'slope', 'gable', 'slope']);
    const g = { kind: 'gable' } as const;
    expect(codeOf(() => d.execute(setRoofEdge(c.createdId, { index: 9 }, g)))).toBe('invalid-roof');
    expect(codeOf(() => d.execute(setRoofEdge(c.createdId, { wallId: 'w1' }, g)))).toBe(
      'invalid-roof',
    );
  });

  it('detachRoof over two rooms: 6 points, 6 edges, one undo step restores follow', () => {
    const d = doc();
    const c = addRoof({ rooms: ['r1', 'r2'], wallEdges: { w2: { kind: 'gable' } } });
    d.execute(c);
    const det = detachRoof(c.createdId);
    d.execute(det);
    const r = d.floor.roofs[c.createdId]!;
    expect(r.follow).toBe(false);
    expect(r.points).toHaveLength(6);
    expect(r.edges).toHaveLength(6);
    expect(r.edges!.filter((e) => e.kind === 'gable')).toHaveLength(1);
    expect(r.rooms).toBeUndefined();
    expect(r.wallEdges).toBeUndefined();
    expect(det.newIds).toEqual([]);
    d.undo();
    expect(d.floor.roofs[c.createdId]).toMatchObject({ follow: true, rooms: ['r1', 'r2'] });
  });

  it('detachRoof over two separate buildings splits off a second roof', () => {
    const d = doc(twoBuildings());
    const c = addRoof({ rooms: ['r1', 'rb'], pitch: 20 });
    d.execute(c);
    const det = detachRoof(c.createdId);
    d.execute(det);
    expect(det.newIds).toHaveLength(1);
    const other = d.floor.roofs[det.newIds[0]!]!;
    expect(other).toMatchObject({ follow: false, pitch: 20 });
    expect(other.points).toHaveLength(4);
    expect(d.floor.roofs[c.createdId]!.points).toHaveLength(4);
    d.undo();
    expect(Object.keys(d.floor.roofs)).toEqual([c.createdId]);
  });

  it('detachRoof gives a courtyard hole to the outer ring that contains it', () => {
    const floor = courtyardFloor();
    const d = doc(floor);
    const c = addRoof({ rooms: Object.keys(floor.rooms) });
    d.execute(c);
    d.execute(detachRoof(c.createdId));
    const r = d.floor.roofs[c.createdId]!;
    expect(r.points).toHaveLength(4);
    expect(r.holes).toHaveLength(1);
    expect(r.holeEdges![0]).toHaveLength(r.holes![0]!.length);
  });

  it('fitRoofToWalls after detach round-trips the gable override', () => {
    const d = doc();
    const c = addRoof({ rooms: ['r1', 'r2'], wallEdges: { w2: { kind: 'gable' } } });
    d.execute(c);
    d.execute(detachRoof(c.createdId));
    d.execute(fitRoofToWalls(c.createdId));
    const r = d.floor.roofs[c.createdId]!;
    expect(r.follow).toBe(true);
    expect(r.wallEdges).toEqual({ w2: { kind: 'gable' } });
    expect([...r.rooms!].sort()).toEqual(['r1', 'r2']);
    expect(r.points).toBeUndefined();
    expect(r.edges).toBeUndefined();
  });

  it('fitRoofToWalls takes explicit rooms; unmapped edges are lost', () => {
    const d = doc();
    const c = addRoof({ points: rect(3, 3), edges: Array(4).fill({ kind: 'gable' }) });
    d.execute(c);
    d.execute(fitRoofToWalls(c.createdId, ['r1']));
    expect(d.floor.roofs[c.createdId]).toMatchObject({ follow: true, rooms: ['r1'] });
    expect(d.floor.roofs[c.createdId]!.wallEdges).toBeUndefined();
  });

  it('fromProject rejects an invalid roof with invalid-roof', () => {
    const f = twoRoomFloor();
    f.roofs.bad = { ...sample(), id: 'bad', pitch: 95 };
    expect(codeOf(() => doc(f))).toBe('invalid-roof');
  });
});
