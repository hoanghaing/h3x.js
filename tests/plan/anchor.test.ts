import { describe, expect, it } from 'vitest';
import { pickAnchor } from '../../src/plan/anchor';
import { oneRoomFloor } from '../fixtures/floors';

describe('pickAnchor', () => {
  it('keeps the end with more incident walls (T-junction)', () => {
    const f = oneRoomFloor();
    f.nodes['m'] = { id: 'm', x: 2, y: 0 };
    f.nodes['t'] = { id: 't', x: 2, y: -3 };
    f.walls['w1'] = { ...f.walls['w1']!, b: 'm' };
    f.walls['w6'] = { id: 'w6', a: 'm', b: 'n2', thickness: 0.2, height: 3.2 };
    f.walls['w5'] = { id: 'w5', a: 'm', b: 't', thickness: 0.2, height: 3.2 };
    expect(pickAnchor(f, 'w5')).toBe('a');
    f.walls['w5'] = { ...f.walls['w5']!, a: 't', b: 'm' };
    expect(pickAnchor(f, 'w5')).toBe('b');
  });

  it('on a tie keeps the end farther from near', () => {
    const f = oneRoomFloor();
    expect(pickAnchor(f, 'w1', { x: 3.9, y: 0 })).toBe('a');
    expect(pickAnchor(f, 'w1', { x: 0.1, y: 0 })).toBe('b');
  });

  it('defaults to a without near', () => {
    expect(pickAnchor(oneRoomFloor(), 'w1')).toBe('a');
  });
});
