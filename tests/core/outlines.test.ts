import { describe, expect, it } from 'vitest';
import {
  checkItem,
  checkOpening,
  circleOverlapArea,
  columnShape,
  itemFootprint,
  validateLayout,
  wallOutlines,
  type Column,
  type FloorItem,
  type Opening,
} from '../../src/core';
import { holedRoomFloor, oneRoomFloor, testPresets } from '../fixtures/floors';

/*
 * Validators measure the same outline the plan draws (src/core/shapes.ts): an object exactly
 * touching another's outline does not overlap, 1 cm in does.
 */

const sofa = (x: number, y: number, id = 'i1'): FloorItem =>
  ({ id, preset: 'sofa-3s-01', mount: 'floor', x, y, rotation: 0 }) as FloorItem; // 2.1 × 0.9
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('outlines: wall (mitred wall outline)', () => {
  it('an item touching a wall face does not hit it; 1 cm in does', () => {
    const f = oneRoomFloor();
    f.openings = {};
    // inner face of w2 at x = 3.9: sofa spans x 1.8 … 3.9
    expect(codes(checkItem(f, sofa(2.85, 2), testPresets))).toEqual([]);
    expect(codes(checkItem(f, sofa(2.86, 2), testPresets))).toEqual(['outside-room', 'hits-wall']);
  });

  it('the outer corner square of a mitred join is wall (drawn and checked alike)', () => {
    const f = oneRoomFloor();
    const corner = wallOutlines(f);
    // the drawn outline of w1 reaches the outer corner (4.1, -0.1)
    expect(
      corner['w1']!.some((p) => Math.abs(p.x - 4.1) < 1e-9 && Math.abs(p.y + 0.1) < 1e-9),
    ).toBe(true);
    const box = { id: 'i2', preset: 'outlet-01', mount: 'floor', x: 4.05, y: -0.05, rotation: 0 };
    const issues = checkItem(f, box as FloorItem, testPresets);
    expect(issues.find((i) => i.code === 'hits-wall')?.ids).toEqual(['i2', 'w1']);
  });
});

describe('outlines: room (inner outline with holes)', () => {
  it('an item touching the inner face is inside; 1 cm over is outside', () => {
    const f = oneRoomFloor();
    f.openings = {};
    expect(codes(checkItem(f, sofa(1.15, 0.55), testPresets))).toEqual([]);
    expect(codes(checkItem(f, sofa(1.14, 0.55), testPresets))).toContain('outside-room');
  });

  it('an item over a room hole is not inside the room', () => {
    const f = holedRoomFloor();
    const lamp = { id: 'i3', preset: 'lamp-01', mount: 'floor', x: 5, y: 5, rotation: 0 };
    expect(codes(checkItem(f, lamp as FloorItem, testPresets))).toEqual(['outside-room']);
    expect(codes(checkItem(f, { ...lamp, x: 2, y: 2 } as FloorItem, testPresets))).toEqual([]);
  });
});

describe('outlines: item (itemFootprint)', () => {
  it('two items touching do not hit; 1 cm overlap does', () => {
    const f = oneRoomFloor();
    f.items = { a: sofa(2, 1.5, 'a') };
    expect(codes(checkItem(f, sofa(2, 2.4, 'b'), testPresets))).toEqual([]);
    expect(codes(checkItem(f, sofa(2, 2.39, 'b'), testPresets))).toEqual(['hits-item']);
  });

  it('a 45° item whose drawn corner touches another item does not hit it; 1 cm in does', () => {
    const f = oneRoomFloor();
    f.openings = {};
    const turned = { ...sofa(1.6, 2, 'a'), rotation: Math.PI / 4 };
    const tip = Math.max(...itemFootprint(turned, f, testPresets)!.map((p) => p.x));
    f.items = { a: turned };
    const bed = (x: number) => ({ ...sofa(x, 2, 'b'), preset: 'bed-01', rotation: Math.PI / 2 });
    // bed-01 rotated 90°: 2.0 along x, so its left edge is x − 1.0
    expect(codes(checkItem(f, bed(tip + 1.0) as FloorItem, testPresets))).not.toContain(
      'hits-item',
    );
    expect(codes(checkItem(f, bed(tip + 0.99) as FloorItem, testPresets))).toContain('hits-item');
  });
});

describe('outlines: column (columnShape)', () => {
  const round = (id: string, x: number, width = 0.3): Column =>
    ({ id, x, y: 2, width, rotation: 0, shape: 'round' }) as Column;
  const square = (id: string, x: number): Column =>
    ({ id, x, y: 2, width: 0.3, rotation: 0, shape: 'square' }) as Column;
  const overlapCodes = (cols: Column[]) => {
    const f = oneRoomFloor();
    f.columns = Object.fromEntries(cols.map((c) => [c.id, c]));
    return codes(validateLayout(f)).filter((c) => c === 'columns-overlap');
  };

  it('round columns touching do not overlap; 2 mm in do (exact circles)', () => {
    expect(overlapCodes([round('a', 1), round('b', 1.3)])).toEqual([]);
    expect(overlapCodes([round('a', 1), round('b', 1.298)])).toEqual(['columns-overlap']);
    const a = columnShape(round('a', 1));
    const b = columnShape(round('b', 1.3));
    if (a.kind !== 'circle' || b.kind !== 'circle') throw new Error('round');
    expect(circleOverlapArea(a, b)).toBe(0);
  });

  it('a round column touching a square one does not overlap; 2 mm in does', () => {
    expect(overlapCodes([square('a', 1), round('b', 1.3)])).toEqual([]);
    expect(overlapCodes([square('a', 1), round('b', 1.298)])).toEqual(['columns-overlap']);
  });
});

describe('outlines: opening (openingSpan)', () => {
  const door = (id: string, offset: number): Opening =>
    ({
      id,
      wall: 'w2',
      preset: 'door-single-01',
      offset,
      width: 0.9,
      height: 2.1,
      sill: 0,
      flip: false,
    }) as Opening;

  it('openings whose drawn gaps touch do not overlap; 1 cm in do', () => {
    const f = oneRoomFloor();
    f.openings = { a: door('a', 1), b: door('b', 1.9) };
    expect(codes(checkOpening(f, f.openings['b']!))).toEqual([]);
    f.openings['b'] = door('b', 1.89);
    expect(codes(checkOpening(f, f.openings['b']!))).toEqual(['opening-overlap']);
  });
});
