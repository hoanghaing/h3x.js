// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addColumn,
  moveNode,
  moveWall,
  type ChangeEvent,
  type Floor,
  type Project,
} from '../../src/core';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const mk = (floor: Floor = oneRoomFloor()): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );
const step = { coalesceKey: 'drag', restart: true };
const to = (x: number) => moveNode('n2', { x, y: 0 });

describe('execute with restart', () => {
  it('computes every step from the start of the group', () => {
    const doc = mk();
    const direct = mk();
    for (const x of [1.4, 1.2, 3]) doc.execute(to(x), step);
    direct.execute(to(3));
    expect(doc.floor).toEqual(direct.floor);
  });

  it('takes a relative command as the total since the start', () => {
    const doc = mk();
    for (const d of [0.5, 1, 0.75]) doc.execute(moveWall('w3', { x: 0, y: d }), step);
    expect(doc.floor.nodes.n3!.y).toBeCloseTo(4.75);
  });

  it('back at the start: everything restored, no undo step, the redo stack is back', () => {
    const doc = mk();
    doc.execute(addColumn({ x: 2, y: 2, shape: 'square', width: 0.3, rotation: 0 }));
    doc.undo();
    const before = structuredClone(doc.floor);
    for (const x of [3, 1.2, 3, 4]) doc.execute(to(x), step);
    expect(doc.floor).toEqual(before);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);
  });

  it('is one undo step', () => {
    const doc = mk();
    const before = structuredClone(doc.floor);
    for (const x of [1.2, 2, 3]) doc.execute(to(x), step);
    doc.undo();
    expect(doc.floor).toEqual(before);
    expect(doc.canUndo).toBe(false);
  });

  it('a rejected step keeps the last good state and emits nothing', () => {
    const doc = mk();
    doc.execute(to(3), step);
    const good = structuredClone(doc.floor);
    let events = 0;
    doc.on('change', () => events++);
    expect(doc.tryExecute(to(0.1), step).ok).toBe(false); // too short
    expect(doc.tryExecute(moveNode('none', { x: 0, y: 0 }), step).ok).toBe(false); // throws
    expect(doc.floor).toEqual(good);
    expect(events).toBe(0);
    doc.undo();
    expect(doc.floor.nodes.n2!.x).toBe(4);
  });

  it('emits one event per step, from the shown state to the new one', () => {
    const doc = mk();
    doc.execute(to(3), step);
    const events: ChangeEvent[] = [];
    doc.on('change', (e) => events.push(e));
    doc.execute(to(2), step);
    expect(events).toHaveLength(1);
    const node = events[0]!.changes.find((c) => c.id === 'n2')!;
    expect(node.before).toMatchObject({ x: 3 });
    expect(node.after).toMatchObject({ x: 2 });
  });

  it('does not reach past a sealed group', () => {
    const doc = mk();
    doc.execute(to(3), step);
    doc.endCoalesce();
    doc.execute(moveWall('w3', { x: 0, y: 1 }), step);
    expect(doc.floor.nodes.n2!.x).toBe(3);
  });
});
