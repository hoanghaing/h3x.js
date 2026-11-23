// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  alignObjects,
  copyObjects,
  moveColumn,
  moveNode,
  moveWall,
  pasteObjects,
  removeObjects,
  removeWall,
  setLocked,
  transformObjects,
  updateOpening,
  type Floor,
  type Project,
} from '../../src/core';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const mk = (floor: Floor): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );

const withColumns = (): Floor => {
  const f = oneRoomFloor();
  f.columns.c1 = { id: 'c1', x: 1, y: 1, shape: 'square', width: 0.3, rotation: 0 };
  f.columns.c2 = { id: 'c2', x: 2.5, y: 2, shape: 'square', width: 0.5, rotation: 0 };
  f.columns.c3 = { id: 'c3', x: 3, y: 3, shape: 'round', width: 0.2, rotation: 0 };
  return f;
};

describe('setLocked', () => {
  it('a locked wall rejects moves, removal and moves of its nodes; unlocking frees it', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(setLocked({ walls: ['w2'] }, true));
    expect(doc.floor.walls.w2!.locked).toBe(true);
    const tries = [
      moveWall('w2', { x: 1, y: 0 }),
      moveNode('n2', { x: 5, y: 0 }),
      removeWall('w2'),
      removeObjects({ walls: ['w2'] }),
      // w1 shares node n2 with w2: moving w1 would move it.
      transformObjects({ walls: ['w1'] }, { kind: 'translate', delta: { x: 0, y: 1 } }),
    ];
    for (const cmd of tries) {
      const res = doc.tryExecute(cmd);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.issues.some((i) => i.code === 'object-locked')).toBe(true);
    }
    // w4 does not touch w2's nodes: it still moves, and w1 can still go.
    expect(doc.tryExecute(moveWall('w4', { x: 0.5, y: 0 })).ok).toBe(true);
    expect(doc.tryExecute(removeObjects({ walls: ['w1'] })).ok).toBe(true);
    doc.undo();
    doc.undo();
    doc.execute(setLocked({ walls: ['w2'] }, false));
    expect(doc.floor.walls.w2!.locked).toBeUndefined();
    expect(doc.tryExecute(moveWall('w2', { x: 1, y: 0 })).ok).toBe(true);
  });

  it('locks columns and openings; a room id locks its walls', () => {
    const doc = mk(withColumns());
    doc.execute(setLocked({ columns: ['c1'], openings: ['o1'], rooms: ['r1'] }, true));
    expect(doc.floor.walls.w1!.locked).toBe(true);
    expect(doc.tryExecute(moveColumn('c1', { x: 2, y: 2 })).ok).toBe(false);
    expect(doc.tryExecute(updateOpening('o1', { offset: 2 })).ok).toBe(false);
    expect(doc.tryExecute(moveColumn('c2', { x: 2, y: 1.5 })).ok).toBe(true);
  });

  it('locking twice or unlocking an unlocked object changes nothing', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(setLocked({ walls: ['w1'] }, false));
    expect(doc.canUndo).toBe(false);
    doc.execute(setLocked({ walls: ['w1'] }, true));
    doc.execute(setLocked({ walls: ['w1'] }, true));
    doc.undo();
    expect(doc.floor.walls.w1!.locked).toBeUndefined();
  });

  it('is saved in XML and read back', () => {
    const doc = mk(withColumns());
    doc.execute(setLocked({ walls: ['w1'], columns: ['c2'], openings: ['o1'] }, true));
    const xml = doc.toXML();
    expect(xml).toContain('locked="true"');
    const back = H3xDocument.fromXML(xml, { presets: testPresets });
    expect(back.floor.walls.w1!.locked).toBe(true);
    expect(back.floor.walls.w2!.locked).toBeUndefined();
    expect(back.floor.columns.c2!.locked).toBe(true);
    expect(back.floor.openings.o1!.locked).toBe(true);
  });

  it('a pasted copy of a locked object is not locked', () => {
    const doc = mk(withColumns());
    doc.execute(setLocked({ columns: ['c1'] }, true));
    const cmd = pasteObjects(copyObjects(doc.floor, { columns: ['c1'] }), {
      kind: 'translate',
      delta: { x: 0, y: 1.5 },
    });
    doc.execute(cmd);
    const id = cmd.created.columns![0]!;
    expect(doc.floor.columns[id]!.locked).toBeUndefined();
  });
});

describe('alignObjects', () => {
  const COLS = { columns: ['c1', 'c2', 'c3'] };
  const x = (doc: H3xDocument, id: string): number => doc.floor.columns[id]!.x;
  const y = (doc: H3xDocument, id: string): number => doc.floor.columns[id]!.y;

  it('lines up left edges, as one undo step', () => {
    const doc = mk(withColumns());
    doc.execute(alignObjects(COLS, 'left'));
    // Left edges: c1 0.85, c2 2.25, c3 2.9 -> all at 0.85.
    expect(x(doc, 'c1')).toBeCloseTo(1, 9);
    expect(x(doc, 'c2')).toBeCloseTo(0.85 + 0.25, 9);
    expect(x(doc, 'c3')).toBeCloseTo(0.85 + 0.1, 9);
    expect(y(doc, 'c2')).toBe(2);
    doc.undo();
    expect(x(doc, 'c2')).toBe(2.5);
  });

  it('lines up tops and centres', () => {
    const doc = mk(withColumns());
    doc.execute(alignObjects(COLS, 'top'));
    for (const id of ['c1', 'c2', 'c3']) {
      const c = doc.floor.columns[id]!;
      expect(c.y + c.width / 2).toBeCloseTo(3.1, 9);
    }
    doc.execute(alignObjects(COLS, 'centerX'));
    // Box x: 0.85 .. 3.1, centre 1.975.
    for (const id of ['c1', 'c2', 'c3']) expect(x(doc, id)).toBeCloseTo(1.975, 9);
  });

  it('skips walls, needs two objects, and leaves aligned ones alone', () => {
    const doc = mk(withColumns());
    doc.execute(alignObjects({ walls: ['w1'], columns: ['c1'] }, 'left'));
    expect(doc.canUndo).toBe(false);
    doc.execute(alignObjects(COLS, 'right'));
    doc.execute(alignObjects(COLS, 'right'));
    expect(x(doc, 'c3')).toBeCloseTo(3, 9);
  });

  it('a locked object stops the whole alignment', () => {
    const doc = mk(withColumns());
    doc.execute(setLocked({ columns: ['c2'] }, true));
    expect(doc.tryExecute(alignObjects(COLS, 'left')).ok).toBe(false);
    expect(x(doc, 'c3')).toBe(3);
  });
});
