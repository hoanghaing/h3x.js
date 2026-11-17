// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { addFloor } from '../../src/core/commands/floors';
import { moveColumn } from '../../src/core/commands/columns';
import { validateColumnSupport } from '../../src/core/validate/floors';
import { oneRoomFloor } from '../fixtures/floors';
import type { Floor } from '../../src/core/types';

function floorWith(id: string, level: number, cols: Array<[string, number, number]>): Floor {
  const f = oneRoomFloor();
  f.id = id;
  f.level = level;
  f.elevation = level * 3.15;
  f.columns = Object.fromEntries(
    cols.map(([cid, x, y]) => [cid, { id: cid, x, y, shape: 'square', width: 0.3, rotation: 0 }]),
  ) as never;
  return f;
}

function twoFloorDoc(upperX: number): H3xDocument {
  const base = floorWith('f0', 0, [['c0', 1, 1]]);
  const upper = floorWith('f1', 1, [['c1', upperX, 1]]);
  const doc = H3xDocument.fromProject({
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-11-17T00:00:00Z' },
    floors: [base, upper],
  } as never);
  doc.setActiveFloor('f1');
  return doc;
}

const unsupported = (d: H3xDocument) =>
  d.validateLayout().filter((i) => i.code === 'column-unsupported');

describe('column support warning', () => {
  it('aligned column has no issue', () => {
    expect(unsupported(twoFloorDoc(1))).toEqual([]);
  });

  it('column off by 0.02 m is flagged', () => {
    const issues = unsupported(twoFloorDoc(1.02));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.ids).toEqual(['c1']);
  });

  it('lowest floor has no issue and below undefined returns []', () => {
    const f = floorWith('f0', 0, [['c0', 1, 1]]);
    expect(validateColumnSupport(f, undefined)).toEqual([]);
  });

  it('moving a column off its support still succeeds', () => {
    const d = twoFloorDoc(1);
    expect(() => d.execute(moveColumn('c1', { x: 2 }))).not.toThrow();
    expect(unsupported(d)).toHaveLength(1);
  });

  it('a column-free new floor has no issue', () => {
    const d = twoFloorDoc(1);
    const cmd = addFloor({ position: 'above' });
    d.execute(cmd);
    d.setActiveFloor(cmd.createdId);
    expect(unsupported(d)).toEqual([]);
  });
});
