import { describe, expect, it } from 'vitest';
import { pointInPolygon } from '../../src/core/geometry/polygon';
import { wallOutline } from '../../src/core/shapes';
import { openingRange } from '../../src/core/validate/layout';
import { computeJoins } from '../../src/shared/walls/joins';
import { hitTest, type HitScene } from '../../src/plan/hit';
import { planToScreen, type View } from '../../src/plan/view';
import { holedRoomFloor, oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';
import { openingFloor } from '../fixtures/openings';
import type { Floor, FloorItem } from '../../src/core';

const view: View = { cx: 2, cy: 2, scale: 50, width: 400, height: 400 };

function scene(extra: Partial<HitScene> = {}): HitScene {
  const floor = oneRoomFloor();
  return { floor, view, corners: computeJoins(floor).corners, dimensions: [], ...extra };
}
const at = (x: number, y: number) => planToScreen(view, { x, y });

describe('hitTest', () => {
  it('hits a node within 8 px', () => {
    const n = at(4, 0);
    expect(hitTest(scene(), { x: n.x + 3, y: n.y })).toEqual({ kind: 'node', id: 'n2' });
  });

  it('hits a wall at its midpoint', () => {
    expect(hitTest(scene(), at(3, 0))).toEqual({ kind: 'wall', id: 'w1' });
  });

  it('hits a thin wall within 4 px of its centre line, not beyond', () => {
    const s = scene();
    s.floor.walls['w1']!.thickness = 0.02;
    s.corners = computeJoins(s.floor).corners;
    const p = at(3, 0);
    expect(hitTest(s, { x: p.x, y: p.y - 3.5 })).toEqual({ kind: 'wall', id: 'w1' });
    expect(hitTest(s, { x: p.x, y: p.y - 6 })).toEqual({ kind: 'room', id: 'r1' });
  });

  it.each([50, 100, 200, 800, 2000])('hits every point of a junction fill at %s px/m', (scale) => {
    const floor = oneRoomFloor();
    floor.openings = {};
    floor.nodes.t = { id: 't', x: 2, y: 0 };
    floor.nodes.c = { id: 'c', x: 2.9, y: 2 };
    floor.walls.w1!.b = 't';
    floor.walls.w1b = { ...floor.walls.w2!, id: 'w1b', a: 't', b: 'n2' };
    floor.walls.skew = { ...floor.walls.w2!, id: 'skew', a: 't', b: 'c' };
    const { corners, junctions } = computeJoins(floor);
    const v = { ...view, scale };
    const s = scene({ floor, corners, junctions, view: v });
    let inside = 0;
    for (const [node, { points }] of Object.entries(junctions)) {
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      for (let x = Math.min(...xs) + 0.003; x < Math.max(...xs); x += 0.011) {
        for (let y = Math.min(...ys) + 0.003; y < Math.max(...ys); y += 0.011) {
          if (!pointInPolygon({ x, y }, points)) continue;
          inside++;
          const hit = hitTest(s, planToScreen(v, { x, y }));
          if (hit?.kind === 'wall') {
            const w = floor.walls[hit.id]!;
            // A wall that meets at this junction, or the one drawn over this point.
            const meets = w.a === node || w.b === node;
            expect(meets || pointInPolygon({ x, y }, wallOutline(corners[hit.id]!))).toBe(true);
          } else {
            expect(hit?.kind).toBe('node');
          }
        }
      }
    }
    expect(inside).toBeGreaterThan(0);
  });

  it('hits an opening inside its gap', () => {
    expect(hitTest(scene(), at(1.2, 0))).toEqual({ kind: 'opening', id: 'o1' });
  });

  it('hits an item', () => {
    const s = scene({ presets: testPresets });
    const item: FloorItem = {
      id: 'i1',
      preset: 'sofa-3s-01',
      mount: 'floor',
      x: 2,
      y: 2,
      rotation: 0,
    } as FloorItem;
    s.floor.items['i1'] = item;
    expect(hitTest(s, at(2, 2))).toEqual({ kind: 'item', id: 'i1' });
  });

  it('hits a roof inside its overhang outline, after walls and before rooms; hidden roofs are skipped', () => {
    const s = scene();
    s.floor.roofs['rf'] = {
      id: 'rf',
      kind: 'flat',
      follow: true,
      rooms: ['r1'],
      pitch: 0,
      base: 0,
      overhang: 0.5,
      gableOverhang: 0.3,
      thickness: 0.1,
      material: 'concrete',
    } as Floor['roofs'][string];
    expect(hitTest(s, at(3, 0))).toEqual({ kind: 'wall', id: 'w1' });
    expect(hitTest(s, at(2, 2))).toEqual({ kind: 'roof', id: 'rf' });
    expect(hitTest({ ...s, roofsVisible: false }, at(2, 2))).toEqual({ kind: 'room', id: 'r1' });
  });

  it('hits a room at its centre', () => {
    expect(hitTest(scene(), at(2, 2))).toEqual({ kind: 'room', id: 'r1' });
  });

  it('hits a stair on its outline only: a 1.0 flight in a 2.0 bay leaves the other half free', () => {
    const s = scene({ stairRise: 2 }); // 11 risers, 10 treads of 0.26 m
    s.floor.stairs['s1'] = {
      id: 's1',
      x: 2,
      y: 2,
      width: 2,
      depth: 3,
      rotation: 0,
      type: 'straight',
      turn: 'landing',
      hand: 'right',
      flightWidth: 1,
    };
    expect(hitTest(s, at(2.5, 3))).toEqual({ kind: 'stair', id: 's1' });
    expect(hitTest(s, at(2.01, 3))).toEqual({ kind: 'stair', id: 's1' });
    expect(hitTest(s, at(1.99, 3))).toEqual({ kind: 'room', id: 'r1' }); // bay, not outline
    // without a rise (top floor) the outline is the bay
    expect(hitTest({ ...s, stairRise: NaN }, at(1.5, 3))).toEqual({ kind: 'stair', id: 's1' });
  });

  it('returns null far outside', () => {
    expect(hitTest(scene(), { x: 5, y: 5 })).toBeNull();
  });

  it('a dimension rect beats the wall under it', () => {
    const p = at(3, 0);
    const s = scene({
      dimensions: [{ wallId: 'w1', rect: { x: p.x - 10, y: p.y - 5, width: 20, height: 10 } }],
    });
    expect(hitTest(s, p)).toEqual({ kind: 'dimension', id: 'w1' });
  });
  it('skips an open room instead of throwing', () => {
    const s = scene();
    s.floor.rooms['r1']!.walls = ['w1', 'w2'];
    expect(() => hitTest(s, at(2, 2))).not.toThrow();
    expect(hitTest(s, at(2, 2))).toBeNull();
    expect(hitTest(s, { x: 5, y: 5 })).toBeNull();
  });

  it('picks the nearest of two nodes within reach', () => {
    const s = scene();
    s.floor.nodes['n5'] = { id: 'n5', x: 4.1, y: 0 }; // 5 px right of n2
    const n2 = at(4, 0);
    expect(hitTest(s, { x: n2.x + 4, y: n2.y })).toEqual({ kind: 'node', id: 'n5' });
    expect(hitTest(s, { x: n2.x + 1, y: n2.y })).toEqual({ kind: 'node', id: 'n2' });
  });

  it("a wall's outline beats another wall's tolerance band", () => {
    // T-junction: a thin wall stands on a thick one; the thin wall is listed first.
    const floor: Floor = {
      ...oneRoomFloor(),
      nodes: {
        a: { id: 'a', x: 0, y: 0 },
        m: { id: 'm', x: 2, y: 0 },
        b: { id: 'b', x: 4, y: 0 },
        t: { id: 't', x: 2, y: 3 },
      },
      walls: {
        wt: { id: 'wt', a: 'm', b: 't', thickness: 0.02, height: 3 },
        w1a: { id: 'w1a', a: 'a', b: 'm', thickness: 0.6, height: 3 },
        w1b: { id: 'w1b', a: 'm', b: 'b', thickness: 0.6, height: 3 },
      },
      openings: {},
      rooms: {},
    };
    const s: HitScene = { floor, view, corners: computeJoins(floor).corners, dimensions: [] };
    // 3.5 px right of the thin wall's centre line, inside the thick wall's outline.
    expect(hitTest(s, at(2.07, 0.25))).toEqual({ kind: 'wall', id: 'w1b' });
    // Away from any outline the band still picks the thin wall.
    expect(hitTest(s, at(2.07, 1.5))).toEqual({ kind: 'wall', id: 'wt' });
  });
});

describe('hitTest columns, site and holes', () => {
  const big: View = { cx: 5, cy: 5, scale: 40, width: 500, height: 500 };
  const bigAt = (x: number, y: number) => planToScreen(big, { x, y });
  const holed = (extra: Partial<HitScene> = {}): HitScene => {
    const floor = holedRoomFloor();
    return { floor, view: big, corners: computeJoins(floor).corners, dimensions: [], ...extra };
  };

  it('does not hit the outer room inside a hole', () => {
    expect(hitTest(holed(), bigAt(5, 5))).toBeNull();
  });

  it('hits the room beside the hole', () => {
    expect(hitTest(holed(), bigAt(2, 5))).toEqual({ kind: 'room', id: 'r1' });
  });

  it('hits a column inside a room', () => {
    const s = holed();
    s.floor.columns['c1'] = { id: 'c1', x: 2, y: 5, shape: 'round', width: 0.6, rotation: 0 };
    expect(hitTest(s, bigAt(2.2, 5))).toEqual({ kind: 'column', id: 'c1' });
    expect(hitTest(s, bigAt(2.5, 5))).toEqual({ kind: 'room', id: 'r1' });
  });

  it('hits a square column by its rotated outline', () => {
    const s = holed();
    s.floor.columns['c1'] = {
      id: 'c1',
      x: 2,
      y: 5,
      shape: 'square',
      width: 1,
      rotation: Math.PI / 4,
    };
    expect(hitTest(s, bigAt(2.6, 5))).toEqual({ kind: 'column', id: 'c1' });
    expect(hitTest(s, bigAt(2.45, 5.45))).toEqual({ kind: 'room', id: 'r1' });
  });

  it('hits a site edge but not its interior', () => {
    const site = {
      id: 'site' as const,
      points: [
        { x: -2, y: -2 },
        { x: 12, y: -2 },
        { x: 12, y: 12 },
        { x: -2, y: 12 },
      ],
    };
    const s = holed({ site });
    expect(hitTest(s, bigAt(5, -2))).toEqual({ kind: 'site', id: 'site' });
    expect(hitTest(s, bigAt(-1, 5))).toBeNull();
  });
});

describe('a leaf reach does not cover what is drawn under it', () => {
  function probe(floor: Floor, scale: number) {
    const { corners, junctions } = computeJoins(floor);
    const v = { ...view, scale };
    const s = scene({ floor, corners, junctions, view: v });
    return {
      junctions,
      hit: (x: number, y: number) => hitTest(s, planToScreen(v, { x, y })),
      /** Within the 8 px of a node, which wins over everything. */
      byNode: (x: number, y: number) =>
        Object.values(floor.nodes).some((n) => Math.hypot(n.x - x, n.y - y) * scale <= 8),
    };
  }
  const ACROSS = [-0.95, -0.5, 0, 0.5, 0.95];

  describe.each([25, 50, 100, 200, 800])('at %i px/m', (scale) => {
    describe.each([0.1, 0.2])('%s m walls', (thickness) => {
      it.each([
        ['a', 'w4', 0],
        ['b', 'w2', 4],
      ] as const)('corner door hinged at %s: the next wall keeps its body', (hinge, id, x) => {
        const floor = oneRoomFloor();
        for (const w of Object.values(floor.walls)) w.thickness = thickness;
        const { lo, hi } = openingRange(floor, floor.openings.o1!);
        floor.openings.o1 = { ...floor.openings.o1!, hinge, offset: hinge === 'a' ? lo : hi };
        const { hit, byNode } = probe(floor, scale);
        let probed = 0;
        for (let y = thickness / 2 + 0.005; y <= 0.95; y += 0.02) {
          for (const k of ACROSS) {
            const px = x + (k * thickness) / 2;
            if (byNode(px, y)) continue;
            expect(hit(px, y), `${px},${y}`).toEqual({ kind: 'wall', id });
            probed++;
          }
        }
        expect(probed).toBeGreaterThan(0);
      });

      it.each([
        ['a', 'left'],
        ['a', 'right'],
        ['b', 'left'],
        ['b', 'right'],
      ] as const)('one-leaf slider %s %s: its own wall keeps its body', (hinge, swing) => {
        const over = { type: 'door-sliding', leaves: 1, hinge, swing } as const;
        const { hit, byNode } = probe(openingFloor(over, { thickness }), scale);
        for (let d = 0.005; d <= 0.8; d += 0.015) {
          const x = hinge === 'a' ? 1.4 - d : 2.6 + d;
          for (const k of ACROSS) {
            const y = (k * thickness) / 2;
            if (byNode(x, y)) continue;
            expect(hit(x, y), `${x},${y}`).toEqual({ kind: 'wall', id: 'w' });
          }
        }
      });
    });
  });

  it.each([100, 200])('a junction fill beside a hinge is a wall at %i px/m', (scale) => {
    const floor = twoRoomFloor();
    const door = { ...oneRoomFloor().openings.o1!, wall: 'w2' };
    floor.openings = { o1: { ...door, offset: openingRange(floor, door).lo } };
    const { hit, byNode, junctions } = probe(floor, scale);
    const { points } = junctions.n2!;
    let probed = 0;
    for (let x = 3.903; x < 4.099; x += 0.004) {
      for (let y = -0.097; y < 0.099; y += 0.004) {
        if (byNode(x, y) || !pointInPolygon({ x, y }, points)) continue;
        expect(hit(x, y)?.kind, `${x},${y}`).toBe('wall');
        probed++;
      }
    }
    expect(probed).toBeGreaterThan(0);
  });

  it('beats the pick aid around a thin wall outside its outline', () => {
    const floor = oneRoomFloor();
    for (const w of Object.values(floor.walls)) w.thickness = 0.05;
    floor.openings.o1!.offset = openingRange(floor, floor.openings.o1!).lo;
    const { hit } = probe(floor, 25);
    // outside the wall's body, within 4 px of both its centre line and the leaf
    expect(hit(0.07, 0.6)).toEqual({ kind: 'opening', id: 'o1' });
    expect(hit(0.01, 0.6)).toEqual({ kind: 'wall', id: 'w4' });
  });
});
