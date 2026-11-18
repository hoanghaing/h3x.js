// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { H3xDocument, roofGeometry } from '../../src/core';
import { H3xScene } from '../../src/three';
import { testPresets } from '../fixtures/floors';

const xml = readFileSync('examples/layouts/townhouse-trapezoid.xml', 'utf8');
const load = (): H3xDocument => H3xDocument.fromXML(xml, { presets: testPresets });

describe('sample townhouse on a trapezoid lot (terrace, parapets, tum roof, glass roof)', () => {
  it('has four floors and the roofs on the terrace floor', () => {
    const doc = load();
    expect(doc.project.floors.map((f) => f.level)).toEqual([0, 1, 2, 3]);
    const top = doc.project.floors[3]!;
    expect(
      Object.values(top.roofs)
        .map((r) => r.material)
        .sort(),
    ).toEqual(['glass', 'metal']);
    expect(Object.values(top.walls).filter((w) => w.height < top.wallHeight).length).toBe(3);
  });

  it('has no roof issues and no layout or placement issues on any floor', () => {
    const doc = load();
    for (const f of doc.project.floors) {
      doc.setActiveFloor(f.id);
      const issues = doc.validateLayout();
      expect(
        issues.filter((i) => i.code.startsWith('roof-')),
        f.id,
      ).toEqual([]);
      expect(issues, f.id).toEqual([]);
      expect(doc.validatePlacements(), f.id).toEqual([]);
    }
  });

  it('builds both roofs without falling back to a flat roof', () => {
    const doc = load();
    const top = doc.project.floors[3]!;
    for (const r of Object.values(top.roofs)) {
      const g = roofGeometry(r, top);
      expect(g.ok, r.id).toBe(true);
    }
  });

  it('builds a roof mesh per roof (and posts for the glass roof)', () => {
    const doc = load();
    const scene = new H3xScene(doc);
    const top = doc.project.floors[3]!;
    for (const r of Object.values(top.roofs)) {
      const names = scene.getRoofMeshes(r.id, top.id).map((m) => m.name);
      expect(names, r.id).toContain(`h3x-roof-${r.id}`);
      if (r.supports === 'posts') expect(names).toContain(`h3x-roof-${r.id}-posts`);
    }
    scene.dispose();
  });

  it('survives an XML round trip', () => {
    const doc = load();
    const again = H3xDocument.fromXML(doc.toXML(), { presets: testPresets });
    expect(Object.keys(again.project.floors[3]!.roofs).sort()).toEqual(
      Object.keys(doc.project.floors[3]!.roofs).sort(),
    );
  });
});
