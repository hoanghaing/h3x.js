import { Box3 } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gableProfile } from '../../src/core/roofs/geometry';
import * as skeleton from '../../src/core/roofs/skeleton';
import { MaterialLibrary } from '../../src/three';
import { FloorView } from '../../src/three/floorView';
import { gableWallEdges, roofRoom, testRoof } from './helpers';

vi.mock('../../src/core/roofs/skeleton', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/core/roofs/skeleton')>();
  return { ...mod, weightedSkeleton: vi.fn(mod.weightedSkeleton) };
});

describe('FloorView.rebuild with pitched roofs', () => {
  beforeEach(() => {
    vi.mocked(skeleton.weightedSkeleton).mockClear();
  });

  it('builds each roof once per rebuild, not once per wall', () => {
    const f = roofRoom(6, 4);
    f.roofs.R1 = testRoof({ wallEdges: gableWallEdges(f) });
    f.roofs.R2 = testRoof({ id: 'R2', base: 1 });
    const view = new FloorView('f1', new MaterialLibrary());
    view.rebuild(f);
    // one skeleton per (single-body) pitched roof
    expect(skeleton.weightedSkeleton).toHaveBeenCalledTimes(2);
  });

  it('gable walls keep the heights of gableProfile', () => {
    const f = roofRoom(6, 4);
    f.roofs.R1 = testRoof({ wallEdges: gableWallEdges(f) });
    const view = new FloorView('f1', new MaterialLibrary());
    view.rebuild(f);
    for (const id of Object.keys(f.walls)) {
      const profile = gableProfile(f, id);
      const top = new Box3().setFromObject(view.wallMeshes.get(id)!).max.y;
      const expected = profile ? Math.max(3, ...profile.map((q) => q.y)) : 3;
      expect(top).toBeCloseTo(expected, 6);
    }
    expect(new Box3().setFromObject(view.wallMeshes.get('w2')!).max.y).toBeCloseTo(5.1, 4);
  });
});
