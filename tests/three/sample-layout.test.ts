// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
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
    expect(scene.root.children[0]!.children).toHaveLength(Object.keys(doc.floor.walls).length);
    expect(scene.root.children[1]!.children).toHaveLength(4);
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
