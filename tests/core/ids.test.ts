import { describe, expect, it } from 'vitest';
import { createId, idFor } from '../../src/core/ids';

describe('createId', () => {
  it('returns 10 url-safe chars', () => {
    const id = createId();
    expect(id).toHaveLength(10);
    expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
  });
  it('is unique across 1000 calls', () => {
    const set = new Set(Array.from({ length: 1000 }, () => createId()));
    expect(set.size).toBe(1000);
  });
});

describe('idFor', () => {
  it('returns 10 url-safe chars, the same for the same key', () => {
    const id = idFor('w1,w2,w3', () => false);
    expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(idFor('w1,w2,w3', () => false)).toBe(id);
    expect(idFor('w1,w2,w4', () => false)).not.toBe(id);
  });
  it('skips taken ids, still the same way every time', () => {
    const first = idFor('k', () => false);
    const taken = (id: string): boolean => id === first;
    const next = idFor('k', taken);
    expect(next).not.toBe(first);
    expect(idFor('k', taken)).toBe(next);
  });
});
