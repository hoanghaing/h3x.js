// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { moveNode, moveWall, setWallLength } from '../../src/core/commands/layout';
import { H3xValidationError } from '../../src/core/errors';
import { layoutValidator, validateLayout } from '../../src/core/validate/layout';
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

  it('setWallLength anchor b keeps b fixed and moves a; undo restores', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(setWallLength('w1', 3, { anchor: 'b' }));
    expect(doc.floor.nodes.n1!.x).toBeCloseTo(1);
    expect(doc.floor.nodes.n1!.y).toBeCloseTo(0);
    expect(doc.floor.nodes.n2).toMatchObject({ x: 4, y: 0 });
    doc.undo();
    expect(doc.floor.nodes.n1).toMatchObject({ x: 0, y: 0 });
  });

  it('setWallLength with no opts and anchor a both keep a fixed', () => {
    for (const opts of [undefined, { anchor: 'a' as const }]) {
      const doc = mk(oneRoomFloor());
      doc.execute(setWallLength('w1', 3, opts));
      expect(doc.floor.nodes.n1).toMatchObject({ x: 0, y: 0 });
      expect(doc.floor.nodes.n2!.x).toBeCloseTo(3);
      expect(doc.floor.nodes.n2!.y).toBeCloseTo(0);
    }
  });

  it('setWallLength anchor b keeps openings fixed relative to node b; undo restores', () => {
    const f = oneRoomFloor();
    f.openings.o1!.offset = 3;
    const doc = mk(f);
    doc.execute(setWallLength('w1', 3, { anchor: 'b' }));
    expect(doc.floor.openings.o1!.offset).toBeCloseTo(2);
    doc.undo();
    expect(doc.floor.openings.o1!.offset).toBe(3);
  });

  it('setWallLength anchor b keeps wall items fixed relative to node b; undo restores', () => {
    const f = oneRoomFloor();
    f.openings = {};
    f.items.i1 = {
      id: 'i1',
      preset: 'outlet-01',
      mount: 'wall',
      wall: 'w1',
      side: 'left',
      offset: 3,
      elevation: 0.3,
    };
    const doc = mk(f);
    doc.execute(setWallLength('w1', 3, { anchor: 'b' }));
    expect((doc.floor.items.i1 as { offset: number }).offset).toBeCloseTo(2);
    doc.undo();
    expect((doc.floor.items.i1 as { offset: number }).offset).toBe(3);
  });

  it('setWallLength anchor b still re-fits contents that end up out of range', () => {
    const doc = mk(oneRoomFloor());
    // o1 (0.9 wide) sits 2.8 m from n2; on a 2 m wall that shift lands it at -0.8, clamped to 0.55.
    doc.execute(setWallLength('w1', 2, { anchor: 'b' }));
    expect(doc.floor.openings.o1!.offset).toBeCloseTo(0.55);
  });

  it('setWallLength anchor b below minimum throws wall-too-short', () => {
    const doc = mk(oneRoomFloor());
    try {
      doc.execute(setWallLength('w1', 0.2, { anchor: 'b' }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(H3xValidationError);
      expect((e as H3xValidationError).issues[0]!.code).toBe('wall-too-short');
    }
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
    // 2 - 0.1 (half of the 0.2 m meeting wall w2) - 0.04 (half the outlet): I5.
    expect((doc.floor.items.i1 as { offset: number }).offset).toBeCloseTo(1.86);
  });

  it('pre-existing problems elsewhere do not block unrelated edits', () => {
    const f = twoRoomFloor();
    f.nodes.n3 = { id: 'n3', x: 4.2, y: 0 }; // w2 is now 0.2 m
    const doc = mk(f);
    expect(doc.validateLayout().some((i) => i.code === 'wall-too-short')).toBe(true);
    expect(doc.tryExecute(moveNode('n6', { x: 0, y: 5 })).ok).toBe(true);
  });
});

describe('holes, columns and site validation', () => {
  const addBox = (f: Floor, id: string, x: number, y: number, s: number, t = 0.1): string[] => {
    const pts = [
      [x, y],
      [x, y + s],
      [x + s, y + s],
      [x + s, y],
    ] as const;
    pts.forEach(([px, py], i) => (f.nodes[`${id}n${i}`] = { id: `${id}n${i}`, x: px, y: py }));
    return pts.map((_, i) => {
      const wid = `${id}w${i}`;
      f.walls[wid] = {
        id: wid,
        a: `${id}n${i}`,
        b: `${id}n${(i + 1) % 4}`,
        thickness: t,
        height: 3.2,
      };
      return wid;
    });
  };
  const big = (): Floor => {
    const f = oneRoomFloor();
    f.openings = {};
    const c = [
      [0, 0],
      [8, 0],
      [8, 8],
      [0, 8],
    ] as const;
    c.forEach(([x, y], i) => (f.nodes[`n${i + 1}`] = { id: `n${i + 1}`, x, y }));
    return f;
  };
  const room = (f: Floor, holes: string[][]): void => {
    f.rooms.r1!.holes = holes;
  };
  const codes = (f: Floor, site?: Project['site']): string[] =>
    validateLayout(f, site).map((i) => i.code);

  it('accepts a hole inside the room', () => {
    const f = big();
    room(f, [addBox(f, 'a', 2, 2, 2)]);
    expect(codes(f)).toEqual([]);
  });

  it('accepts a hole touching the outer ring at a node', () => {
    const f = big();
    // Clockwise triangular hole sharing the outer corner node n1 (a pinch).
    f.nodes.p1 = { id: 'p1', x: 1, y: 3 };
    f.nodes.p2 = { id: 'p2', x: 3, y: 1 };
    const mkWall = (id: string, a: string, b: string): string => {
      f.walls[id] = { id, a, b, thickness: 0.1, height: 3.2 };
      return id;
    };
    const ids = [mkWall('dw0', 'n1', 'p1'), mkWall('dw1', 'p1', 'p2'), mkWall('dw2', 'p2', 'n1')];
    room(f, [ids]);
    expect(codes(f)).toEqual([]);
  });

  it('flags a hole crossing the outer ring', () => {
    const f = big();
    room(f, [addBox(f, 'a', 7, 2, 2)]);
    expect(codes(f)).toContain('room-degenerate');
  });

  it('blocks moving a hole node through the outer ring', () => {
    const f = big();
    room(f, [addBox(f, 'a', 2, 2, 2)]);
    const doc = mk(f);
    const r = doc.tryExecute(moveNode('an2', { x: 9, y: 4 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.some((i) => i.code === 'room-degenerate' && i.ids.includes('r1'))).toBe(
        true,
      );
    }
  });

  it('flags overlapping holes', () => {
    const f = big();
    room(f, [addBox(f, 'a', 2, 2, 2), addBox(f, 'b', 3, 3, 2)]);
    expect(codes(f)).toContain('room-degenerate');
  });

  it('flags net inner area below the minimum', () => {
    const f = big();
    room(f, [addBox(f, 'a', 0.15, 0.15, 7.7)]);
    expect(codes(f)).toContain('room-degenerate');
  });

  const col = (f: Floor, id: string, over: Partial<Floor['columns'][string]>): void => {
    f.columns[id] = {
      id,
      x: 1,
      y: 1,
      shape: 'square',
      width: 0.4,
      rotation: 0,
      ...over,
    };
  };

  it.each([
    ['width 0', { width: 0 }],
    ['width 2.5', { width: 2.5 }],
    ['depth -1', { depth: -1 }],
  ])('blocks column-size for %s', (_n, over) => {
    const f = oneRoomFloor();
    col(f, 'c1', over);
    expect(codes(f)).toContain('column-size');
    const doc = mk(f);
    const issues = layoutValidator(doc, [{ kind: 'column', id: 'c1', before: null, after: f.columns.c1! }]);
    expect(issues.map((i) => i.code)).toContain('column-size');
  });

  it('reports columns-overlap only from validateLayout', () => {
    const f = oneRoomFloor();
    col(f, 'c1', {});
    col(f, 'c2', { x: 1.2 });
    expect(codes(f)).toContain('columns-overlap');
    const doc = mk(f);
    const issues = layoutValidator(doc, [{ kind: 'column', id: 'c1', before: null, after: f.columns.c1! }]);
    expect(issues.map((i) => i.code)).not.toContain('columns-overlap');
  });

  it('does not flag touching or separate columns', () => {
    const f = oneRoomFloor();
    col(f, 'c1', {});
    col(f, 'c2', { x: 1.4 });
    col(f, 'c3', { shape: 'round', x: 3, y: 3 });
    expect(codes(f)).not.toContain('columns-overlap');
  });

  it('flags a bow-tie site', () => {
    const site = {
      id: 'site' as const,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
        { x: 5, y: 0 },
        { x: 0, y: 5 },
      ],
    };
    expect(codes(oneRoomFloor(), site)).toContain('site-not-simple');
    expect(codes(oneRoomFloor())).not.toContain('site-not-simple');
  });
});
