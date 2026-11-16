import { describe, expect, it } from 'vitest';
import pkg from '../package.json';

describe('package.json', () => {
  it('has top-level entry fields for older resolvers', () => {
    const p = pkg as Record<string, unknown>;
    expect(p.types).toBe('./dist/index.d.ts');
    expect(p.main).toBe('./dist/index.js');
    expect(p.module).toBe('./dist/index.js');
  });

  it('marks three as an optional peer (only h3x/three needs it)', () => {
    const p = pkg as Record<string, unknown>;
    expect(p.peerDependencies).toEqual({ three: '^0.187.0' });
    expect(p.peerDependenciesMeta).toEqual({ three: { optional: true } });
  });

  it('exposes the plan subpath', () => {
    const exp = (pkg as { exports: Record<string, unknown> }).exports;
    expect(exp['./plan']).toEqual({
      types: './dist/plan/index.d.ts',
      import: './dist/plan/index.js',
    });
  });
});
