// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import {
  addItem,
  addOpening,
  moveItem,
  moveOpening,
  removeItem,
  removeOpening,
} from '../../src/core/commands/objects';
import { moveNode, moveWall, setWallLength } from '../../src/core/commands/layout';
import { H3xValidationError } from '../../src/core/errors';
import type { Floor, Project } from '../../src/core/types';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const mk = (withPresets = true): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [oneRoomFloor()],
    } as Project,
    withPresets ? { presets: testPresets } : {},
  );

const sofa = (x: number, y: number, rotation = 0) =>
  addItem({ mount: 'floor', preset: 'sofa-3s-01', x, y, rotation });
const codes = (r: ReturnType<H3xDocument['tryExecute']>): string[] =>
  r.ok ? [] : r.issues.map((i) => i.code);
const count = (doc: H3xDocument): number => Object.keys(doc.floor.items).length;

describe('floor item placement', () => {
  it('sofa in the middle is valid', () => {
    const doc = mk();
    expect(doc.tryExecute(sofa(2, 2)).ok).toBe(true);
    expect(count(doc)).toBe(1);
  });

  it('sofa into wall is rejected', () => {
    const doc = mk();
    const r = doc.tryExecute(sofa(2, 0.3));
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('hits-wall');
    expect(count(doc)).toBe(0);
  });

  it('sofa flush against wall is valid', () => {
    expect(mk().tryExecute(sofa(2, 0.55)).ok).toBe(true);
  });

  it('rotated bed corner hits wall', () => {
    const doc = mk();
    const r = doc.tryExecute(
      addItem({ mount: 'floor', preset: 'bed-01', x: 3.2, y: 2, rotation: Math.PI / 4 }),
    );
    expect(codes(r)).toContain('hits-wall');
  });

  it('items cannot overlap', () => {
    const doc = mk();
    doc.execute(sofa(2, 2));
    const r = doc.tryExecute(
      addItem({ mount: 'floor', preset: 'bed-01', x: 2, y: 2.5, rotation: 0 }),
    );
    expect(codes(r)).toContain('hits-item');
  });

  it('rug may sit under sofa', () => {
    const doc = mk();
    doc.execute(sofa(2, 2));
    expect(
      doc.tryExecute(addItem({ mount: 'floor', preset: 'rug-01', x: 2, y: 2, rotation: 0 })).ok,
    ).toBe(true);
  });

  it('outside the house', () => {
    expect(codes(mk().tryExecute(sofa(10, 10)))).toContain('outside-room');
  });

  it('ceiling item must be inside a room', () => {
    const doc = mk();
    const lamp = (x: number, y: number) =>
      addItem({ mount: 'ceiling', preset: 'lamp-01', x, y, rotation: 0 });
    expect(doc.tryExecute(lamp(2, 2)).ok).toBe(true);
    expect(codes(doc.tryExecute(lamp(10, 10)))).toContain('outside-room');
  });

  it('unknown preset / no resolver', () => {
    const doc = mk(false);
    expect(() => doc.execute(sofa(2, 2))).toThrow(H3xValidationError);
    try {
      doc.execute(sofa(2, 2));
    } catch (e) {
      expect((e as H3xValidationError).issues[0]!.code).toBe('unknown-preset');
    }
  });

  it('mount mismatch', () => {
    const doc = mk();
    try {
      doc.execute(addItem({ mount: 'floor', preset: 'outlet-01', x: 1, y: 1, rotation: 0 }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(H3xValidationError);
      expect((e as H3xValidationError).issues[0]!.code).toBe('mount-mismatch');
    }
  });

  it('moveItem and removeItem', () => {
    const doc = mk();
    const cmd = sofa(2, 2);
    doc.execute(cmd);
    expect(codes(doc.tryExecute(moveItem(cmd.createdId, { y: 0.3 })))).toContain('hits-wall');
    expect(doc.tryExecute(moveItem(cmd.createdId, { x: 2.5 })).ok).toBe(true);
    expect((doc.floor.items[cmd.createdId] as { x: number }).x).toBe(2.5);
    doc.execute(removeItem(cmd.createdId));
    expect(count(doc)).toBe(0);
    expect(codes(doc.tryExecute(removeItem('nope')))).toContain('not-found');
  });

  it('undo removes added item', () => {
    const doc = mk();
    doc.execute(sofa(2, 2));
    doc.undo();
    expect(count(doc)).toBe(0);
  });
});

describe('wall items and openings', () => {
  const outlet = (offset: number, elevation = 0.4) =>
    addItem({ mount: 'wall', preset: 'outlet-01', wall: 'w1', side: 'left', offset, elevation });

  it('outlet must not cover door', () => {
    const doc = mk();
    expect(codes(doc.tryExecute(outlet(1.2)))).toContain('wall-item-on-opening');
    expect(doc.tryExecute(outlet(3)).ok).toBe(true);
  });

  it('outlet above the door is fine', () => {
    expect(mk().tryExecute(outlet(1.2, 2.5)).ok).toBe(true);
  });

  it('outlet out of range', () => {
    const doc = mk();
    expect(codes(doc.tryExecute(outlet(0.01)))).toContain('wall-item-out-of-range');
    expect(codes(doc.tryExecute(outlet(3, 3.2)))).toContain('wall-item-out-of-range');
  });

  it('opening overlap', () => {
    const doc = mk();
    const add = (offset: number) => addOpening({ wall: 'w1', preset: 'window-01', offset });
    expect(codes(doc.tryExecute(add(1.5)))).toContain('opening-overlap');
    const cmd = add(3);
    expect(doc.tryExecute(cmd).ok).toBe(true);
    const o = doc.floor.openings[cmd.createdId]!;
    expect(o.sill).toBe(0.9);
    expect(o.width).toBe(1.2);
  });

  it('opening out of wall, too tall, bad preset', () => {
    const doc = mk();
    expect(
      codes(doc.tryExecute(addOpening({ wall: 'w1', preset: 'window-01', offset: 3.9 }))),
    ).toContain('opening-out-of-wall');
    expect(
      codes(doc.tryExecute(addOpening({ wall: 'w1', preset: 'window-01', offset: 3, sill: 2.5 }))),
    ).toContain('opening-too-tall');
    expect(() => doc.execute(addOpening({ wall: 'w1', preset: 'sofa-3s-01', offset: 3 }))).toThrow(
      H3xValidationError,
    );
  });

  it('moveOpening and removeOpening', () => {
    const doc = mk();
    expect(codes(doc.tryExecute(moveOpening('o1', { offset: 0.1 })))).toContain(
      'opening-out-of-wall',
    );
    expect(doc.tryExecute(moveOpening('o1', { offset: 2, flip: true })).ok).toBe(true);
    expect(doc.floor.openings.o1!.flip).toBe(true);
    doc.execute(removeOpening('o1'));
    expect(doc.floor.openings.o1).toBeUndefined();
  });
});

describe('validatePlacements', () => {
  it('layout move does not get blocked by furniture', () => {
    const doc = mk();
    doc.execute(sofa(2, 3));
    expect(doc.tryExecute(moveWall('w3', { x: 0, y: -1 })).ok).toBe(true);
    const issues = doc.validatePlacements();
    const hit = issues.find((i) => i.code === 'hits-wall');
    expect(hit).toBeDefined();
    expect(hit!.ids[1]).toBe('w3');
    expect((doc.floor as Floor).walls.w3).toBeDefined();
  });

  it('layout re-fit into a collision succeeds and is reported', () => {
    const doc = mk();
    const win = addOpening({ wall: 'w1', preset: 'window-01', offset: 3 });
    doc.execute(win);
    expect(doc.tryExecute(setWallLength('w1', 2.6)).ok).toBe(true);
    const hit = doc.validatePlacements().find((i) => i.code === 'opening-overlap');
    expect(hit?.ids).toContain(win.createdId);
  });
});

describe('non-finite numbers', () => {
  const only = (r: ReturnType<H3xDocument['tryExecute']>): string[] => codes(r);

  it('addOpening with NaN offset is rejected as invalid-number', () => {
    const doc = mk();
    const cmd = addOpening({ wall: 'w1', preset: 'window-01', offset: NaN });
    const r = doc.tryExecute(cmd);
    expect(r.ok).toBe(false);
    expect(only(r)).toEqual(['invalid-number']);
    if (!r.ok) expect(r.issues[0]!.ids).toEqual([cmd.createdId]);
    expect(doc.floor.openings[cmd.createdId]).toBeUndefined();
    expect(doc.canUndo).toBe(false);
  });

  it('wall item with NaN offset is rejected as invalid-number', () => {
    const doc = mk();
    const r = doc.tryExecute(
      addItem({ mount: 'wall', preset: 'outlet-01', wall: 'w1', side: 'left', offset: NaN, elevation: 0.4 }),
    );
    expect(only(r)).toEqual(['invalid-number']);
    expect(count(doc)).toBe(0);
  });

  it('moveNode to Infinity is invalid-number, not walls-cross', () => {
    const doc = mk();
    const before = structuredClone(doc.floor.nodes);
    const r = doc.tryExecute(moveNode('n3', { x: Infinity, y: 4 }));
    expect(only(r)).toEqual(['invalid-number']);
    if (!r.ok) expect(r.issues[0]!.ids).toEqual(['n3']);
    expect(doc.floor.nodes).toEqual(before);
    expect(() => doc.toXML()).not.toThrow();
  });

  it('preview reports invalid-number without mutating', () => {
    const doc = mk();
    const before = structuredClone(doc.floor);
    expect(doc.preview(moveNode('n3', { x: NaN, y: 4 })).map((i) => i.code)).toEqual([
      'invalid-number',
    ]);
    expect(doc.floor).toEqual(before);
  });
});
