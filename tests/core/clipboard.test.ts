// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addFloor,
  arrayObjects,
  clipboardCenter,
  clipboardIsEmpty,
  copyObjects,
  pasteObjects,
  removeObjects,
  roomArea,
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

const ROOM = { walls: ['w1', 'w2', 'w3', 'w4'] };

describe('copyObjects', () => {
  it('takes walls with their nodes, openings, wall items and whole rooms', () => {
    const f = oneRoomFloor();
    f.items.out = {
      id: 'out',
      preset: 'outlet-01',
      mount: 'wall',
      wall: 'w2',
      side: 'left',
      offset: 2,
      elevation: 0.3,
    };
    f.columns.c1 = { id: 'c1', x: 1, y: 1, shape: 'round', width: 0.3, rotation: 0 };
    const clip = copyObjects(f, { ...ROOM, columns: ['c1'] });
    expect(clip.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4']);
    expect(clip.openings.map((o) => o.id)).toEqual(['o1']);
    expect(clip.items.map((i) => i.id)).toEqual(['out']);
    expect(clip.columns.map((c) => c.id)).toEqual(['c1']);
    expect(clip.rooms).toEqual([{ name: 'Phòng khách', walls: ['w1', 'w2', 'w3', 'w4'] }]);
    expect(clipboardCenter(clip)).toEqual({ x: 2, y: 2 });
    expect(JSON.parse(JSON.stringify(clip))).toEqual(clip);
  });

  it('a partial room, a lone node or a follow roof copies no room, node or roof', () => {
    const f = oneRoomFloor();
    f.roofs.rf = {
      id: 'rf',
      kind: 'flat',
      follow: true,
      rooms: ['r1'],
      pitch: 0,
      base: 0,
      overhang: 0,
      gableOverhang: 0,
      thickness: 0.2,
      material: 'concrete',
    };
    const clip = copyObjects(f, { walls: ['w2'], nodes: ['n1'], roofs: ['rf'] });
    expect(clip.walls.map((w) => w.id)).toEqual(['w2']);
    expect(clip.nodes.map((n) => n.id).sort()).toEqual(['n2', 'n3']);
    expect(clip.rooms).toEqual([]);
    expect(clip.roofs).toEqual([]);
    expect(clipboardIsEmpty(copyObjects(f, { nodes: ['n1'] }))).toBe(true);
  });
});

describe('pasteObjects', () => {
  it('pastes a moved copy with fresh ids, its room named like the original', () => {
    const doc = mk(oneRoomFloor());
    const clip = copyObjects(doc.floor, ROOM);
    const cmd = pasteObjects(clip, { kind: 'translate', delta: { x: 6, y: 0 } });
    doc.execute(cmd);
    expect(Object.keys(doc.floor.walls)).toHaveLength(8);
    expect(cmd.created.walls).toHaveLength(4);
    for (const id of cmd.created.walls!) expect(['w1', 'w2', 'w3', 'w4']).not.toContain(id);
    const rooms = Object.values(doc.floor.rooms);
    expect(rooms).toHaveLength(2);
    expect(rooms.every((r) => r.name === 'Phòng khách')).toBe(true);
    const copy = rooms.find((r) => r.id !== 'r1')!;
    expect(roomArea(doc.floor as Floor, copy)).toBeCloseTo(3.8 * 3.8, 9);
    const door = doc.floor.openings[cmd.created.openings![0]!]!;
    expect(door).toMatchObject({ offset: 1.2, width: 0.9, wall: expect.any(String) });
    expect(cmd.created.walls).toContain(door.wall);
    doc.undo();
    expect(Object.keys(doc.floor.walls)).toHaveLength(4);
  });

  it('pasted on top of the original, it is rejected', () => {
    const doc = mk(oneRoomFloor());
    const res = doc.tryExecute(pasteObjects(copyObjects(doc.floor, ROOM)));
    expect(res.ok).toBe(false);
    expect(Object.keys(doc.floor.walls)).toHaveLength(4);
  });

  it('pastes in place on another floor', () => {
    const doc = mk(oneRoomFloor());
    const clip = copyObjects(doc.floor, ROOM);
    doc.execute(addFloor({ position: 'above' }));
    const above = doc.project.floors.find((f) => f.id !== 'f1')!;
    doc.setActiveFloor(above.id);
    // A new floor starts as a copy of the one below: clear it first.
    doc.execute(removeObjects({ walls: Object.keys(doc.floor.walls) }));
    const before = Object.keys(doc.floor.walls).length;
    doc.execute(pasteObjects(clip));
    expect(Object.keys(doc.floor.walls).length).toBe(before + 4);
    expect(Object.values(doc.floor.nodes).some((n) => n.x === 4 && n.y === 4)).toBe(true);
    expect(Object.values(doc.floor.rooms).map((r) => r.name)).toEqual(['Phòng khách']);
  });

  it('a mirrored paste swings its doors the other way', () => {
    const doc = mk(oneRoomFloor());
    const cmd = pasteObjects(copyObjects(doc.floor, ROOM), {
      kind: 'mirror',
      a: { x: 5, y: 0 },
      b: { x: 5, y: 1 },
    });
    doc.execute(cmd);
    expect(doc.floor.openings[cmd.created.openings![0]!]!.swing).toBe('right');
    const copy = Object.values(doc.floor.rooms).find((r) => r.id !== 'r1')!;
    expect(roomArea(doc.floor as Floor, copy)).toBeCloseTo(3.8 * 3.8, 9);
  });
});

describe('arrayObjects', () => {
  it('makes count copies, each one delta further', () => {
    const f = oneRoomFloor();
    f.columns.c1 = { id: 'c1', x: 1, y: 1, shape: 'round', width: 0.3, rotation: 0 };
    const doc = mk(f);
    doc.execute(arrayObjects({ columns: ['c1'] }, 3, { x: 0.5, y: 0 }));
    const xs = Object.values(doc.floor.columns)
      .map((c) => c.x)
      .sort();
    expect(xs).toEqual([1, 1.5, 2, 2.5]);
    doc.undo();
    expect(Object.keys(doc.floor.columns)).toEqual(['c1']);
  });

  it('copies rooms side by side', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(arrayObjects(ROOM, 2, { x: 5, y: 0 }));
    expect(Object.values(doc.floor.rooms)).toHaveLength(3);
  });

  it('zero copies change nothing', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(arrayObjects(ROOM, 0, { x: 5, y: 0 }));
    expect(doc.canUndo).toBe(false);
  });
});
