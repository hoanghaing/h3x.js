// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { H3xValidationError } from '../../src/core/errors';
import {
  addFloor,
  removeFloor,
  setFloorHeight,
  setGroundElevation,
  setSlabThickness,
} from '../../src/core/commands/floors';
import { oneRoomFloor } from '../fixtures/floors';
import type { Project } from '../../src/core/types';

function groundDoc(): H3xDocument {
  const f = oneRoomFloor();
  f.elevation = 0.45;
  f.items = {
    i1: {
      id: 'i1',
      mount: 'floor',
      preset: 'sofa-3s-01',
      x: 2,
      y: 2,
      rotation: 0,
    },
  } as never;
  f.columns = {
    c1: { id: 'c1', x: 1, y: 1, shape: 'round', width: 0.3, rotation: 0 },
    c2: { id: 'c2', x: 3, y: 3, shape: 'square', width: 0.3, rotation: 0 },
  };
  return H3xDocument.fromProject({
    version: 1,
    unit: 'm',
    meta: { name: '', created: '' },
    floors: [f],
  });
}

function stackDoc(n: number): H3xDocument {
  const d = groundDoc();
  for (let i = 1; i < n; i++) d.execute(addFloor({ position: 'above' }));
  return d;
}

const snap = (d: H3xDocument): Project => structuredClone(d.project) as Project;
const code = (fn: () => void): string | undefined => {
  try {
    fn();
  } catch (e) {
    return e instanceof H3xValidationError ? e.issues[0]!.code : 'other';
  }
  return undefined;
};

describe('addFloor', () => {
  it('copies structure above and leaves the rest alone', () => {
    const d = groundDoc();
    const before = snap(d);
    const cmd = addFloor({ position: 'above' });
    d.execute(cmd);
    const nf = d.floorById(cmd.createdId)!;
    const src = d.floorById('f1')!;
    expect(Object.keys(nf.walls)).toHaveLength(4);
    expect(Object.keys(nf.columns)).toHaveLength(2);
    expect(Object.values(nf.columns).map((c) => [c.x, c.y])).toEqual(
      Object.values(src.columns).map((c) => [c.x, c.y]),
    );
    expect(Object.keys(nf.openings)).toHaveLength(0);
    expect(Object.keys(nf.items)).toHaveLength(0);
    const rooms = Object.values(nf.rooms);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.name).toBe('');
    const srcIds = new Set(
      [src.nodes, src.walls, src.openings, src.rooms, src.items, src.columns].flatMap(Object.keys),
    );
    for (const c of [nf.nodes, nf.walls, nf.rooms, nf.columns])
      for (const id of Object.keys(c)) expect(srcIds.has(id)).toBe(false);
    for (const w of Object.values(nf.walls)) {
      expect(nf.nodes[w.a]).toBeDefined();
      expect(nf.nodes[w.b]).toBeDefined();
    }
    expect(nf.level).toBe(1);
    expect(nf.elevation).toBeCloseTo(0.45 + 3.2 + 0.15, 9);
    expect(d.activeFloorId).toBe('f1');
    d.undo();
    expect(d.project).toEqual(before);
  });

  it('addFloor with a wallHeight gives copied walls at the source height the new height', () => {
    const f = oneRoomFloor();
    f.walls.w2!.height = 2.4;
    const d = H3xDocument.fromProject({
      version: 1,
      unit: 'm',
      meta: { name: '', created: '' },
      floors: [f],
    });
    const before = snap(d);
    const cmd = addFloor({ position: 'above', wallHeight: 3.5 });
    d.execute(cmd);
    const heights = Object.values(d.floorById(cmd.createdId)!.walls)
      .map((w) => w.height)
      .sort();
    expect(heights).toEqual([2.4, 3.5, 3.5, 3.5]);
    for (const w of Object.values(d.floorById('f1')!.walls)) expect([2.4, 3.2]).toContain(w.height);
    d.undo();
    expect(d.project).toEqual(before);
  });

  it('adds below with level -1 and keeps ground', () => {
    const d = groundDoc();
    const cmd = addFloor({ position: 'below' });
    d.execute(cmd);
    const nf = d.floorById(cmd.createdId)!;
    expect(nf.level).toBe(-1);
    expect(nf.elevation).toBeCloseTo(0.45 - 0.15 - 3.2, 9);
    expect(d.floorById('f1')!.level).toBe(0);
    expect(d.floorById('f1')!.elevation).toBe(0.45);
    expect(d.project.floors[0]!.id).toBe(cmd.createdId);
  });

  it('undo of an added active floor returns to ground; change precedes activefloor', () => {
    const d = groundDoc();
    const cmd = addFloor({ position: 'above' });
    d.execute(cmd);
    d.setActiveFloor(cmd.createdId);
    const order: string[] = [];
    d.on('change', () => order.push('change'));
    d.on('activefloor', () => order.push('activefloor'));
    d.undo();
    expect(d.activeFloorId).toBe('f1');
    expect(order).toEqual(['change', 'activefloor']);
  });
});

describe('removeFloor', () => {
  it('renumbers and re-derives elevations, undoable', () => {
    const d = stackDoc(4);
    const [f0, f1, f2, f3] = d.project.floors;
    const before = snap(d);
    d.execute(removeFloor(f2!.id));
    expect(d.project.floors.map((f) => f.level)).toEqual([0, 1, 2]);
    const now3 = d.floorById(f3!.id)!;
    expect(now3.level).toBe(2);
    expect(now3.elevation).toBeCloseTo(f1!.elevation + f1!.wallHeight + f3!.slabThickness, 9);
    expect(d.floorById(f0!.id)!.elevation).toBe(0.45);
    d.undo();
    expect(d.project).toEqual(before);
  });

  it('protects level 0, the last floor and rejects unknown ids', () => {
    const d = groundDoc();
    expect(code(() => d.execute(removeFloor('f1')))).toBe('floor-protected');
    expect(code(() => d.execute(removeFloor('nope')))).toBe('unknown-floor');
    const d2 = stackDoc(2);
    expect(code(() => d2.execute(removeFloor('f1')))).toBe('floor-protected');
  });
});

describe('floor sizing', () => {
  it('setFloorHeight shifts floors above', () => {
    const d = stackDoc(3);
    const [f0, f1, f2] = d.project.floors.map((f) => f.elevation);
    d.execute(setFloorHeight('f1', 3.0));
    expect(d.project.floors[0]!.wallHeight).toBe(3.0);
    expect(d.project.floors[1]!.elevation).toBeCloseTo(f1! - 0.2, 9);
    expect(d.project.floors[2]!.elevation).toBeCloseTo(f2! - 0.2, 9);
    expect(d.project.floors[0]!.elevation).toBe(f0);
    d.undo();
    expect(d.project.floors[1]!.elevation).toBeCloseTo(f1!, 9);
  });

  it('setFloorHeight moves walls at the old storey height, keeps custom heights; one undo', () => {
    const f = oneRoomFloor();
    f.walls.w2!.height = 2.4;
    const d = H3xDocument.fromProject({
      version: 1,
      unit: 'm',
      meta: { name: '', created: '' },
      floors: [f],
    });
    const before = snap(d);
    const cmd = setFloorHeight('f1', 3.6);
    const changes = cmd.run(ctx(d));
    const wallChanges = changes.filter((c) => c.kind === 'wall');
    expect(wallChanges.map((c) => c.id).sort()).toEqual(['w1', 'w3', 'w4']);
    for (const c of wallChanges) expect(c.floorId).toBe('f1');
    d.execute(cmd);
    const walls = d.floorById('f1')!.walls;
    expect(walls.w1!.height).toBe(3.6);
    expect(walls.w3!.height).toBe(3.6);
    expect(walls.w4!.height).toBe(3.6);
    expect(walls.w2!.height).toBe(2.4);
    expect(d.floorById('f1')!.wallHeight).toBe(3.6);
    d.undo();
    expect(d.project).toEqual(before);
  });

  it("setFloorHeight on another floor updates that floor's walls only", () => {
    const d = stackDoc(2);
    const up = d.project.floors[1]!.id;
    d.execute(setFloorHeight(up, 2.9));
    for (const w of Object.values(d.floorById(up)!.walls)) expect(w.height).toBe(2.9);
    for (const w of Object.values(d.floorById('f1')!.walls)) expect(w.height).toBe(3.2);
  });

  it('rejects bad dimensions', () => {
    const d = stackDoc(2);
    const f1 = d.project.floors[1]!.id;
    expect(code(() => d.execute(setSlabThickness(f1, 0)))).toBe('invalid-floor-dimension');
    expect(code(() => d.execute(setFloorHeight(f1, NaN)))).toBe('invalid-floor-dimension');
    expect(code(() => d.execute(setFloorHeight('nope', 3)))).toBe('unknown-floor');
  });

  it('setGroundElevation moves every floor', () => {
    const d = stackDoc(3);
    const before = d.project.floors.map((f) => f.elevation);
    d.execute(setGroundElevation(0.6));
    d.project.floors.forEach((f, i) => expect(f.elevation).toBeCloseTo(before[i]! + 0.15, 9));
  });

  it('is a no-op when nothing changes', () => {
    const d = stackDoc(2);
    expect(setGroundElevation(0.45).run({ ...ctx(d) })).toEqual([]);
  });
});

function ctx(d: H3xDocument) {
  return { floor: d.floor, floorId: d.activeFloorId, project: d.project };
}
