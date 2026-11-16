import { describe, expect, it } from 'vitest';
import { dimensionLabel, wallsShowingDimensions } from '../../src/plan/dimensions';
import { oneRoomFloor, twoRoomFloor } from '../fixtures/floors';
import type { View } from '../../src/plan';

const view: View = { cx: 2, cy: 2, scale: 50, width: 800, height: 600 };

describe('wallsShowingDimensions', () => {
  it('shows exterior walls when nothing is selected', () => {
    const ids = wallsShowingDimensions(twoRoomFloor(), { selection: null, draggingNode: null });
    expect(ids).not.toContain('w7');
    expect([...ids].sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6']);
  });

  it('shows the walls touching a dragged node', () => {
    const ids = wallsShowingDimensions(oneRoomFloor(), {
      selection: { kind: 'wall', id: 'w3' },
      draggingNode: 'n2',
    });
    expect([...ids].sort()).toEqual(['w1', 'w2']);
  });

  it('shows a selected wall or the walls of a selected node', () => {
    const f = oneRoomFloor();
    expect(
      wallsShowingDimensions(f, { selection: { kind: 'wall', id: 'w3' }, draggingNode: null }),
    ).toEqual(['w3']);
    expect(
      [
        ...wallsShowingDimensions(f, {
          selection: { kind: 'node', id: 'n1' },
          draggingNode: null,
        }),
      ].sort(),
    ).toEqual(['w1', 'w4']);
  });
});

describe('dimensionLabel', () => {
  it('offsets the line away from the centroid', () => {
    const l = dimensionLabel(oneRoomFloor(), 'w1', view);
    expect(l.text).toBe('4.00');
    expect(l.line[0].y).toBeCloseTo(-0.46);
    expect(l.line[1].y).toBeCloseTo(-0.46);
    expect(l.at.x).toBeCloseTo(2);
    expect(l.angle).toBeCloseTo(0);
  });

  it('keeps the angle upright for a right-to-left wall', () => {
    const l = dimensionLabel(oneRoomFloor(), 'w3', view);
    expect(l.angle).toBeGreaterThan(-90);
    expect(l.angle).toBeLessThanOrEqual(90);
    expect(l.line[0].y).toBeCloseTo(4.46);
  });
});
