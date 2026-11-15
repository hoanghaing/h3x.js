import { describe, expect, it } from 'vitest';
import { FORMAT_VERSION, MIN_WALL_LENGTH } from '../src/core';

describe('constants', () => {
  it('exposes core constants', () => {
    expect(MIN_WALL_LENGTH).toBe(0.3);
    expect(FORMAT_VERSION).toBe(1);
  });
});
