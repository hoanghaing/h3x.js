// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import type { ChangeEvent, Command } from '../../src/core/document/H3xDocument';
import { mergeChanges } from '../../src/core/document/changes';
import type { EntityChange } from '../../src/core/document/changes';
import { H3xValidationError } from '../../src/core/errors';
import type { PlanNode, Project } from '../../src/core/types';
import { moveNode } from '../../src/core/commands/layout';
import { moveOpening } from '../../src/core/commands/objects';
import { setWallFinish } from '../../src/core/commands/finishes';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

function setX(x: number): Command {
  return {
    label: 'setX',
    run: ({ floor }) => {
      const before = floor.nodes.n1 ? structuredClone(floor.nodes.n1) : null;
      return [{ kind: 'node', id: 'n1', before, after: { id: 'n1', x, y: 0 } }];
    },
  };
}

function docWithNode(): H3xDocument {
  const doc = H3xDocument.create();
  doc.execute({
    label: 'add',
    run: () => [{ kind: 'node', id: 'n1', before: null, after: { id: 'n1', x: 0, y: 0 } }],
  });
  return doc;
}
const x = (d: H3xDocument): number => d.floor.nodes.n1!.x;

describe('H3xDocument', () => {
  it('create makes one empty floor', () => {
    const d = H3xDocument.create({ name: 'a' });
    expect(d.floor).toMatchObject({ id: 'f1', level: 0, elevation: 0, wallHeight: 3.2 });
    expect(d.project.meta.name).toBe('a');
  });

  it('execute applies and emits', () => {
    const d = docWithNode();
    const events: ChangeEvent[] = [];
    d.on('change', (e) => events.push(e));
    d.execute(setX(5));
    expect(x(d)).toBe(5);
    expect(events[0]!.reason).toBe('execute');
  });

  it('undo/redo restore', () => {
    const d = docWithNode();
    d.execute(setX(1));
    expect(x(d)).toBe(1);
    expect(d.undo()).toBe(true);
    expect(x(d)).toBe(0);
    expect(d.canRedo).toBe(true);
    expect(d.redo()).toBe(true);
    expect(x(d)).toBe(1);
  });

  it('rejected command never enters history', () => {
    const d = docWithNode();
    d.addValidator((doc) =>
      doc.floor.nodes.n1 && doc.floor.nodes.n1.x > 10
        ? [{ code: 'too-far', ids: ['n1'], message: 'x too big' }]
        : [],
    );
    d.execute(setX(1));
    const r = d.tryExecute(setX(20));
    expect(r.ok).toBe(false);
    expect(x(d)).toBe(1);
    expect(() => d.execute(setX(20))).toThrow(H3xValidationError);
    d.undo();
    expect(x(d)).toBe(0);
    d.undo(); // removes node add
    expect(d.canUndo).toBe(false);
  });

  it('coalesced drag undoes in one step', () => {
    const d = docWithNode();
    for (const v of [1, 2, 3]) d.execute(setX(v), { coalesceKey: 'drag' });
    d.undo();
    expect(x(d)).toBe(0);
  });

  it('endCoalesce splits', () => {
    const d = docWithNode();
    d.execute(setX(1), { coalesceKey: 'drag' });
    d.endCoalesce();
    d.execute(setX(2), { coalesceKey: 'drag' });
    d.undo();
    expect(x(d)).toBe(1);
  });

  it('preview does not mutate or emit', () => {
    const d = docWithNode();
    let n = 0;
    d.on('change', () => n++);
    d.addValidator(() => [{ code: 'c', ids: [], message: 'm' }]);
    const issues = d.preview(setX(7));
    expect(issues).toHaveLength(1);
    expect(x(d)).toBe(0);
    expect(n).toBe(0);
  });

  it('fromProject deep-clones', () => {
    const p = H3xDocument.create().project as Project;
    const input = structuredClone(p);
    input.floors[0]!.nodes.n1 = { id: 'n1', x: 1, y: 1 };
    const d = H3xDocument.fromProject(input);
    input.floors[0]!.nodes.n1!.x = 99;
    expect(x(d)).toBe(1);
  });

  it('fromProject normalizes CW rooms to CCW', () => {
    const pts = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const p = H3xDocument.create().project as Project;
    const input = structuredClone(p);
    const f = input.floors[0]!;
    pts.forEach(([px, py], i) => (f.nodes[`n${i}`] = { id: `n${i}`, x: px!, y: py! }));
    for (let i = 0; i < 4; i++)
      f.walls[`w${i}`] = { id: `w${i}`, a: `n${i}`, b: `n${(i + 1) % 4}`, thickness: 0.2, height: 3 };
    f.rooms.r = { id: 'r', walls: ['w3', 'w2', 'w1', 'w0'], name: '' };
    const d = H3xDocument.fromProject(input);
    expect(d.floor.rooms.r!.walls).toEqual(['w0', 'w1', 'w2', 'w3']);
  });

  it('snapshots are isolated', () => {
    const d = docWithNode();
    let ev: ChangeEvent | undefined;
    d.on('change', (e) => (ev = e));
    d.execute(setX(2));
    (ev!.changes[0]!.after as PlanNode).x = 999;
    expect(x(d)).toBe(2);
  });

  it('XML round trip', () => {
    const d = docWithNode();
    const d2 = H3xDocument.fromXML(d.toXML());
    expect(d2.floor.nodes.n1).toEqual({ id: 'n1', x: 0, y: 0 });
  });

  it('throwing validator reverts and rethrows (execute and preview)', () => {
    const d = docWithNode();
    d.addValidator(() => {
      throw new Error('boom');
    });
    let n = 0;
    d.on('change', () => n++);
    expect(() => d.execute(setX(5))).toThrow('boom');
    expect(x(d)).toBe(0);
    expect(() => d.preview(setX(5))).toThrow('boom');
    expect(x(d)).toBe(0);
    expect(n).toBe(0);
  });

  it('throwing listener: others run, error rethrown, change committed', () => {
    const d = docWithNode();
    let ran = false;
    d.on('change', () => {
      throw new Error('listener');
    });
    d.on('change', () => (ran = true));
    expect(() => d.execute(setX(4))).toThrow('listener');
    expect(ran).toBe(true);
    expect(x(d)).toBe(4);
    expect(d.canUndo).toBe(true);
  });

  it('execute after undo clears redo', () => {
    const d = docWithNode();
    d.execute(setX(1));
    d.undo();
    expect(d.canRedo).toBe(true);
    d.execute(setX(2));
    expect(d.canRedo).toBe(false);
  });

  it('history is limited to 200 entries', () => {
    const d = docWithNode();
    for (let i = 1; i <= 201; i++) d.execute(setX(i));
    let undos = 0;
    while (d.undo()) undos++;
    expect(undos).toBe(200);
  });

  it('undo event is inverted', () => {
    const d = docWithNode();
    d.execute(setX(1));
    const events: ChangeEvent[] = [];
    d.on('change', (e) => events.push(e));
    d.undo();
    expect(events[0]!.reason).toBe('undo');
    expect((events[0]!.changes[0]!.before as PlanNode).x).toBe(1);
    expect((events[0]!.changes[0]!.after as PlanNode).x).toBe(0);
  });

  it('mergeChanges keeps earliest before and latest after', () => {
    const ch = (
      kind: 'node' | 'wall',
      id: string,
      before: unknown,
      after: unknown,
    ): EntityChange => ({ kind, id, before, after });
    const merged = mergeChanges(
      [ch('node', 'a', null, 1), ch('node', 'b', 5, 6)],
      [ch('node', 'a', 1, 2), ch('wall', 'a', 7, null)],
    );
    expect(merged).toHaveLength(3);
    expect(merged.find((c) => c.kind === 'node' && c.id === 'a')).toMatchObject({
      before: null,
      after: 2,
    });
    expect(merged.find((c) => c.kind === 'node' && c.id === 'b')).toMatchObject({
      before: 5,
      after: 6,
    });
    expect(merged.find((c) => c.kind === 'wall')).toMatchObject({ before: 7, after: null });
  });

  it('tryExecute reports H3xValidationError thrown by run', () => {
    const d = docWithNode();
    const bad: Command = {
      label: 'bad',
      run: () => {
        throw new H3xValidationError([{ code: 'bad', ids: [], message: 'bad input' }]);
      },
    };
    const r = d.tryExecute(bad);
    expect(r).toEqual({ ok: false, issues: [{ code: 'bad', ids: [], message: 'bad input' }] });
    expect(x(d)).toBe(0);
    d.undo(); // only the add is in history
    expect(d.canUndo).toBe(false);
  });

  it('rejected step mid-drag does not break coalescing', () => {
    const d = docWithNode();
    d.addValidator((doc) =>
      doc.floor.nodes.n1!.x > 10 ? [{ code: 'far', ids: ['n1'], message: 'far' }] : [],
    );
    d.execute(setX(1), { coalesceKey: 'drag' });
    d.execute(setX(2), { coalesceKey: 'drag' });
    expect(d.tryExecute(setX(20), { coalesceKey: 'drag' }).ok).toBe(false);
    d.execute(setX(3), { coalesceKey: 'drag' });
    d.undo();
    expect(x(d)).toBe(0);
  });

  it('rejected multi-entity command leaves all entities unchanged', () => {
    const d = docWithNode();
    d.execute({
      label: 'add n2',
      run: () => [{ kind: 'node', id: 'n2', before: null, after: { id: 'n2', x: 0, y: 0 } }],
    });
    d.addValidator((doc) =>
      doc.floor.nodes.n2!.x > 10 ? [{ code: 'far', ids: ['n2'], message: 'far' }] : [],
    );
    const move: Command = {
      label: 'move both',
      run: ({ floor }) => [
        {
          kind: 'node',
          id: 'n1',
          before: structuredClone(floor.nodes.n1!),
          after: { id: 'n1', x: 5, y: 0 },
        },
        {
          kind: 'node',
          id: 'n2',
          before: structuredClone(floor.nodes.n2!),
          after: { id: 'n2', x: 50, y: 0 },
        },
      ],
    };
    expect(d.tryExecute(move).ok).toBe(false);
    expect(x(d)).toBe(0);
    expect(d.floor.nodes.n2!.x).toBe(0);
  });

  it('coalesced drag back to start leaves no undo step', () => {
    const d = docWithNode();
    d.endCoalesce();
    d.execute(setX(5), { coalesceKey: 'drag' });
    d.execute(setX(0), { coalesceKey: 'drag' });
    expect(x(d)).toBe(0);
    d.undo(); // removes the add; no phantom drag step
    expect(d.floor.nodes.n1).toBeUndefined();
    expect(d.canUndo).toBe(false);
  });
});

describe('no-op commands', () => {
  const mkRoom = (): H3xDocument =>
    H3xDocument.fromProject(
      {
        version: 1,
        unit: 'm',
        meta: { name: 't', created: '2026-01-01T00:00:00Z' },
        floors: [oneRoomFloor()],
      } as Project,
      { presets: testPresets },
    );

  it('setWallFinish to the same value adds no undo step and emits nothing', () => {
    const doc = mkRoom();
    let n = 0;
    doc.on('change', () => n++);
    doc.execute(setWallFinish('w1', 'left', undefined));
    expect(doc.canUndo).toBe(false);
    expect(n).toBe(0);
  });

  it('moveNode to the same position adds no undo step and emits nothing', () => {
    const doc = mkRoom();
    let n = 0;
    doc.on('change', () => n++);
    doc.execute(moveNode('n2', { x: 4, y: 0 }));
    expect(doc.tryExecute(moveNode('n2', { x: 4, y: 0 })).ok).toBe(true);
    expect(doc.canUndo).toBe(false);
    expect(n).toBe(0);
  });

  it('changes whose before equals after are a no-op', () => {
    const doc = mkRoom();
    let n = 0;
    doc.on('change', () => n++);
    doc.execute(moveOpening('o1', { offset: 1.2 }));
    expect(doc.canUndo).toBe(false);
    expect(n).toBe(0);
  });

  it('pointer-down with coalesceKey but no movement leaves no undo step', () => {
    const doc = mkRoom();
    doc.execute(moveNode('n3', { x: 4, y: 4 }), { coalesceKey: 'drag' });
    expect(doc.canUndo).toBe(false);
    doc.endCoalesce();
    expect(doc.canUndo).toBe(false);
  });

  it('a no-op mid-drag does not break coalescing', () => {
    const doc = mkRoom();
    doc.execute(moveNode('n3', { x: 4.5, y: 4 }), { coalesceKey: 'drag' });
    doc.execute(moveNode('n3', { x: 4.5, y: 4 }), { coalesceKey: 'drag' });
    doc.execute(moveNode('n3', { x: 5, y: 4 }), { coalesceKey: 'drag' });
    doc.undo();
    expect(doc.floor.nodes.n3).toMatchObject({ x: 4, y: 4 });
    expect(doc.canUndo).toBe(false);
  });
});

describe('fromProject checks', () => {
  const proj = (floors: Project['floors']): Project => ({
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '' },
    floors,
  });
  const err = (p: Project): H3xValidationError => {
    try {
      H3xDocument.fromProject(p);
    } catch (e) {
      expect(e).toBeInstanceOf(H3xValidationError);
      return e as H3xValidationError;
    }
    throw new Error('expected throw');
  };

  it('no floors gives no-floor', () => {
    expect(err(proj([])).issues[0]!.code).toBe('no-floor');
  });

  it('wall referencing a missing node gives bad-reference', () => {
    const f = oneRoomFloor();
    f.walls.w1 = { ...f.walls.w1!, b: 'nope' };
    const e = err(proj([f]));
    expect(e.issues[0]!.code).toBe('bad-reference');
    expect(e.issues[0]!.ids).toContain('w1');
  });

  it('opening / wall item referencing a missing wall gives bad-reference', () => {
    const f = oneRoomFloor();
    f.openings.o1 = { ...f.openings.o1!, wall: 'nope' };
    expect(err(proj([f])).issues[0]!.code).toBe('bad-reference');
    const g = oneRoomFloor();
    g.items.i1 = {
      id: 'i1',
      preset: 'outlet-01',
      mount: 'wall',
      wall: 'nope',
      side: 'left',
      offset: 1,
      elevation: 0.3,
    };
    expect(err(proj([g])).issues[0]!.ids).toContain('i1');
  });
});
