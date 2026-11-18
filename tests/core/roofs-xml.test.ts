// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xParseError } from '../../src/core/errors';
import { projectFromXML } from '../../src/core/xml/parse';
import { projectToXML } from '../../src/core/xml/serialize';
import { twoRoomFloor } from '../fixtures/floors';
import type { Project, Roof } from '../../src/core/types';

const roof = (over: Partial<Roof> & { id: string }): Roof => ({
  kind: 'pitched',
  follow: true,
  rooms: ['r1'],
  pitch: 30,
  base: 0,
  overhang: 0.5,
  gableOverhang: 0.3,
  thickness: 0.1,
  material: 'tile',
  ...over,
});

function project(roofs: Roof[]): Project {
  const f = twoRoomFloor();
  for (const r of roofs) f.roofs[r.id] = r;
  return {
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors: [f],
  };
}

const outer = [
  { x: 0, y: 0 },
  { x: 6, y: 0 },
  { x: 6, y: 4 },
  { x: 0, y: 4 },
];
const hole = [
  { x: 2, y: 1 },
  { x: 2, y: 3 },
  { x: 4, y: 3 },
  { x: 4, y: 1 },
];

describe('roof XML', () => {
  it('round-trips follow, independent (holes), flat and glass roofs', () => {
    const p = project([
      roof({
        id: 'a',
        preset: 'thai',
        rooms: ['r1', 'r2'],
        pitch: 35,
        overhang: 0.8,
        wallEdges: {
          w2: { kind: 'gable' },
          w5: { kind: 'slope', pitch: 70, breakHeight: 1.5, upperPitch: 30 },
        },
      }),
      roof({
        id: 'b',
        follow: false,
        rooms: undefined,
        points: outer,
        holes: [hole],
        edges: [
          { kind: 'slope', pitch: 70, breakHeight: 1.5, upperPitch: 30 },
          { kind: 'gable' },
          { kind: 'slope', pitch: 20 },
          { kind: 'gable' },
        ],
        holeEdges: [Array(4).fill({ kind: 'slope', pitch: 30 })],
        base: 0.2,
        gableOverhang: 0.4,
      }),
      roof({
        id: 'c',
        kind: 'flat',
        rooms: ['r2'],
        parapet: 1.1,
        material: 'concrete',
        overhang: 0,
        thickness: 0.12,
      }),
      roof({
        id: 'd',
        follow: false,
        rooms: undefined,
        points: outer,
        edges: Array(4).fill({ kind: 'slope', pitch: 10 }),
        material: 'glass',
        supports: 'posts',
        postSize: 0.12,
        postSpacing: 2.5,
        thickness: 0.02,
      }),
    ]);
    // Drop undefined keys so toStrictEqual compares real shapes.
    const clean = JSON.parse(JSON.stringify(p)) as Project;
    expect(projectFromXML(projectToXML(clean))).toEqual(clean);
  });

  it('writes follow roofs with rooms and omits defaults', () => {
    const xml = projectToXML(project([roof({ id: 'a', wallEdges: { w2: { kind: 'gable' } } })]));
    expect(xml).toContain(
      '<roof id="a" kind="pitched" follow="1" rooms="r1" wallEdges="w2:gable"/>',
    );
  });

  it('pitch outside (0, 90) is a parse error on the roof element', () => {
    const xml = projectToXML(project([roof({ id: 'a' })])).replace(
      '<roof id="a"',
      '<roof id="a" pitch="95"',
    );
    try {
      projectFromXML(xml);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(H3xParseError);
      expect((e as H3xParseError).element).toBe('roof');
    }
  });

  it('an edges count that differs from points is a parse error', () => {
    const p = project([
      roof({
        id: 'a',
        follow: false,
        rooms: undefined,
        points: outer,
        edges: Array(4).fill({ kind: 'gable' }),
      }),
    ]);
    const xml = projectToXML(p).replace('edges="gable gable gable gable"', 'edges="gable gable"');
    expect(() => projectFromXML(xml)).toThrow(H3xParseError);
  });

  it('malformed edge specs and unknown kinds are parse errors', () => {
    const base = projectToXML(project([roof({ id: 'a', wallEdges: { w2: { kind: 'gable' } } })]));
    expect(() => projectFromXML(base.replace('w2:gable', 'w2:slope:abc'))).toThrow(H3xParseError);
    expect(() => projectFromXML(base.replace('kind="pitched"', 'kind="dome"'))).toThrow(
      H3xParseError,
    );
  });

  it('wallEdges and rooms naming something missing are dropped on save', () => {
    const p = project([
      roof({
        id: 'a',
        rooms: ['r1', 'ghost'],
        wallEdges: { w2: { kind: 'gable' }, gone: { kind: 'gable' } },
      }),
    ]);
    const back = projectFromXML(projectToXML(p));
    expect(back.floors[0]!.roofs.a).toMatchObject({
      rooms: ['r1'],
      wallEdges: { w2: { kind: 'gable' } },
    });
    expect(Object.keys(back.floors[0]!.roofs.a!.wallEdges!)).toEqual(['w2']);
  });
});
