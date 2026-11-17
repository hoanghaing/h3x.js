// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { addWall, removeWall } from '../../src/core/commands/structure';
import { H3xValidationError } from '../../src/core/errors';
import { validateLayout } from '../../src/core/validate/layout';
import type { Floor, Project, Vec2, Wall } from '../../src/core/types';
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

const emptyFloor = (): Floor => ({
  id: 'f1',
  level: 0,
  elevation: 0,
  wallHeight: 3.2,
  nodes: {},
  walls: {},
  openings: {},
  rooms: {},
  items: {},
  columns: {},
});

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof H3xValidationError) return err.issues[0]?.code;
    throw err;
  }
  return undefined;
}

const at = (x: number, y: number): { at: Vec2 } => ({ at: { x, y } });
const T = 0.2;

const wallBetween = (f: Readonly<Floor>, p: string, q: string): Wall | undefined =>
  Object.values(f.walls).find((w) => (w.a === p && w.b === q) || (w.a === q && w.b === p));

const count = (rec: object): number => Object.keys(rec).length;

/** Executes one command and checks it is exactly one undo step back to `before`. */
function oneStep(doc: H3xDocument, run: () => void): void {
  const before = structuredClone(doc.floor);
  const undoable = doc.canUndo;
  run();
  const after = structuredClone(doc.floor);
  doc.undo();
  expect(doc.floor).toEqual(before);
  expect(doc.canUndo).toBe(undoable);
  doc.redo();
  expect(doc.floor).toEqual(after);
}

describe('addWall', () => {
  it('closes a 4x4 square on an empty floor into one room on the 4th wall', () => {
    const doc = mk(emptyFloor());
    const c1 = addWall({ from: at(0, 0), to: at(4, 0), thickness: T });
    oneStep(doc, () => doc.execute(c1));
    const w1 = doc.floor.walls[c1.createdId]!;
    expect(w1).toMatchObject({ thickness: T, height: 3.2, b: c1.endNodeId });
    expect(doc.floor.nodes[c1.endNodeId]).toMatchObject({ x: 4, y: 0 });
    const c2 = addWall({ from: { node: c1.endNodeId }, to: at(4, 4), thickness: T, height: 2.8 });
    doc.execute(c2);
    expect(doc.floor.walls[c2.createdId]!.height).toBe(2.8);
    const c3 = addWall({ from: { node: c2.endNodeId }, to: at(0, 4), thickness: T });
    doc.execute(c3);
    expect(doc.floor.rooms).toEqual({});
    const c4 = addWall({ from: { node: c3.endNodeId }, to: at(0, 0), thickness: T });
    oneStep(doc, () => doc.execute(c4));
    expect(c4.endNodeId).toBe(w1.a);
    expect(count(doc.floor.nodes)).toBe(4);
    expect(count(doc.floor.walls)).toBe(4);
    const rooms = Object.values(doc.floor.rooms);
    expect(rooms).toHaveLength(1);
    expect([...rooms[0]!.walls].sort()).toEqual(
      [c1.createdId, c2.createdId, c3.createdId, c4.createdId].sort(),
    );
  });

  it('reuses a node within GEOM_TOL of an {at} end', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(4.0005, 0.0003), to: at(6, 1), thickness: T });
    oneStep(doc, () => doc.execute(cmd));
    const w = doc.floor.walls[cmd.createdId]!;
    expect(w.a).toBe('n2');
    expect(w.b).toBe(cmd.endNodeId);
    expect(count(doc.floor.nodes)).toBe(5);
    expect(doc.floor.rooms.r1!.walls).toEqual(['w1', 'w2', 'w3', 'w4']);
  });

  it('reports the reused node as endNodeId', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(6, 1), to: at(4, 4.0004), thickness: T });
    doc.execute(cmd);
    expect(cmd.endNodeId).toBe('n3');
  });

  it('splits a wall under an {at} end (T-junction); the room keeps its id', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(2, -2), to: at(2, 0), thickness: T });
    oneStep(doc, () => doc.execute(cmd));
    const f = doc.floor;
    expect(f.nodes[cmd.endNodeId]).toEqual({ id: cmd.endNodeId, x: 2, y: 0 });
    expect(f.walls.w1).toMatchObject({ a: 'n1', b: cmd.endNodeId });
    expect(wallBetween(f, cmd.endNodeId, 'n2')).toBeDefined();
    expect(f.walls[cmd.createdId]!.b).toBe(cmd.endNodeId);
    expect(Object.keys(f.rooms)).toEqual(['r1']);
    expect(f.rooms.r1!.walls).toHaveLength(5);
  });

  it('splits a room with a wall drawn across it from wall to wall', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(2, 0), to: at(2, 4), thickness: T });
    oneStep(doc, () => doc.execute(cmd));
    const f = doc.floor;
    expect(count(f.rooms)).toBe(2);
    expect(f.rooms.r1!.name).toBe('Phòng khách');
    expect(f.rooms.r1!.walls).toContain(cmd.createdId);
    expect(count(f.walls)).toBe(7);
    expect(count(f.nodes)).toBe(6);
  });

  it('splits two crossed walls: 2 crossing nodes, 3 new pieces, no walls-cross', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(2, -1), to: at(2, 5), thickness: T });
    oneStep(doc, () => doc.execute(cmd));
    const f = doc.floor;
    const pieces = Object.values(f.walls).filter((w) => {
      const a = f.nodes[w.a]!;
      const b = f.nodes[w.b]!;
      return a.x === 2 && b.x === 2;
    });
    expect(pieces).toHaveLength(3);
    expect(count(f.walls)).toBe(4 + 2 + 3);
    expect(count(f.nodes)).toBe(4 + 2 + 2);
    expect(f.nodes[cmd.endNodeId]).toMatchObject({ x: 2, y: 5 });
    expect(f.nodes[f.walls[cmd.createdId]!.a]).toMatchObject({ x: 2, y: -1 });
    expect(validateLayout(f).filter((i) => i.code === 'walls-cross')).toEqual([]);
    expect(count(f.rooms)).toBe(2);
  });

  it('splits the new wall at an existing node it passes through', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(-1, -1), to: at(5, 5), thickness: T });
    oneStep(doc, () => doc.execute(cmd));
    const f = doc.floor;
    expect(count(f.nodes)).toBe(6);
    expect(count(f.walls)).toBe(7);
    expect(wallBetween(f, 'n1', 'n3')).toBeDefined();
    expect(f.walls[cmd.createdId]!.b).toBe('n1');
    expect(wallBetween(f, 'n3', cmd.endNodeId)).toBeDefined();
    expect(validateLayout(f).filter((i) => i.code === 'walls-cross')).toEqual([]);
    expect(count(f.rooms)).toBe(2);
  });

  it('reuses an existing node a crossing lands on within GEOM_TOL', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(4.0004, -1), to: at(4.0004, 1), thickness: T });
    // collinear overlap with w2 from (4,0) to (4,1)
    expect(codeOf(() => doc.execute(cmd))).toBe('walls-overlap');
    const cross = addWall({ from: at(3, -1), to: at(5.0006, 1), thickness: T });
    doc.execute(cross);
    expect(count(doc.floor.nodes)).toBe(6);
    expect(doc.floor.walls[cross.createdId]!.b).toBe('n2');
  });

  it('rejects a collinear overlap with an existing wall', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(addWall({ from: at(1, 0), to: at(6, 0), thickness: T })))).toBe(
      'walls-overlap',
    );
    expect(codeOf(() => doc.execute(addWall({ from: at(1, 0), to: at(3, 0), thickness: T })))).toBe(
      'walls-overlap',
    );
    expect(
      codeOf(() => doc.execute(addWall({ from: at(-1, 0), to: at(5, 0), thickness: T }))),
    ).toBe('walls-overlap');
    expect(doc.canUndo).toBe(false);
  });

  it('allows a collinear wall touching an existing wall only at an end', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: { node: 'n2' }, to: at(6, 0), thickness: T });
    oneStep(doc, () => doc.execute(cmd));
    expect(doc.floor.walls[cmd.createdId]).toMatchObject({ a: 'n2', b: cmd.endNodeId });
    expect(doc.floor.walls.w1).toMatchObject({ a: 'n1', b: 'n2' });
  });

  it('is a no-op returning the existing wall when the ends are already joined', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: { node: 'n2' }, to: at(0, 0), thickness: T });
    const before = structuredClone(doc.floor);
    doc.execute(cmd);
    expect(doc.floor).toEqual(before);
    expect(doc.canUndo).toBe(false);
    expect(cmd.createdId).toBe('w1');
    expect(cmd.endNodeId).toBe('n1');
  });

  it('keeps the room when a free-end wall goes from a room wall into the room', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(2, 0), to: at(2, 2), thickness: T });
    oneStep(doc, () => doc.execute(cmd));
    const f = doc.floor;
    const start = f.walls[cmd.createdId]!.a;
    const half = wallBetween(f, start, 'n2')!;
    expect(Object.keys(f.rooms)).toEqual(['r1']);
    expect(f.rooms.r1!.name).toBe('Phòng khách');
    expect(f.rooms.r1!.walls).toContain('w1');
    expect(f.rooms.r1!.walls).toContain(half.id);
    expect(f.walls.w1!.b).toBe(start);
  });

  it('gives an enclosing room a hole for a free-standing box; removeWall takes it away', () => {
    const doc = mk(oneRoomFloor());
    const corners: Vec2[] = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = corners[i]!;
      const q = corners[(i + 1) % 4]!;
      const cmd = addWall({ from: { at: p }, to: { at: q }, thickness: T });
      oneStep(doc, () => doc.execute(cmd));
      ids.push(cmd.createdId);
    }
    const r1 = doc.floor.rooms.r1!;
    expect(r1.name).toBe('Phòng khách');
    expect(r1.walls).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(r1.holes).toHaveLength(1);
    expect([...r1.holes![0]!].sort()).toEqual([...ids].sort());
    expect(count(doc.floor.rooms)).toBe(2);

    oneStep(doc, () => doc.execute(removeWall(ids[0]!)));
    expect(Object.keys(doc.floor.rooms)).toEqual(['r1']);
    expect('holes' in doc.floor.rooms.r1!).toBe(false);
    expect(doc.floor.rooms.r1!.name).toBe('Phòng khách');
  });

  it('rejects a zero-length or too short wall', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(addWall({ from: at(1, 1), to: at(1, 1), thickness: T })))).toBe(
      'wall-too-short',
    );
    expect(
      codeOf(() =>
        doc.execute(addWall({ from: { node: 'n1' }, to: { node: 'n1' }, thickness: T })),
      ),
    ).toBe('wall-too-short');
    expect(
      codeOf(() => doc.execute(addWall({ from: at(1, 1), to: at(1.2, 1), thickness: T }))),
    ).toBe('wall-too-short');
  });

  it.each([
    ['thickness 0', { thickness: 0 }],
    ['thickness -0.2', { thickness: -0.2 }],
    ['thickness NaN', { thickness: Number.NaN }],
    ['thickness Infinity', { thickness: Number.POSITIVE_INFINITY }],
    ['height 0', { thickness: T, height: 0 }],
    ['height NaN', { thickness: T, height: Number.NaN }],
    ['height Infinity', { thickness: T, height: Number.POSITIVE_INFINITY }],
  ])('rejects %s with invalid-thickness and changes nothing', (_n, over) => {
    const doc = mk(oneRoomFloor());
    const before = structuredClone(doc.floor);
    expect(codeOf(() => doc.execute(addWall({ from: at(1, 1), to: at(3, 1), ...over })))).toBe(
      'invalid-thickness',
    );
    expect(doc.floor).toEqual(before);
  });

  it('accepts a positive thickness and height', () => {
    const doc = mk(oneRoomFloor());
    const cmd = addWall({ from: at(1, 1), to: at(3, 1), thickness: 0.1, height: 2.5 });
    doc.execute(cmd);
    expect(doc.floor.walls[cmd.createdId]).toMatchObject({ thickness: 0.1, height: 2.5 });
  });

  it('throws not-found for a missing node end', () => {
    const doc = mk(oneRoomFloor());
    expect(
      codeOf(() => doc.execute(addWall({ from: { node: 'nope' }, to: at(1, 1), thickness: T }))),
    ).toBe('not-found');
  });

  it('pre-generates the first wall and end node ids; re-runs keep them', () => {
    const cmd = addWall({ from: { node: 'n2' }, to: at(6, 1), thickness: T });
    const created = cmd.createdId;
    const end = cmd.endNodeId;
    expect(created).not.toBe(end);
    const ctx = { floor: oneRoomFloor(), presets: testPresets };
    const first = cmd.run(ctx);
    expect(cmd.run(ctx)).toEqual(first);
    expect(first.map((c) => c.id)).toEqual(expect.arrayContaining([created, end]));
    expect(cmd.createdId).toBe(created);
    expect(cmd.endNodeId).toBe(end);
  });
});
