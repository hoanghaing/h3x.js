// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { addWall, H3xDocument, moveNode } from '../../src/core';
import { detectRooms, roomArea } from '../../src/core/rooms/detect';
import type { Floor, Vec2 } from '../../src/core/types';
import { oneRoomFloor } from '../fixtures/floors';

/** Walls w<i> from pts[i] to pts[i + 1], listed counter-clockwise; room `r` uses all of them. */
function ringFloor(pts: Array<[number, number]>, thickness: number[] = []): Floor {
  const f = oneRoomFloor();
  f.nodes = {};
  f.walls = {};
  f.openings = {};
  pts.forEach(([x, y], i) => {
    f.nodes[`n${i}`] = { id: `n${i}`, x, y };
    f.walls[`w${i}`] = {
      id: `w${i}`,
      a: `n${i}`,
      b: `n${(i + 1) % pts.length}`,
      thickness: thickness[i] ?? 0.2,
      height: 3,
    };
  });
  f.rooms = { r: { id: 'r', name: '', walls: pts.map((_, i) => `w${i}`) } };
  return f;
}

const collapsed: Array<[string, Array<[number, number]>, number[]?]> = [
  [
    'triangle rounded to 4 decimals',
    [
      [4.5, 12.4],
      [4.4048, 12.0861],
      [3.0216, 7.5251],
    ],
    [0.2, 0.1, 0.1],
  ],
  [
    'triangle with an inradius of half the inset',
    [
      [0, 0],
      [20, 0],
      [10, 0.1],
    ],
  ],
  [
    'triangle thinner still',
    [
      [0, 0],
      [20, 0],
      [10, 0.04],
    ],
  ],
  [
    'rhombus',
    [
      [0, 0],
      [10, -0.03],
      [20, 0],
      [10, 0.03],
    ],
  ],
  [
    'pentagon',
    [
      [0, 0],
      [10, -0.02],
      [20, 0],
      [15, 0.02],
      [5, 0.02],
    ],
  ],
];

describe('rooms narrower than their walls', () => {
  it.each(collapsed)('%s: no room is detected', (_, pts, thickness) => {
    expect(detectRooms(ringFloor(pts, thickness))).toEqual([]);
  });

  it.each(collapsed)('%s: a stored room has no inner area', (_, pts, thickness) => {
    const f = ringFloor(pts, thickness);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(0, 9);
  });

  it('a collapsed spike does not add to the area of the room it hangs off', () => {
    const f = ringFloor([
      [0, 0],
      [5, 0],
      [5, 2.49],
      [15, 2.5],
      [5, 2.51],
      [5, 5],
      [0, 5],
    ]);
    expect(detectRooms(f)).toHaveLength(1);
    const area = roomArea(f, f.rooms.r!, 'inner');
    // Inside the square's inner faces, plus at most the mouth of the spike.
    expect(area).toBeGreaterThanOrEqual(4.8 * 4.8 - 1e-6);
    expect(area).toBeLessThan(4.8 * 4.8 + 0.01);
  });

  it('a room with a chamfer shorter than the inset keeps its area', () => {
    const f = ringFloor([
      [0, 0],
      [4, 0],
      [4, 2.95],
      [3.95, 3],
      [0, 3],
    ]);
    expect(detectRooms(f)).toHaveLength(1);
    expect(roomArea(f, f.rooms.r!, 'inner')).toBeCloseTo(3.8 * 2.8, 2);
  });

  const triangle = (): { doc: H3xDocument; apex: string } => {
    const doc = H3xDocument.create();
    const pts: Vec2[] = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 10, y: 4 },
    ];
    pts.forEach((at, i) =>
      doc.execute(addWall({ from: { at }, to: { at: pts[(i + 1) % 3]! }, thickness: 0.2 })),
    );
    return { doc, apex: Object.values(doc.floor.nodes).find((n) => n.y === 4)!.id };
  };

  it.each([0.16, 0.1, 0.04, 0.02])('rejects a drag that flattens a room to %s m', (y) => {
    const { doc, apex } = triangle();
    const before = doc.toXML();
    const res = doc.tryExecute(moveNode(apex, { x: 10, y }));
    expect(res.ok ? [] : res.issues.map((i) => i.code)).toContain('room-degenerate');
    expect(doc.toXML()).toBe(before);
  });

  it('loads a saved sliver of walls without a room', () => {
    const xml = `<h3x version="1" unit="m"><floor id="f1" level="0" wallHeight="3">
      <node id="n0" x="4.5" y="12.4"/><node id="n1" x="4.4048" y="12.0861"/>
      <node id="n2" x="3.0216" y="7.5251"/>
      <wall id="a" a="n0" b="n1" thickness="0.2" height="3"/>
      <wall id="b" a="n1" b="n2" thickness="0.1" height="3"/>
      <wall id="c" a="n2" b="n0" thickness="0.1" height="3"/>
    </floor></h3x>`;
    expect(Object.keys(H3xDocument.fromXML(xml).floor.rooms)).toEqual([]);
  });

  it('reports a collapsed room stored in a file', () => {
    const xml = `<h3x version="1" unit="m"><floor id="f1" level="0" wallHeight="3">
      <node id="n0" x="0" y="0"/><node id="n1" x="20" y="0"/><node id="n2" x="10" y="0.04"/>
      <wall id="a" a="n0" b="n1" thickness="0.2" height="3"/>
      <wall id="b" a="n1" b="n2" thickness="0.2" height="3"/>
      <wall id="c" a="n2" b="n0" thickness="0.2" height="3"/>
      <room id="r" walls="a b c" name=""/>
    </floor></h3x>`;
    const codes = H3xDocument.fromXML(xml)
      .validateLayout()
      .map((i) => i.code);
    expect(codes).toContain('room-degenerate');
  });
});
