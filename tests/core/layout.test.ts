// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { moveNode, moveWall, setWallLength } from '../../src/core/commands/layout';
import { H3xValidationError } from '../../src/core/errors';
import { roomArea } from '../../src/core/rooms/detect';
import type { Floor, Project } from '../../src/core/types';
import { oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';

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

describe('layout commands', () => {
  it('moveNode reshapes rooms', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(moveNode('n3', { x: 5, y: 4 }));
    expect(roomArea(doc.floor as Floor, doc.floor.rooms.r1!, 'center')).toBeCloseTo(18);
  });

  it('moveWall moves both nodes along normal', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(moveWall('w2', { x: 1, y: 0.7 }));
    const n = doc.floor.nodes;
    expect(n.n2!.x).toBeCloseTo(5);
    expect(n.n3!.x).toBeCloseTo(5);
    expect(n.n2!.y).toBeCloseTo(0);
    expect(n.n3!.y).toBeCloseTo(4);
  });

  it('setWallLength keeps a fixed', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(setWallLength('w1', 5));
    expect(doc.floor.nodes.n1).toMatchObject({ x: 0, y: 0 });
    expect(doc.floor.nodes.n2!.x).toBeCloseTo(5);
    expect(doc.floor.nodes.n2!.y).toBeCloseTo(0);
  });

  it('setWallLength below minimum throws', () => {
    const doc = mk(oneRoomFloor());
    try {
      doc.execute(setWallLength('w1', 0.2));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(H3xValidationError);
      expect((e as H3xValidationError).issues[0]!.code).toBe('wall-too-short');
    }
  });

  it('rejects node drag that folds a room', () => {
    const doc = mk(oneRoomFloor());
    const before = structuredClone(doc.floor.nodes);
    const r = doc.tryExecute(moveNode('n3', { x: -1, y: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(['room-degenerate', 'walls-cross']).toContain(r.issues[0]!.code);
    }
    expect(doc.floor.nodes).toEqual(before);
  });

  it('rejects walls crossing', () => {
    const doc = mk(twoRoomFloor());
    const r = doc.tryExecute(moveNode('n5', { x: 9, y: 2 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const crosses = r.issues.filter((i) => i.code === 'walls-cross');
      expect(crosses.some((i) => i.ids.includes('w7') && i.ids.includes('w3'))).toBe(true);
    }
  });

  it('clamps opening when wall shrinks', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(setWallLength('w1', 1.5));
    expect(doc.floor.openings.o1!.offset).toBe(0.95);
    expect(doc.validateLayout().some((i) => i.code === 'opening-out-of-wall')).toBe(false);
  });

  it('flags opening that no longer fits', () => {
    const doc = mk(oneRoomFloor());
    const r = doc.tryExecute(setWallLength('w1', 1.0));
    expect(r.ok).toBe(true);
    expect(doc.floor.openings.o1).toBeDefined();
    const issue = doc.validateLayout().find((i) => i.code === 'opening-out-of-wall');
    expect(issue?.ids).toContain('o1');
  });

  it('undo restores clamped opening', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(setWallLength('w1', 1.5));
    doc.undo();
    expect(doc.floor.openings.o1!.offset).toBe(1.2);
    expect(doc.floor.nodes.n2).toMatchObject({ x: 4, y: 0 });
  });

  it('clamps wall items using preset footprint width', () => {
    const f = oneRoomFloor();
    f.items.i1 = {
      id: 'i1',
      preset: 'outlet-01',
      mount: 'wall',
      wall: 'w1',
      side: 'left',
      offset: 3.9,
      elevation: 0.3,
    };
    const doc = mk(f);
    doc.execute(setWallLength('w1', 2));
    expect((doc.floor.items.i1 as { offset: number }).offset).toBeCloseTo(1.96);
  });

  it('pre-existing problems elsewhere do not block unrelated edits', () => {
    const f = twoRoomFloor();
    f.nodes.n3 = { id: 'n3', x: 4.2, y: 0 }; // w2 is now 0.2 m
    const doc = mk(f);
    expect(doc.validateLayout().some((i) => i.code === 'wall-too-short')).toBe(true);
    expect(doc.tryExecute(moveNode('n6', { x: 0, y: 5 })).ok).toBe(true);
  });
});
