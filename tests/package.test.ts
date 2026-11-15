import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>;

describe('package.json', () => {
  it('has top-level entry fields for older resolvers', () => {
    expect(pkg.types).toBe('./dist/index.d.ts');
    expect(pkg.main).toBe('./dist/index.js');
    expect(pkg.module).toBe('./dist/index.js');
  });
});
