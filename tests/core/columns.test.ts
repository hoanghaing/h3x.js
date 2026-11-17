// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { addColumn, moveColumn, removeColumn, setSite } from '../../src/core/commands/columns';
import { signedArea } from '../../src/core/geometry/polygon';
import { H3xValidationError } from '../../src/core/errors';
import type { Project } from '../../src/core/types';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const mk = (): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [oneRoomFloor()],
    } as Project,
    { presets: testPresets },
  );

const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as H3xValidationError).issues[0]?.code;
  }
  return undefined;
};

describe('column commands', () => {
  it('addColumn adds with default rotation and undoes', () => {
    const doc = mk();
    const cmd = addColumn({ x: 1, y: 1, shape: 'round', width: 0.3 });
    doc.execute(cmd);
    expect(doc.floor.columns[cmd.createdId]).toMatchObject({ x: 1, y: 1, rotation: 0, width: 0.3 });
    doc.undo();
    expect(doc.floor.columns[cmd.createdId]).toBeUndefined();
  });

  it('fromProject accepts an M3-shaped floor without columns, then addColumn works', () => {
    const floor = oneRoomFloor() as Partial<ReturnType<typeof oneRoomFloor>>;
    delete floor.columns;
    const doc = H3xDocument.fromProject(
      {
        version: 1,
        unit: 'm',
        meta: { name: 't', created: '2026-01-01T00:00:00Z' },
        floors: [floor],
      } as Project,
      { presets: testPresets },
    );
    expect(doc.floor.columns).toEqual({});
    const cmd = addColumn({ x: 1, y: 1, shape: 'round', width: 0.3 });
    doc.execute(cmd);
    expect(doc.floor.columns[cmd.createdId]).toBeDefined();
  });

  it('re-running addColumn is duplicate-id', () => {
    const doc = mk();
    const cmd = addColumn({ x: 1, y: 1, shape: 'square', width: 0.3 });
    doc.execute(cmd);
    expect(code(() => doc.execute(cmd))).toBe('duplicate-id');
  });

  it('rejects width 3 with column-size', () => {
    const doc = mk();
    expect(code(() => doc.execute(addColumn({ x: 1, y: 1, shape: 'round', width: 3 })))).toBe(
      'column-size',
    );
  });

  it('moveColumn patches, undoes, and an empty patch changes nothing', () => {
    const doc = mk();
    const cmd = addColumn({ x: 1, y: 1, shape: 'square', width: 0.3 });
    doc.execute(cmd);
    doc.execute(moveColumn(cmd.createdId, { x: 2, rotation: 0.5 }));
    expect(doc.floor.columns[cmd.createdId]).toMatchObject({ x: 2, y: 1, rotation: 0.5 });
    doc.undo();
    expect(doc.floor.columns[cmd.createdId]!.x).toBe(1);
    doc.execute(moveColumn(cmd.createdId, {}));
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.floor.columns[cmd.createdId]).toBeUndefined();
    expect(doc.canUndo).toBe(false);
  });

  it('moveColumn / removeColumn on a missing id is not-found', () => {
    const doc = mk();
    expect(code(() => doc.execute(moveColumn('nope', { x: 1 })))).toBe('not-found');
    expect(code(() => doc.execute(removeColumn('nope')))).toBe('not-found');
  });

  it('removeColumn removes and undoes; rooms are untouched', () => {
    const doc = mk();
    const rooms = structuredClone(doc.floor.rooms);
    const cmd = addColumn({ x: 1, y: 1, shape: 'round', width: 0.3 });
    doc.execute(cmd);
    expect(doc.floor.rooms).toEqual(rooms);
    doc.execute(removeColumn(cmd.createdId));
    expect(doc.floor.columns[cmd.createdId]).toBeUndefined();
    doc.undo();
    expect(doc.floor.columns[cmd.createdId]).toBeDefined();
    expect(doc.floor.rooms).toEqual(rooms);
  });
});

describe('setSite', () => {
  const cw = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 0 },
  ];

  it('stores CCW, null clears, undo restores the previous site', () => {
    const doc = mk();
    doc.execute(setSite(cw));
    const pts = doc.project.site!.points;
    expect(signedArea(pts)).toBeGreaterThan(0);
    expect(pts).toHaveLength(4);
    doc.execute(setSite(null));
    expect(doc.project.site).toBeUndefined();
    doc.undo();
    expect(doc.project.site!.points).toEqual(pts);
    doc.undo();
    expect(doc.project.site).toBeUndefined();
  });

  it('setSite(null) without a site changes nothing', () => {
    const doc = mk();
    doc.execute(setSite(null));
    expect(doc.canUndo).toBe(false);
  });

  it('rejects < 3 points and non-finite coordinates', () => {
    const doc = mk();
    expect(code(() => doc.execute(setSite(cw.slice(0, 2))))).toBe('site-invalid');
    expect(code(() => doc.execute(setSite([...cw.slice(0, 2), { x: Number.NaN, y: 1 }])))).toBe(
      'site-invalid',
    );
  });
});
