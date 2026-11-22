// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  mergeNodes,
  moveNode,
  moveWall,
  pushPullWall,
  type Floor,
  type Id,
  type Project,
  type Vec2,
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

/** Plan position of the centre of an opening or wall item. */
function centre(doc: H3xDocument, id: Id): Vec2 {
  const f = doc.floor;
  const e = (f.openings[id] ?? f.items[id]) as { wall: Id; offset: number };
  const w = f.walls[e.wall]!;
  const a = f.nodes[w.a]!;
  const b = f.nodes[w.b]!;
  const t = e.offset / Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** A window and an outlet on each side wall; `w2` starts at the bottom wall, `w4` ends there. */
function sideWindows(): Floor {
  const f = oneRoomFloor();
  for (const wall of ['w2', 'w4']) {
    f.openings[`o-${wall}`] = { ...f.openings.o1!, id: `o-${wall}`, wall, offset: 2, width: 0.8 };
    f.items[`i-${wall}`] = {
      id: `i-${wall}`,
      mount: 'wall',
      preset: 'outlet-01',
      wall,
      side: 'left',
      offset: 3,
      elevation: 0.3,
    };
  }
  return f;
}

const SIDES = ['o-w2', 'i-w2', 'o-w4', 'i-w4'];

describe('openings and wall items stay in place when a wall end moves', () => {
  it.each([
    ['moveWall outward', () => moveWall('w1', { x: 0, y: -1 })],
    ['moveWall inward', () => moveWall('w1', { x: 0, y: 0.5 })],
    ['pushPullWall outward', () => pushPullWall('w1', -1)],
    ['pushPullWall inward', () => pushPullWall('w1', 0.5)],
  ])('%s, whichever way the neighbours were drawn', (_, cmd) => {
    const doc = mk(sideWindows());
    const before = SIDES.map((id) => centre(doc, id));
    doc.execute(cmd());
    SIDES.forEach((id, i) => {
      expect(centre(doc, id).x).toBeCloseTo(before[i]!.x, 6);
      expect(centre(doc, id).y).toBeCloseTo(before[i]!.y, 6);
    });
  });

  it.each([
    ['a', 'n1', -1],
    ['b', 'n2', 5],
  ])('moveNode of end %s along the wall', (_, node, x) => {
    const doc = mk(oneRoomFloor());
    doc.execute(moveNode(node, { x, y: 0 }));
    expect(centre(doc, 'o1').x).toBeCloseTo(1.2, 6);
  });

  it('mergeNodes that moves end a', () => {
    const f = oneRoomFloor();
    f.nodes.k = { id: 'k', x: -1, y: 0 };
    f.nodes.p = { id: 'p', x: -1, y: -2 };
    f.walls.wk = { ...f.walls.w1!, id: 'wk', a: 'k', b: 'p' };
    const doc = mk(f);
    doc.execute(mergeNodes('k', 'n1'));
    expect(centre(doc, 'o1').x).toBeCloseTo(1.2, 6);
  });
});
