import { describe, expect, it } from 'vitest';
import type { EntityChange } from '../../src/core';
import { dirtyEntities } from '../../src/plan/reconcile';
import { holedRoomFloor, twoRoomFloor } from '../fixtures/floors';

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
        type: 'door-swing',
        hinge: 'a',
        swing: 'left',
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

  it('marks column and site changes dirty without touching walls or rooms', () => {
    const dirty = dirtyEntities(twoRoomFloor(), [
      { kind: 'column', id: 'c1', before: null, after: null },
      { kind: 'site', id: 'site', before: null, after: null },
    ] as unknown as EntityChange[]);
    expect([...dirty.column]).toEqual(['c1']);
    expect([...dirty.site]).toEqual(['site']);
    expect(dirty.wall.size + dirty.room.size + dirty.node.size).toBe(0);
  });

  it('re-renders the room containing a changed hole wall', () => {
    const floor = holedRoomFloor();
    const w = floor.walls['hw1']!;
    const dirty = dirtyEntities(floor, [
      { kind: 'wall', id: 'hw1', before: w, after: { ...w, thickness: 0.3 } },
    ]);
    expect([...dirty.room]).toEqual(['r1']);
  });
});
