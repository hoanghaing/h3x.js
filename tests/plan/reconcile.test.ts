import { describe, expect, it } from 'vitest';
import type { EntityChange } from '../../src/core';
import { dirtyEntities } from '../../src/plan/reconcile';
import { twoRoomFloor } from '../fixtures/floors';

describe('dirtyEntities', () => {
  it('propagates a moved node to its corners, openings and rooms', () => {
    const floor = twoRoomFloor();
    floor.openings = {
      o1: {
        id: 'o1',
        wall: 'w2',
        preset: 'door-single-01',
        offset: 1,
        width: 0.9,
        height: 2.1,
        sill: 0,
        flip: false,
      },
    };
    const n2 = floor.nodes['n2']!;
    const changes: EntityChange[] = [
      { kind: 'node', id: 'n2', before: n2, after: { ...n2, x: 5 } },
    ];
    const dirty = dirtyEntities(floor, changes);
    expect([...dirty.node]).toEqual(['n2']);
    // walls at n2, plus walls at their far ends (neighbours)
    expect([...dirty.wall].sort()).toEqual(['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
    expect([...dirty.opening]).toEqual(['o1']);
    expect([...dirty.room].sort()).toEqual(['r1', 'r2']);
  });

  it('ignores column and site changes', () => {
    const dirty = dirtyEntities(twoRoomFloor(), [
      { kind: 'column', id: 'c1', before: null, after: null },
    ] as unknown as EntityChange[]);
    expect(Object.values(dirty).every((s) => s.size === 0)).toBe(true);
  });
});
