// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument, H3xParseError, addOpening, type Project } from '../../src/core';
import { oneRoomFloor } from '../fixtures/floors';

const project = (width = 0.9): Project => {
  const f = oneRoomFloor();
  f.openings.o1!.width = width;
  return {
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-01-01T00:00:00Z' },
    floors: [f],
  };
};

describe.each([0, -0.9])('opening width %s', (width) => {
  const invalid = { issues: [{ code: 'invalid-opening' }] };

  it('is rejected by addOpening', () => {
    const presets = () => ({ mount: 'opening' as const, footprint: { w: width, d: 0.1, h: 2 } });
    const doc = H3xDocument.fromProject(project(), { presets });
    expect(doc.tryExecute(addOpening({ wall: 'w2', preset: 'p', offset: 2 }))).toMatchObject(
      invalid,
    );
  });

  it('is rejected by fromProject', () => {
    expect(() => H3xDocument.fromProject(project(width))).toThrowError(/width/);
  });

  it('is a parse error in XML', () => {
    const xml = H3xDocument.fromProject(project())
      .toXML()
      .replace('width="0.9"', `width="${width}"`);
    expect(() => H3xDocument.fromXML(xml)).toThrowError(H3xParseError);
  });
});
