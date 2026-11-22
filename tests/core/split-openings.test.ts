// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addWall,
  dropNode,
  splitWall,
  type Command,
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
const partition = (x: number, thickness = 0.2): Command =>
  addWall({ from: { at: { x, y: 0 } }, to: { at: { x, y: 4 } }, thickness });

function expectCut(doc: H3xDocument, cmd: Command): void {
  const before = structuredClone(doc.floor);
  const r = doc.tryExecute(cmd);
  expect(r).toMatchObject({ ok: false, issues: [{ code: 'split-cuts-opening' }] });
  if (!r.ok) expect(r.issues[0]!.ids).toEqual(['o1', 'w1']);
  expect(doc.floor).toEqual(before);
}

// o1 spans 0.75 .. 1.65 on w1 and keeps 0.1 m from a junction.
describe('a wall never pushes an opening aside', () => {
  it.each([0.8, 1, 1.2, 1.3, 1.6, 1.7])('rejects a partition at x = %s', (x) => {
    expectCut(mk(), partition(x));
  });

  it.each([0.65, 1.75, 3])('accepts one clear of the door at x = %s', (x) => {
    const doc = mk();
    doc.execute(partition(x));
    const o = doc.floor.openings.o1!;
    expect(doc.floor.nodes[doc.floor.walls[o.wall]!.a]!.x + o.offset).toBeCloseTo(1.2, 6);
  });

  it('counts the thickness of the new wall', () => {
    expectCut(mk(), partition(1.8, 0.4));
    expect(mk().tryExecute(partition(1.85, 0.4)).ok).toBe(true);
  });

  it('rejects a wall that only crosses the wall of the door', () => {
    expectCut(
      mk(),
      addWall({ from: { at: { x: 1.2, y: -1 } }, to: { at: { x: 1.2, y: 1 } }, thickness: 0.1 }),
    );
  });

  it('rejects a thick wall drawn from a node beside the door', () => {
    const f = oneRoomFloor();
    f.openings.o1!.offset = 0.55;
    expectCut(
      mk(f),
      addWall({ from: { node: 'n1' }, to: { at: { x: -2, y: -2 } }, thickness: 0.6 }),
    );
  });

  it('rejects splitWall inside the door', () => {
    expectCut(mk(), splitWall('w1', { x: 1, y: 0 }));
  });

  it('rejects dropNode into the door', () => {
    const f = oneRoomFloor();
    f.nodes.k = { id: 'k', x: 1.2, y: 1 };
    f.nodes.p = { id: 'p', x: 1.2, y: 2.5 };
    f.walls.wk = { ...f.walls.w1!, id: 'wk', a: 'p', b: 'k' };
    expectCut(mk(f), dropNode('k', { wall: 'w1', at: { x: 1.2, y: 0 } }));
  });

  it('leaves an opening that was already invalid where it is', () => {
    const f = oneRoomFloor();
    f.openings.o1!.offset = 0.4; // already too close to n1
    const doc = mk(f);
    doc.execute(partition(3));
    expect(doc.floor.openings.o1!.offset).toBe(0.4);
  });
});
