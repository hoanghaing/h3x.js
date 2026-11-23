import { Box3, Mesh, Raycaster, Vector3, type BufferGeometry, type Material } from 'three';
import { describe, expect, it, vi } from 'vitest';
import {
  H3xDocument,
  openingGeometry,
  removeOpening,
  updateOpening,
  type Floor,
  type Project,
  type Vec2,
} from '../../src/core';
import { pointInPolygon } from '../../src/core/geometry/polygon';
import { buildOpeningParts, H3xScene } from '../../src/three';
import { OPENING_CASES, openingFloor } from '../fixtures/openings';

const TOL = 1e-5;

function vertices(geom: BufferGeometry): Vector3[] {
  const pos = geom.getAttribute('position');
  const out: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new Vector3().fromBufferAttribute(pos, i));
  return out;
}

/** The cut grown by TOL, so vertices on its edges count as inside. */
function grown(cut: Vec2[]): Vec2[] {
  const c = cut.reduce((s, p) => ({ x: s.x + p.x / cut.length, y: s.y + p.y / cut.length }), {
    x: 0,
    y: 0,
  });
  return cut.map((p) => {
    const d = Math.hypot(p.x - c.x, p.y - c.y) || 1;
    return { x: p.x + ((p.x - c.x) / d) * TOL * 2, y: p.y + ((p.y - c.y) / d) * TOL * 2 };
  });
}

/** Plan point of a world vertex. */
const plan = (v: Vector3): Vec2 => ({ x: v.x, y: -v.z });

function caseFloor(over: Parameters<typeof openingFloor>[0], elevation = 3.35): Floor {
  const f = openingFloor(over);
  f.elevation = elevation;
  return f;
}

describe('buildOpeningParts', () => {
  for (const { name, over } of OPENING_CASES) {
    it(`${name}: finite parts inside the cut at the floor elevation`, () => {
      const floor = caseFloor(over);
      const o = floor.openings.o1!;
      const g = openingGeometry(floor, o)!;
      const parts = buildOpeningParts(floor, o, g);
      const cut = grown(g.cut);
      const lo = floor.elevation + g.z0 - TOL;
      const hi = floor.elevation + g.z1 + TOL;
      const box = g.closed.find((p) => p.role === 'box');

      for (const key of ['frame', 'leaf', 'glass', 'pick'] as const) {
        const geom = parts[key];
        if (!geom) continue;
        const vs = vertices(geom);
        expect(vs.length, key).toBeGreaterThan(0);
        expect(vs.length % 3, key).toBe(0);
        for (const v of vs) {
          expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
          const inCut = pointInPolygon(plan(v), cut) && v.y >= lo && v.y <= hi;
          if (inCut) continue;
          // Only the box of a rolling door stands outside the cut, above it.
          expect(key === 'frame' && box, `${key} ${v.x},${v.y},${v.z}`).toBeTruthy();
          expect(v.y).toBeGreaterThanOrEqual(floor.elevation + box!.z0 - TOL);
          expect(v.y).toBeLessThanOrEqual(floor.elevation + box!.z1 + TOL);
        }
      }

      if (o.type === 'opening') {
        expect(parts.frame).toBeUndefined();
        expect(parts.leaf).toBeUndefined();
        expect(parts.glass).toBeUndefined();
      } else {
        expect(parts.frame).toBeDefined();
      }
      // The pick fills the cut.
      const pb = new Box3().setFromBufferAttribute(parts.pick.getAttribute('position') as never);
      expect(pb.min.y).toBeCloseTo(floor.elevation + g.z0, 5);
      expect(pb.max.y).toBeCloseTo(floor.elevation + g.z1, 5);
    });
  }

  it('glass only where the type has it', () => {
    const glassy = (over: Parameters<typeof openingFloor>[0]): boolean => {
      const f = openingFloor(over);
      const o = f.openings.o1!;
      return buildOpeningParts(f, o, openingGeometry(f, o)!).glass !== undefined;
    };
    expect(glassy({ type: 'door-swing' })).toBe(false);
    expect(glassy({ type: 'window-fixed', sill: 0.9, height: 1.4 })).toBe(true);
    expect(glassy({ type: 'window-sliding', sill: 0.9, height: 1.4 })).toBe(true);
  });

  it('an empty cut gives only a pick', () => {
    const f = openingFloor({ offset: 9 });
    const o = f.openings.o1!;
    const parts = buildOpeningParts(f, o, openingGeometry(f, o)!);
    expect(parts.frame ?? parts.leaf ?? parts.glass).toBeUndefined();
    for (const v of vertices(parts.pick)) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
  });
});

function docOf(floor: Floor): H3xDocument {
  return H3xDocument.fromProject({ name: 'p', floors: [floor] } as unknown as Project);
}

const parts = (scene: H3xScene, id = 'o1'): string[] =>
  scene.getOpeningMeshes(id).map((m) => m.name);

describe('H3xScene openings', () => {
  it('names and tags the meshes of each part', () => {
    const scene = new H3xScene(docOf(openingFloor({ type: 'window-fixed', sill: 0.9 })));
    const meshes = scene.getOpeningMeshes('o1');
    expect(meshes.map((m) => m.name)).toEqual([
      'h3x-opening-o1-frame',
      'h3x-opening-o1-glass',
      'h3x-opening-o1-pick',
    ]);
    for (const m of meshes) {
      expect(m.userData.h3xKind).toBe('opening');
      expect(m.userData.h3xId).toBe('o1');
      expect(m.userData.h3xFloorId).toBe('f');
    }
    expect(parts(new H3xScene(docOf(openingFloor())))).toEqual([
      'h3x-opening-o1-frame',
      'h3x-opening-o1-leaf',
      'h3x-opening-o1-pick',
    ]);
  });

  it('a plain opening has only an invisible pick that rays still hit', () => {
    const scene = new H3xScene(docOf(openingFloor({ type: 'opening' })));
    const meshes = scene.getOpeningMeshes('o1');
    expect(meshes.map((m) => m.name)).toEqual(['h3x-opening-o1-pick']);
    const pick = meshes[0]!;
    expect((pick.material as Material).visible).toBe(false);
    expect(pick.castShadow).toBe(false);
    // Through the middle of the cut, across the wall.
    const hits = new Raycaster(new Vector3(2, 1, -5), new Vector3(0, 0, 1)).intersectObject(
      scene.root,
      true,
    );
    expect(hits[0]?.object).toBe(pick);
  });

  it('glass is translucent and does not write depth', () => {
    const scene = new H3xScene(docOf(openingFloor({ type: 'window-fixed', sill: 0.9 })));
    const glass = scene.getOpeningMeshes('o1').find((m) => m.name.endsWith('-glass'))!;
    const mat = glass.material as Material;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeLessThan(1);
    expect(mat.depthWrite).toBe(false);
    expect(glass.castShadow).toBe(false);
    const frame = scene.getOpeningMeshes('o1')[0]!;
    expect((frame.material as Material).transparent).toBe(false);
  });

  it('keeps mesh identity across moves and swaps geometry', () => {
    const doc = docOf(openingFloor());
    const scene = new H3xScene(doc);
    const before = scene.getOpeningMeshes('o1');
    const geoms = before.map((m) => m.geometry);
    const spies = geoms.map((g) => vi.spyOn(g, 'dispose'));
    doc.execute(updateOpening('o1', { offset: 1.2 }));
    const after = scene.getOpeningMeshes('o1');
    expect(after).toHaveLength(before.length);
    after.forEach((m, i) => {
      expect(m).toBe(before[i]);
      expect(m.geometry).not.toBe(geoms[i]);
      expect(spies[i]).toHaveBeenCalledTimes(1);
    });
    const box = new Box3().setFromObject(after[after.length - 1]!);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(1.2, 6);
  });

  it('leaves an unchanged opening alone when something else changes', () => {
    const floor = openingFloor();
    floor.openings.o2 = { ...floor.openings.o1!, id: 'o2', offset: 3.3, width: 0.6 };
    floor.openings.o1!.offset = 1;
    const doc = docOf(floor);
    const scene = new H3xScene(doc);
    const geoms = scene.getOpeningMeshes('o1').map((m) => m.geometry);
    doc.execute(updateOpening('o2', { offset: 3.2 }));
    expect(scene.getOpeningMeshes('o1').map((m) => m.geometry)).toEqual(geoms);
  });

  it('adds and removes parts when the type changes', () => {
    const doc = docOf(openingFloor());
    const scene = new H3xScene(doc);
    const pick = scene.getOpeningMeshes('o1').at(-1)!;
    const leaf = scene.getOpeningMeshes('o1')[1]!;
    const spy = vi.spyOn(leaf.geometry, 'dispose');
    doc.execute(updateOpening('o1', { type: 'opening' }));
    expect(parts(scene)).toEqual(['h3x-opening-o1-pick']);
    expect(scene.getOpeningMeshes('o1')[0]).toBe(pick);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(leaf.parent).toBeNull();
    doc.execute(updateOpening('o1', { type: 'window-fixed', sill: 0.9, height: 1.4 }));
    expect(parts(scene)).toEqual([
      'h3x-opening-o1-frame',
      'h3x-opening-o1-glass',
      'h3x-opening-o1-pick',
    ]);
  });

  it('disposes every part on delete', () => {
    const doc = docOf(openingFloor());
    const scene = new H3xScene(doc);
    const meshes = scene.getOpeningMeshes('o1');
    const spies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'));
    doc.execute(removeOpening('o1'));
    expect(scene.getOpeningMeshes('o1')).toEqual([]);
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
    for (const m of meshes) expect(m.parent).toBeNull();
    let left = 0;
    scene.root.traverse((o) => {
      if (o instanceof Mesh && o.userData.h3xKind === 'opening') left++;
    });
    expect(left).toBe(0);
  });

  it('disposes every part with the scene', () => {
    const scene = new H3xScene(docOf(openingFloor()));
    const spies = scene.getOpeningMeshes('o1').map((m) => vi.spyOn(m.geometry, 'dispose'));
    scene.dispose();
    for (const s of spies) expect(s).toHaveBeenCalledTimes(1);
  });

  it('follows view modes with its floor', () => {
    const upper = openingFloor();
    upper.id = 'g';
    upper.level = 1;
    upper.elevation = 3.35;
    const doc = H3xDocument.fromProject({
      name: 'p',
      floors: [openingFloor(), upper],
    } as unknown as Project);
    doc.setActiveFloor('f');
    const scene = new H3xScene(doc);
    const shown = (m: Mesh): boolean => {
      let o: Mesh['parent'] | Mesh = m;
      while (o) {
        if (!o.visible) return false;
        o = o.parent;
      }
      return true;
    };
    const lower = scene.getOpeningMeshes('o1', 'f')[0]!;
    const top = scene.getOpeningMeshes('o1', 'g')[0]!;
    expect(top).not.toBe(lower);
    expect(new Box3().setFromObject(top).min.y).toBeCloseTo(3.35, 6);
    scene.setViewMode('active');
    expect([shown(lower), shown(top)]).toEqual([true, false]);
    scene.setViewMode('all');
    expect([shown(lower), shown(top)]).toEqual([true, true]);
  });
});
