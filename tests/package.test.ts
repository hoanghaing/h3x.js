import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

describe('package.json', () => {
  it('has top-level entry fields for older resolvers', () => {
    const p = pkg as Record<string, unknown>;
    expect(p.types).toBe('./dist/index.d.ts');
    expect(p.main).toBe('./dist/index.js');
    expect(p.module).toBe('./dist/index.js');
  });
});
