import { describe, expect, it } from 'vitest';
import { roofGeometry } from '../../src/core/roofs/geometry';
import { validateRoofs } from '../../src/core/validate/roofs';
import { validateLayout } from '../../src/core/validate/layout';
import { oneRoomFloor } from '../fixtures/floors';
import type { Floor, Roof, Vec2 } from '../../src/core/types';

function floor(): Floor {
  const f = oneRoomFloor();
  f.wallHeight = 3;
  return f;
}

function roof(p: Partial<Roof>): Roof {
  return {
    id: 'R1',
    kind: 'pitched',
    follow: true,
    rooms: ['r1'],
    pitch: 30,
    base: 0,
    overhang: 0.5,
    gableOverhang: 0.3,
    thickness: 0.1,
    material: 'tile',
    ...p,
  };
}

const independent = (points: Vec2[], p: Partial<Roof> = {}): Roof =>
  roof({
    follow: false,
    rooms: undefined,
    points,
    edges: points.map(() => ({ kind: 'slope', pitch: 30 })),
    ...p,
  });

const codes = (f: Floor): string[] => validateRoofs(f).map((i) => i.code);

describe('validateRoofs', () => {
  it('is quiet for a good roof', () => {
    const f = floor();
    f.roofs.R1 = roof({});
    expect(validateRoofs(f)).toEqual([]);
  });

  it('flags a bow-tie outline and falls back to one flat body', () => {
    const f = floor();
    const r = independent([
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      { x: 4, y: 0 },
      { x: 0, y: 4 },
    ]);
    f.roofs.R1 = r;
    expect(validateRoofs(f)).toEqual([
      expect.objectContaining({ code: 'roof-invalid-outline', ids: ['R1'] }),
    ]);
    const g = roofGeometry(r, f);
    expect(g.ok).toBe(false);
    expect(g.bodies).toHaveLength(1);
    expect(g.bodies[0]!.faces).toHaveLength(1);
    expect(g.bodies[0]!.faces[0]!.slope).toBe(false);
  });

  it('flags a hole outside the outline', () => {
    const f = floor();
    f.roofs.R1 = independent(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      {
        holes: [
          [
            { x: 5, y: 5 },
            { x: 5, y: 6 },
            { x: 6, y: 6 },
            { x: 6, y: 5 },
          ],
        ],
      },
    );
    expect(codes(f)).toEqual(['roof-invalid-outline']);
  });

  it('flags a follow roof with no rooms and draws nothing', () => {
    const f = floor();
    const r = roof({ rooms: [] });
    f.roofs.R1 = r;
    expect(codes(f)).toEqual(['roof-no-walls']);
    expect(roofGeometry(r, f).bodies).toEqual([]);
  });

  it('flags an all-gable roof as failed and falls back to flat', () => {
    const f = floor();
    const r = independent(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      { edges: [{ kind: 'gable' }, { kind: 'gable' }, { kind: 'gable' }, { kind: 'gable' }] },
    );
    f.roofs.R1 = r;
    expect(codes(f)).toEqual(['roof-build-failed']);
    const g = roofGeometry(r, f);
    expect(g.ok).toBe(false);
    expect(g.bodies).toHaveLength(1);
    expect(g.bodies[0]!.faces.every((x) => !x.slope && x.polygon.every((p) => p.z === 3))).toBe(
      true,
    );
  });

  it('flat roofs never fail on a valid outline', () => {
    const f = floor();
    f.roofs.R1 = independent(
      [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 },
      ],
      { kind: 'flat', edges: undefined },
    );
    expect(validateRoofs(f)).toEqual([]);
  });

  it('validateLayout includes roof issues', () => {
    const f = floor();
    f.roofs.R1 = roof({ rooms: [] });
    expect(validateLayout(f).map((i) => i.code)).toContain('roof-no-walls');
  });
});
