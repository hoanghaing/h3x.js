// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Box3, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core';
import { H3xScene } from '../../src/three';
import { widenHouse } from '../../examples/widen';
import { testPresets } from '../fixtures/floors';

const xml = readFileSync('examples/layouts/nha-ong-4x16.h3x', 'utf8');
const load = (): H3xDocument => H3xDocument.fromXML(xml, { presets: testPresets });

describe('sample tube-house layout', () => {
  it('has the four named rooms', () => {
    const names = Object.values(load().floor.rooms).map((r) => r.name);
    expect(names).toEqual(['Phòng khách', 'Phòng ngủ', 'Bếp', 'WC']);
  });

  it('validates', () => {
    const doc = load();
    expect(doc.validateLayout()).toEqual([]);
    expect(doc.validatePlacements()).toEqual([]);
  });

  it('builds one mesh per wall and four floors', () => {
    const doc = load();
    const scene = new H3xScene(doc);
    for (const id of Object.keys(doc.floor.walls)) expect(scene.getWallMesh(id)).toBeDefined();
    for (const r of Object.values(doc.floor.rooms)) expect(scene.getFloorMesh(r.id)).toBeDefined();
    const group = scene.root.getObjectByName('h3x-floor-' + doc.activeFloorId)!;
    const walls = group.getObjectByName('h3x-walls')!;
    expect(walls.children).toHaveLength(Object.keys(doc.floor.walls).length);
    expect(group.getObjectByName('h3x-floors')!.children).toHaveLength(4);
    // the slab footprint reaches the outer wall faces
    const slab = new Box3().setFromObject(scene.getSlabMesh()!);
    const wallBox = new Box3().setFromObject(walls);
    for (const k of ['x', 'z'] as const) {
      expect(slab.min[k]).toBeCloseTo(wallBox.min[k], 6);
      expect(slab.max[k]).toBeCloseTo(wallBox.max[k], 6);
    }
  });

  it('has no see-through holes in wall tops at junctions', () => {
    const scene = new H3xScene(load());
    for (const [x, y] of [
      [0.05, 5],
      [3.95, 5],
      [0.05, 9.5],
    ] as const) {
      const hits = new Raycaster(new Vector3(x, 10, -y), new Vector3(0, -1, 0)).intersectObject(
        scene.root,
        true,
      );
      expect(hits.length, `miss at plan (${x}, ${y})`).toBeGreaterThan(0);
    }
  });

  it('widens the house in one undo step', () => {
    const doc = load();
    const maxX = (): number => Math.max(...Object.values(doc.floor.nodes).map((n) => n.x));
    expect(widenHouse(doc, 0.5)).toEqual({ ok: true });
    expect(maxX()).toBeCloseTo(4.5);
    expect(doc.validateLayout()).toEqual([]);
    doc.undo();
    expect(maxX()).toBeCloseTo(4);
  });
});
