// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { H3xDocument, layoutStair, stairRise } from '../../src/core';
import { testPresets } from '../fixtures/floors';

const xml = readFileSync('examples/layouts/townhouse-3f.xml', 'utf8');

describe('sample townhouse layout (basement + 3 floors)', () => {
  it('has levels -1, 0, 1, 2 and a raised ground floor', () => {
    const doc = H3xDocument.fromXML(xml, { presets: testPresets });
    expect(doc.project.floors.map((f) => f.level)).toEqual([-1, 0, 1, 2]);
    expect(doc.project.floors[1]!.elevation).toBeCloseTo(0.45);
  });

  it('has no layout or placement issues on any floor', () => {
    const doc = H3xDocument.fromXML(xml, { presets: testPresets });
    for (const f of doc.project.floors) {
      doc.setActiveFloor(f.id);
      expect(doc.validateLayout(), f.id).toEqual([]);
      expect(doc.validatePlacements(), f.id).toEqual([]);
    }
  });

  it('has a fitting U stair on floors -1, 0 and 1 and none on the top floor', () => {
    const doc = H3xDocument.fromXML(xml, { presets: testPresets });
    const floors = doc.project.floors;
    floors.forEach((f, i) => {
      const stairs = Object.values(f.stairs);
      if (i === floors.length - 1) {
        expect(stairs, f.id).toEqual([]);
        return;
      }
      expect(stairs.length, f.id).toBe(1);
      const s = stairs[0]!;
      expect(s.type).toBe('U');
      expect(layoutStair(s, stairRise(f, floors[i + 1])).ok, f.id).toBe(true);
    });
  });

  it('survives an XML round trip', () => {
    const doc = H3xDocument.fromXML(xml, { presets: testPresets });
    const again = H3xDocument.fromXML(doc.toXML(), { presets: testPresets });
    expect(again.project.floors.map((f) => f.slabThickness)).toEqual([0.2, 0.15, 0.15, 0.12]);
  });
});
