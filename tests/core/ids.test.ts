import { describe, expect, it } from 'vitest';
import { createId } from '../../src/core/ids';

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
