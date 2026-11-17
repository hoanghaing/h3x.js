// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import type { EntityChange } from '../../src/core/document/changes';
import { H3xValidationError } from '../../src/core/errors';
import { addFloor, removeFloor } from '../../src/core/commands/floors';
import { addStair, removeStair, updateStair } from '../../src/core/commands/stairs';
import { oneRoomFloor } from '../fixtures/floors';
import type { Project, Stair } from '../../src/core/types';
import { layoutStair } from '../../src/core/stairs/layout';

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
  it('addStair ignores undefined keys and stores the defaults', () => {
    const d = doc();
    const cmd = addStair({ ...base, type: undefined, rotation: undefined });
    d.execute(cmd);
    expect(d.floor.stairs[cmd.createdId]).toMatchObject({ type: 'U', rotation: 0 });
  });

  it('rejects an unknown type / turn / hand and a non-finite position or rotation', () => {
    const d = doc();
    const cmd = addStair(base);
    d.execute(cmd);
    const id = cmd.createdId;
    expect(codeOf(() => d.execute(updateStair(id, { type: 'u' as never })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(updateStair(id, { turn: 'x' as never })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(updateStair(id, { hand: 'up' as never })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(updateStair(id, { rotation: NaN })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(updateStair(id, { x: Infinity })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(addStair({ ...base, rotation: NaN })))).toBe('invalid-stair');
  });

  it('fromProject rejects an invalid stair like fromXML does', () => {
    const floor = oneRoomFloor();
    floor.stairs = {
      s1: {
        id: 's1',
        x: 0,
        y: 0,
        width: 2,
        depth: 4,
        rotation: 0,
        type: 'U',
        turn: 'landing',
        hand: 'right',
        flightWidth: 1.1,
      },
    };
    const p: Project = { version: 1, unit: 'm', meta: { name: '', created: '' }, floors: [floor] };
    expect(codeOf(() => H3xDocument.fromProject(p))).toBe('invalid-stair');
    floor.stairs.s1!.flightWidth = 0.9;
    expect(codeOf(() => H3xDocument.fromProject(p))).toBeUndefined();
  });

  it('every stair the commands accept round-trips through XML', () => {
    const d = doc();
    for (const type of ['straight', 'L', 'U', 'spiral'] as const) {
      for (const turn of ['landing', 'winder'] as const) {
        for (const hand of ['left', 'right'] as const) {
          d.execute(
            addStair({
              x: 1.25,
              y: -0.5,
              width: 2.4,
              depth: 3.5,
              rotation: 0.5,
              type,
              turn,
              hand,
              flightWidth: 1,
            }),
          );
        }
      }
    }
    d.execute(addStair(base));
    expect(Object.keys(d.floor.stairs)).toHaveLength(17);
    const back = H3xDocument.fromXML(d.toXML());
    expect(back.project).toEqual(d.project);
  });
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

  it('a spiral still needs a finite positive flightWidth, with no relation to the width', () => {
    const d = doc();
    const spiral = { ...base, type: 'spiral' as const };
    expect(codeOf(() => d.execute(addStair({ ...spiral, flightWidth: 0 })))).toBe('invalid-stair');
    expect(codeOf(() => d.execute(addStair({ ...spiral, flightWidth: NaN })))).toBe(
      'invalid-stair',
    );
    expect(codeOf(() => d.execute(addStair({ ...spiral, flightWidth: 50 })))).toBe(undefined);
  });

  it('flightWidth may exceed the width (half for U) by the XML rounding of 1e-4, not more', () => {
    const d = doc();
    const w = base.width;
    const ok = (over: Partial<Stair>) => codeOf(() => d.execute(addStair({ ...base, ...over })));
    expect(ok({ type: 'straight', flightWidth: w + 0.6e-4 })).toBe(undefined);
    expect(ok({ type: 'straight', flightWidth: w + 2e-4 })).toBe('invalid-stair');
    expect(ok({ type: 'U', flightWidth: w / 2 + 0.6e-4 })).toBe(undefined);
    expect(ok({ type: 'U', flightWidth: w / 2 + 2e-4 })).toBe('invalid-stair');
  });

  it('a flight wider than the bay within the tolerance lays out like a full-width flight', () => {
    const s = { id: 's', rotation: 0, turn: 'landing', hand: 'right', ...base, depth: 5 } as Stair;
    const full = layoutStair({ ...s, type: 'straight', flightWidth: s.width }, 3.35);
    const over = layoutStair({ ...s, type: 'straight', flightWidth: s.width + 0.6e-4 }, 3.35);
    expect(full.ok).toBe(true);
    expect(over).toEqual(full);
    const halfU = layoutStair({ ...s, type: 'U', flightWidth: s.width / 2 + 0.6e-4 }, 3.35);
    expect(halfU).toEqual(layoutStair({ ...s, type: 'U', flightWidth: s.width / 2 }, 3.35));
  });

  it('updateStair ignores keys whose value is undefined', () => {
    const d = doc();
    const cmd = addStair(base);
    d.execute(cmd);
    const before = structuredClone(d.floor.stairs[cmd.createdId]!);
    const res = d.tryExecute(updateStair(cmd.createdId, { flightWidth: undefined, x: undefined }));
    expect(res.ok).toBe(true);
    expect(d.floor.stairs[cmd.createdId]).toEqual(before);
    d.execute(updateStair(cmd.createdId, { flightWidth: 1.0, turn: undefined }));
    expect(d.floor.stairs[cmd.createdId]).toEqual({ ...before, flightWidth: 1.0 });
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
