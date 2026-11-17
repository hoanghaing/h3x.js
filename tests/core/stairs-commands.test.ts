// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import type { EntityChange } from '../../src/core/document/changes';
import { H3xValidationError } from '../../src/core/errors';
import { addFloor, removeFloor } from '../../src/core/commands/floors';
import { addStair, removeStair, updateStair } from '../../src/core/commands/stairs';
import { oneRoomFloor } from '../fixtures/floors';
import type { Project } from '../../src/core/types';

function doc(): H3xDocument {
  return H3xDocument.fromProject({
    version: 1,
    unit: 'm',
    meta: { name: '', created: '' },
    floors: [oneRoomFloor()],
  });
}
const snap = (d: H3xDocument): Project => structuredClone(d.project) as Project;
const base = { x: 1, y: 1, width: 2, depth: 4 };

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof H3xValidationError ? e.issues[0]!.code : 'other';
  }
  return undefined;
}

describe('stair commands', () => {
  it('addStair applies defaults and stamps floorId', () => {
    const d = doc();
    const changes: EntityChange[] = [];
    d.on('change', (e) => changes.push(...e.changes));
    const cmd = addStair(base);
    d.execute(cmd);
    expect(d.floor.stairs[cmd.createdId]).toEqual({
      id: cmd.createdId,
      ...base,
      rotation: 0,
      type: 'U',
      turn: 'landing',
      hand: 'right',
      flightWidth: 0.9,
    });
    expect(changes[0]).toMatchObject({ kind: 'stair', floorId: 'f1', before: null });
  });

  it('updateStair is one undo step and a no-op when unchanged', () => {
    const d = doc();
    const cmd = addStair(base);
    d.execute(cmd);
    const before = snap(d);
    d.execute(updateStair(cmd.createdId, { type: 'L' }));
    expect(d.floor.stairs[cmd.createdId]!.type).toBe('L');
    d.undo();
    expect(d.project).toEqual(before);
    expect(
      updateStair(cmd.createdId, { type: 'U' }).run({
        floor: d.floor,
        floorId: 'f1',
        project: d.project,
      }),
    ).toEqual([]);
  });

  it('removeStair + undo restores', () => {
    const d = doc();
    const cmd = addStair(base);
    d.execute(cmd);
    const before = snap(d);
    d.execute(removeStair(cmd.createdId));
    expect(d.floor.stairs).toEqual({});
    d.undo();
    expect(d.project).toEqual(before);
  });

  it('validates params', () => {
    const d = doc();
    expect(codeOf(() => d.execute(addStair({ ...base, width: 1.6, flightWidth: 0.9 })))).toBe(
      'invalid-stair',
    );
    expect(codeOf(() => d.execute(addStair({ ...base, type: 'L', flightWidth: 2.5 })))).toBe(
      'invalid-stair',
    );
    expect(codeOf(() => d.execute(addStair({ ...base, depth: 0 })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(addStair({ ...base, type: 'spiral', flightWidth: 9 })))).toBe(
      undefined,
    );
    const cmd = addStair(base);
    d.execute(cmd);
    expect(codeOf(() => d.execute(updateStair(cmd.createdId, { width: 1 })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(removeStair('nope')))).toBe('not-found');
  });

  it('addFloor copies stairs with fresh ids; removeFloor + undo restores', () => {
    const d = doc();
    const cmd = addStair({ ...base, type: 'L', turn: 'winder', hand: 'left', rotation: 1 });
    d.execute(cmd);
    const add = addFloor({ position: 'above' });
    d.execute(add);
    const nf = d.project.floors.find((f) => f.id === add.createdId)!;
    const copies = Object.values(nf.stairs);
    expect(copies).toHaveLength(1);
    expect(copies[0]!.id).not.toBe(cmd.createdId);
    expect(copies[0]).toEqual({ ...d.floor.stairs[cmd.createdId]!, id: copies[0]!.id });
    const before = snap(d);
    d.execute(removeFloor(add.createdId));
    expect(d.project.floors).toHaveLength(1);
    d.undo();
    expect(d.project).toEqual(before);
  });
});
