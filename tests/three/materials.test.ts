import { describe, expect, it, vi } from 'vitest';
import { MaterialLibrary } from '../../src/three/materials';

describe('MaterialLibrary', () => {
  it('uses default colours', () => {
    const lib = new MaterialLibrary();
    expect(lib.wall().color.getHexString()).toBe('f2efe9');
    expect(lib.floor().color.getHexString()).toBe('c8b49a');
    expect(lib.trim().color.getHexString()).toBe('e2ddd5');
  });
  it('uses literal # colours', () => {
    expect(new MaterialLibrary().wall('#ff0000').color.getHexString()).toBe('ff0000');
  });
  it('resolves finish ids and caches by colour', () => {
    const lib = new MaterialLibrary({
      resolveFinish: (id) => (id === 'paint-cream' ? { color: '#f3e5c0' } : undefined),
    });
    expect(lib.wall('paint-cream').color.getHexString()).toBe('f3e5c0');
    expect(lib.wall('paint-cream')).toBe(lib.wall('paint-cream'));
    expect(lib.wall('paint-cream')).toBe(lib.wall('#f3e5c0'));
    expect(lib.wall('paint-cream')).not.toBe(lib.floor('paint-cream'));
  });
  it('unknown id gives the default', () => {
    const lib = new MaterialLibrary({ resolveFinish: () => undefined });
    expect(lib.wall('nope')).toBe(lib.wall());
  });
  it('dispose disposes every created material', () => {
    const lib = new MaterialLibrary();
    const ms = [lib.wall(), lib.floor(), lib.trim(), lib.wall('#00ff00')];
    const spies = ms.map((m) => vi.spyOn(m, 'dispose'));
    lib.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });
});
