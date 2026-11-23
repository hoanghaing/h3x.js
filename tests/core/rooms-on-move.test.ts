// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  detectRooms,
  moveNode,
  moveWall,
  projectToXML,
  setWallLength,
  type Floor,
  type Project,
  type Room,
} from '../../src/core';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const project = (floor: Floor): Project =>
  ({
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors: [floor],
  }) as Project;

const mk = (floor: Floor): H3xDocument =>
  H3xDocument.fromProject(project(floor), { presets: testPresets });

/** Loads the floor from XML, so rooms are found the way an opened file finds them. */
const opened = (floor: Floor): H3xDocument =>
  H3xDocument.fromXML(projectToXML(project(floor)), { presets: testPresets });

const reload = (doc: H3xDocument): H3xDocument =>
  H3xDocument.fromXML(doc.toXML(), { presets: testPresets });

const step = { coalesceKey: 'drag', restart: true };

const rooms = (doc: H3xDocument): Room[] => Object.values(doc.floor.rooms);

/** The same loop of walls, whatever wall it starts from. */
const sameLoop = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((w) => b.includes(w));

/**
 * A `w` x `h` box of 0.1 m walls with its lower left corner at (x, y): nodes `${p}0`-`${p}3`
 * counter-clockwise from that corner, walls `${p}s` (south), `${p}e`, `${p}n`, `${p}w`.
 */
function addBox(floor: Floor, p: string, x: number, y: number, w: number, h: number): void {
  const corners = [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
  corners.forEach(([cx, cy], i) => (floor.nodes[`${p}${i}`] = { id: `${p}${i}`, x: cx!, y: cy! }));
  ['s', 'e', 'n', 'w'].forEach((side, i) => {
    floor.walls[`${p}${side}`] = {
      id: `${p}${side}`,
      a: `${p}${i}`,
      b: `${p}${(i + 1) % 4}`,
      thickness: 0.1,
      height: 3.2,
    };
  });
}

/** A floor holding only a 1 x 0.9 m box: smaller than the smallest room. */
function smallBoxFloor(): Floor {
  const f = oneRoomFloor();
  f.nodes = {};
  f.walls = {};
  f.openings = {};
  f.rooms = {};
  addBox(f, 'b', 0, 0, 1, 0.9);
  return f;
}

describe('a wall loop dragged larger becomes a room', () => {
  it('starts with no room', () => {
    expect(rooms(mk(smallBoxFloor()))).toEqual([]);
    expect(rooms(opened(smallBoxFloor()))).toEqual([]);
  });

  const growers = {
    moveWall: moveWall('be', { x: 3, y: 0 }),
    moveNode: moveNode('b1', { x: 4, y: 0 }),
    setWallLength: setWallLength('bs', 4),
  };
  for (const [name, cmd] of Object.entries(growers)) {
    it(`by ${name}, as a file saved and opened would have it`, () => {
      const doc = mk(smallBoxFloor());
      doc.execute(cmd);
      const added = rooms(doc);
      expect(added).toHaveLength(1);
      expect(added[0]!.name).toBe('');
      expect(added[0]!.holes).toBeUndefined();
      expect(sameLoop(added[0]!.walls, ['bs', 'be', 'bn', 'bw'])).toBe(true);
      expect(doc.validateLayout()).toEqual([]);
      // Saved and opened: the same floor.
      expect(reload(doc).floor).toEqual(doc.floor);
      // Saved without rooms and opened: the same loop is found.
      const fresh = opened({ ...structuredClone(doc.floor), rooms: {} });
      expect(rooms(fresh).map((r) => r.walls.length)).toEqual([4]);
      expect(sameLoop(rooms(fresh)[0]!.walls, added[0]!.walls)).toBe(true);
    });
  }

  it('is one undo step; undo and redo restore the room', () => {
    const doc = mk(smallBoxFloor());
    const before = structuredClone(doc.floor);
    doc.execute(moveWall('be', { x: 3, y: 0 }));
    const after = structuredClone(doc.floor);
    doc.undo();
    expect(doc.floor).toEqual(before);
    expect(doc.canUndo).toBe(false);
    doc.redo();
    expect(doc.floor).toEqual(after);
  });

  it('keeps one room id through a drag, and the drag is one undo step', () => {
    const doc = mk(smallBoxFloor());
    const before = structuredClone(doc.floor);
    const ids = new Set<string>();
    for (const d of [0.5, 1, 2, 2.5, 3]) {
      doc.execute(moveWall('be', { x: d, y: 0 }), step);
      for (const r of rooms(doc)) ids.add(r.id);
      expect(rooms(doc)).toHaveLength(1);
    }
    expect(ids.size).toBe(1);
    const after = structuredClone(doc.floor);
    doc.undo();
    expect(doc.floor).toEqual(before);
    expect(doc.canUndo).toBe(false);
    doc.redo();
    expect(doc.floor).toEqual(after);
  });

  it('dragged out and back: no change and no undo step', () => {
    const doc = mk(smallBoxFloor());
    const before = structuredClone(doc.floor);
    for (const d of [1, 3, 0.5, 0]) doc.execute(moveWall('be', { x: d, y: 0 }), step);
    expect(doc.floor).toEqual(before);
    expect(doc.canUndo).toBe(false);
  });

  it('gives a free id when the one it would pick is taken', () => {
    const first = mk(smallBoxFloor());
    first.execute(moveWall('be', { x: 3, y: 0 }));
    const id = rooms(first)[0]!.id;
    const floor = smallBoxFloor();
    floor.nodes[id] = { id, x: 20, y: 20 };
    const doc = mk(floor);
    doc.execute(moveWall('be', { x: 3, y: 0 }));
    expect(rooms(doc)).toHaveLength(1);
    expect(rooms(doc)[0]!.id).not.toBe(id);
    expect(doc.floor.nodes[id]).toEqual({ id, x: 20, y: 20 });
  });

  it('a loop grown inside a room becomes a room; the outer room is unchanged', () => {
    const floor = oneRoomFloor();
    floor.openings = {};
    floor.rooms = {};
    floor.nodes.n2!.x = 8;
    floor.nodes.n3!.x = 8;
    floor.nodes.n3!.y = 8;
    floor.nodes.n4!.y = 8;
    addBox(floor, 'b', 3, 3, 1, 0.9);
    const doc = opened(floor);
    const [outer] = rooms(doc);
    expect(rooms(doc)).toHaveLength(1);
    expect(sameLoop(outer!.holes![0]!, ['bs', 'be', 'bn', 'bw'])).toBe(true);

    doc.execute(moveWall('be', { x: 2, y: 0 }));
    expect(doc.floor.rooms[outer!.id]).toEqual(outer);
    const added = rooms(doc).filter((r) => r.id !== outer!.id);
    expect(added).toHaveLength(1);
    expect(sameLoop(added[0]!.walls, ['bs', 'be', 'bn', 'bw'])).toBe(true);
    expect(doc.validateLayout()).toEqual([]);
    expect(reload(doc).floor).toEqual(doc.floor);
  });

  it('adds or removes no room when a move encloses no new loop', () => {
    // Room r1 is stored; the 2 x 2 box `c` is a room the file does not list.
    const floor = oneRoomFloor();
    floor.openings = {};
    floor.nodes.n2!.x = 10;
    floor.nodes.n3!.x = 10;
    addBox(floor, 'c', 12, 0, 2, 2);
    addBox(floor, 'b', 20, 0, 1, 0.9);
    const doc = mk(floor);
    expect(detectRooms(doc.floor)).toHaveLength(2);
    const stored = structuredClone(doc.floor.rooms);

    doc.execute(moveWall('w2', { x: -1, y: 0 }));
    doc.execute(moveWall('ce', { x: 1, y: 0 }));
    doc.execute(moveNode('b2', { x: 21, y: 0.95 }));
    expect(doc.floor.rooms).toEqual(stored);

    // The small box grows into a room; the room missing from the file stays missing.
    doc.execute(moveWall('be', { x: 3, y: 0 }));
    expect(Object.keys(doc.floor.rooms)).toHaveLength(2);
    expect(doc.floor.rooms.r1).toEqual(stored.r1);
    const added = rooms(doc).find((r) => r.id !== 'r1')!;
    expect(sameLoop(added.walls, ['bs', 'be', 'bn', 'bw'])).toBe(true);
    expect(reload(doc).floor).toEqual(doc.floor);
  });

  it('shrinking a room below the minimum is still rejected', () => {
    const doc = mk(smallBoxFloor());
    doc.execute(moveWall('be', { x: 3, y: 0 }));
    const res = doc.tryExecute(moveWall('be', { x: -3, y: 0 }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.issues.map((i) => i.code)).toContain('room-degenerate');
  });
});
