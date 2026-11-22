import { describe, expect, it } from 'vitest';
import { computeJoins } from '../../src/shared/walls/joins';
import {
  columnShape,
  itemFootprint,
  junctionPolygons,
  openingShape,
  roomLabel,
  roomPath,
  wallOutline,
} from '../../src/plan/shapes';
import { holedRoomFloor, oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';
import { roomShape, type Column, type FloorItem, type WallItem } from '../../src/core';

const xs = (pts: { x: number }[]) => pts.map((p) => p.x);
const ys = (pts: { y: number }[]) => pts.map((p) => p.y);

describe('wallOutline', () => {
  it('returns the mitred corners of a wall', () => {
    const floor = oneRoomFloor();
    const c = computeJoins(floor).corners['w1']!;
    const o = wallOutline(c);
    expect(o).toHaveLength(4);
    expect(o[0]!.y).toBeCloseTo(0.1);
    expect(o[1]!.y).toBeCloseTo(0.1);
    expect(o[2]!.y).toBeCloseTo(-0.1);
    expect(o[3]!.y).toBeCloseTo(-0.1);
    expect(Math.min(...xs(o))).toBeCloseTo(-0.1);
    expect(Math.max(...xs(o))).toBeCloseTo(4.1);
    // inner side (towards +y, the room) spans [0.1, 3.9]
    expect(o[0]!.x).toBeCloseTo(0.1);
    expect(o[1]!.x).toBeCloseTo(3.9);
  });
});

describe('junctionPolygons', () => {
  it('maps node id to junction points', () => {
    const floor = twoRoomFloor();
    const joins = computeJoins(floor);
    const polys = junctionPolygons(joins);
    expect(Object.keys(polys).sort()).toEqual(Object.keys(joins.junctions).sort());
    for (const id of Object.keys(polys)) expect(polys[id]).toBe(joins.junctions[id]!.points);
  });
});

describe('roomLabel', () => {
  it('labels a convex room', () => {
    const floor = oneRoomFloor();
    const l = roomLabel(floor, floor.rooms['r1']!);
    expect(l.area).toBe('14.4 m²');
    expect(l.name).toBe('Phòng khách');
    expect(l.at.x).toBeGreaterThan(0.1);
    expect(l.at.x).toBeLessThan(3.9);
    expect(l.at.y).toBeGreaterThan(0.1);
    expect(l.at.y).toBeLessThan(3.9);
  });

  it('centres the label in a rectangular room', () => {
    const floor = oneRoomFloor();
    const { at } = roomLabel(floor, floor.rooms['r1']!);
    expect(at.x).toBeCloseTo(2);
    expect(at.y).toBeCloseTo(2);
  });

  it('centres the label vertically in a wide, short room', () => {
    const floor = oneRoomFloor();
    floor.nodes['n2']!.x = 7;
    floor.nodes['n3']!.x = 7;
    floor.nodes['n3']!.y = 2.5;
    floor.nodes['n4']!.y = 2.5;
    const { at } = roomLabel(floor, floor.rooms['r1']!);
    expect(at.x).toBeCloseTo(3.5);
    expect(at.y).toBeCloseTo(1.25);
  });

  it('puts the label inside an L-shaped room', () => {
    const floor = oneRoomFloor();
    const pts = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ] as const;
    floor.nodes = {};
    floor.walls = {};
    pts.forEach(([x, y], i) => (floor.nodes[`n${i}`] = { id: `n${i}`, x, y }));
    pts.forEach((_, i) => {
      floor.walls[`w${i}`] = {
        id: `w${i}`,
        a: `n${i}`,
        b: `n${(i + 1) % pts.length}`,
        thickness: 0.2,
        height: 3,
      };
    });
    floor.openings = {};
    floor.rooms = { r1: { id: 'r1', walls: Object.keys(floor.walls), name: 'L' } };
    const { at } = roomLabel(floor, floor.rooms['r1']!);
    const inArm1 = at.x > 0.1 && at.x < 3.9 && at.y > 0.1 && at.y < 0.9;
    const inArm2 = at.x > 0.1 && at.x < 0.9 && at.y > 0.1 && at.y < 3.9;
    expect(inArm1 || inArm2).toBe(true);
  });
});

describe('openingShape', () => {
  it('builds a door with hinge at the near end', () => {
    const floor = oneRoomFloor();
    const s = openingShape(floor, floor.openings['o1']!);
    expect(s.kind).toBe('door');
    expect(Math.min(...xs(s.gap))).toBeCloseTo(0.75);
    expect(Math.max(...xs(s.gap))).toBeCloseTo(1.65);
    expect(s.leaf![0].x).toBeCloseTo(0.75);
    expect(s.leaf![1].y).toBeCloseTo(0.9);
    expect(s.arc!.r).toBeCloseTo(0.9);
    expect(s.arc!.center.x).toBeCloseTo(0.75);
    expect(s.lines).toBeUndefined();
  });

  it('mirrors the door when hinged at the other end', () => {
    const floor = oneRoomFloor();
    const o = { ...floor.openings['o1']!, hinge: 'b' as const, swing: 'right' as const };
    const s = openingShape(floor, o);
    expect(s.leaf![0].x).toBeCloseTo(1.65);
    expect(s.leaf![1].y).toBeCloseTo(-0.9);
    expect(s.arc!.center.x).toBeCloseTo(1.65);
  });

  it.each([
    [false, { x: 0.75, y: 0.9 }, { x: 1.65, y: 0 }, { x: 0.75, y: 0 }],
    [true, { x: 1.65, y: -0.9 }, { x: 0.75, y: 0 }, { x: 1.65, y: 0 }],
  ])('arc geometry for mirrored=%s', (mirrored, from, to, center) => {
    const floor = oneRoomFloor();
    const s = openingShape(floor, {
      ...floor.openings['o1']!,
      hinge: mirrored ? 'b' : 'a',
      swing: mirrored ? 'right' : 'left',
    });
    const arc = s.arc!;
    expect(arc.from.x).toBeCloseTo(from.x);
    expect(arc.from.y).toBeCloseTo(from.y);
    expect(arc.to.x).toBeCloseTo(to.x);
    expect(arc.to.y).toBeCloseTo(to.y);
    expect(arc.center.x).toBeCloseTo(center.x);
    expect(arc.center.y).toBeCloseTo(center.y);
    // both go clockwise in plan space (+y up), so the SVG flag is 0
    expect(arc.sweep).toBe(0);
  });

  it('builds a window with three lines', () => {
    const floor = oneRoomFloor();
    const o = { ...floor.openings['o1']!, sill: 0.9 };
    const s = openingShape(floor, o);
    expect(s.kind).toBe('window');
    expect(s.arc).toBeUndefined();
    expect(s.leaf).toBeUndefined();
    expect(s.lines).toHaveLength(3);
    const lineYs = s.lines!.map((l) => l[0].y).sort((a, b) => a - b);
    expect(lineYs[0]).toBeCloseTo(-0.1);
    expect(lineYs[1]).toBeCloseTo(0);
    expect(lineYs[2]).toBeCloseTo(0.1);
  });
});

describe('itemFootprint', () => {
  it('is undefined for an unknown preset', () => {
    const floor = oneRoomFloor();
    const item: FloorItem = { id: 'i', preset: 'nope', mount: 'floor', x: 0, y: 0, rotation: 0 };
    expect(itemFootprint(item, floor, testPresets)).toBeUndefined();
    expect(itemFootprint(item, floor)).toBeUndefined();
  });

  it('rotates a floor item footprint', () => {
    const floor = oneRoomFloor();
    const item: FloorItem = {
      id: 'i',
      preset: 'bed-01',
      mount: 'floor',
      x: 1,
      y: 1,
      rotation: Math.PI / 2,
    };
    const presets = (id: string) =>
      id === 'bed-01' ? { mount: 'floor' as const, footprint: { w: 2, d: 1, h: 0.5 } } : undefined;
    const fp = itemFootprint(item, floor, presets)!;
    expect(Math.min(...xs(fp))).toBeCloseTo(0.5);
    expect(Math.max(...xs(fp))).toBeCloseTo(1.5);
    expect(Math.min(...ys(fp))).toBeCloseTo(0);
    expect(Math.max(...ys(fp))).toBeCloseTo(2);
  });

  it('places a wall item against the given side', () => {
    const floor = oneRoomFloor();
    const item: WallItem = {
      id: 'i',
      preset: 'outlet-01',
      mount: 'wall',
      wall: 'w1',
      side: 'left',
      offset: 2,
      elevation: 0.3,
    };
    const fp = itemFootprint(item, floor, testPresets)!;
    expect(Math.min(...ys(fp))).toBeCloseTo(0.1);
    expect(Math.max(...ys(fp))).toBeCloseTo(0.2);
    expect(Math.min(...xs(fp))).toBeCloseTo(1.96);
    const right = itemFootprint({ ...item, side: 'right' }, floor, testPresets)!;
    expect(Math.max(...ys(right))).toBeCloseTo(-0.1);
  });
});

describe('columnShape', () => {
  const col: Column = { id: 'c1', x: 1, y: 2, shape: 'square', width: 2, rotation: 0 };

  it('gives a rotated square its four corners', () => {
    const shape = columnShape({ ...col, rotation: Math.PI / 4 });
    if (shape.kind !== 'polygon') throw new Error('expected polygon');
    expect(shape.points).toHaveLength(4);
    const r = Math.SQRT2;
    expect(Math.min(...xs(shape.points))).toBeCloseTo(1 - r);
    expect(Math.max(...xs(shape.points))).toBeCloseTo(1 + r);
    expect(Math.max(...ys(shape.points))).toBeCloseTo(2 + r);
    // A 45-degree square has a corner on each axis through its centre.
    expect(shape.points.some((p) => Math.abs(p.y - 2) < 1e-9 && p.x > 1)).toBe(true);
  });

  it('uses depth for the second side of a square', () => {
    const shape = columnShape({ ...col, depth: 1 });
    if (shape.kind !== 'polygon') throw new Error('expected polygon');
    expect(Math.max(...ys(shape.points)) - Math.min(...ys(shape.points))).toBeCloseTo(1);
  });

  it('gives a round column a circle of radius width / 2', () => {
    expect(columnShape({ ...col, shape: 'round', width: 0.6 })).toEqual({
      kind: 'circle',
      cx: 1,
      cy: 2,
      r: 0.3,
    });
  });
});

describe('room holes', () => {
  it('draws a room with a hole as one path of two subpaths', () => {
    const f = holedRoomFloor();
    const d = roomPath(roomShape(f, f.rooms.r1!, 'inner'));
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d.match(/Z/g)).toHaveLength(2);
  });

  it('keeps the label out of the hole', () => {
    const f = holedRoomFloor();
    const { at } = roomLabel(f, f.rooms.r1!);
    const inHole = at.x > 3.9 && at.x < 6.1 && at.y > 3.9 && at.y < 6.1;
    expect(inHole).toBe(false);
  });
});
