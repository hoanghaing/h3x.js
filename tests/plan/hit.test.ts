import { describe, expect, it } from 'vitest';
import { computeJoins } from '../../src/shared/walls/joins';
import { hitTest, type HitScene } from '../../src/plan/hit';
import { planToScreen, type View } from '../../src/plan/view';
import { oneRoomFloor, testPresets } from '../fixtures/floors';
import type { FloorItem } from '../../src/core';

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
});
