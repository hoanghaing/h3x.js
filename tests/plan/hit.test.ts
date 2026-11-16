import { describe, expect, it } from 'vitest';
import { computeJoins } from '../../src/shared/walls/joins';
import { hitTest, type HitScene } from '../../src/plan/hit';
import { planToScreen, type View } from '../../src/plan/view';
import { oneRoomFloor, testPresets } from '../fixtures/floors';
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

  it('hits a room at its centre', () => {
    expect(hitTest(scene(), at(2, 2))).toEqual({ kind: 'room', id: 'r1' });
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
