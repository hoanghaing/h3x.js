// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { moveNode, setWallLength } from '../../src/core/commands/layout';
import { addItem, moveItem, moveOpening } from '../../src/core/commands/objects';
import { GEOM_TOL } from '../../src/core/constants';
import type { Floor, Project } from '../../src/core/types';
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

const reload = (doc: H3xDocument): H3xDocument =>
  H3xDocument.fromXML(doc.toXML(), { presets: testPresets });

const codes = (doc: H3xDocument): string[] =>
  [...doc.validateLayout(), ...doc.validatePlacements()].map((i) => `${i.code}:${i.ids.join(',')}`);

/** Validation results must not change across save / load. */
function expectStable(doc: H3xDocument): H3xDocument {
  const back = reload(doc);
  expect(codes(back)).toEqual(codes(doc));
  return back;
}

describe('GEOM_TOL', () => {
  it('is 1 mm', () => expect(GEOM_TOL).toBe(1e-3));
});

describe('validation is stable across an XML round trip', () => {
  it('(a) sofa flush to a wall at rotation PI/2', () => {
    const doc = mk();
    const cmd = addItem({
      mount: 'floor',
      preset: 'sofa-3s-01',
      x: 0.55,
      y: 2,
      rotation: Math.PI / 2,
    });
    expect(doc.tryExecute(cmd).ok).toBe(true);
    expect(codes(doc)).toEqual([]);
    const back = expectStable(doc);
    // ...and it can still slide along the wall after reload.
    expect(back.tryExecute(moveItem(cmd.createdId, { y: 2.5 })).ok).toBe(true);
  });

  it('(b) door clamped at the end of a slanted wall (moveNode)', () => {
    for (const y of [0.3, 0.5, 0.7, 0.9]) {
      const doc = mk();
      expect(doc.tryExecute(moveNode('n2', { x: 1.3, y })).ok).toBe(true);
      expect(codes(doc)).toEqual([]);
      const back = expectStable(doc);
      expect(back.tryExecute(moveOpening('o1', { flip: true })).ok).toBe(true);
    }
  });

  it('(b) door clamped at the end of a slanted wall (setWallLength)', () => {
    const f = oneRoomFloor();
    f.nodes.n2 = { id: 'n2', x: 4, y: 1 };
    const doc = mk(f);
    expect(doc.tryExecute(setWallLength('w1', 1.5)).ok).toBe(true);
    expect(codes(doc)).toEqual([]);
    const back = expectStable(doc);
    expect(back.tryExecute(moveOpening('o1', { flip: true })).ok).toBe(true);
  });

  it('(c) wall item clamped at a wall end', () => {
    const f = oneRoomFloor();
    f.nodes.n2 = { id: 'n2', x: 4, y: 1 };
    delete (f.openings as Record<string, unknown>).o1;
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
    expect(doc.tryExecute(setWallLength('w1', 2.3)).ok).toBe(true);
    expect(codes(doc)).toEqual([]);
    const back = expectStable(doc);
    expect(back.tryExecute(moveItem('i1', { elevation: 0.4 })).ok).toBe(true);
  });

  it('(d) slanted wall set to the minimum length', () => {
    const f = oneRoomFloor();
    f.nodes.n2 = { id: 'n2', x: 4, y: 1 };
    delete (f.openings as Record<string, unknown>).o1;
    const doc = mk(f);
    expect(doc.tryExecute(setWallLength('w2', 0.3)).ok).toBe(true);
    expect(doc.validateLayout().filter((i) => i.code === 'wall-too-short')).toEqual([]);
    expectStable(doc);
  });
});
