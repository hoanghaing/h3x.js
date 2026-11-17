// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import * as h3x from '../../src/index';
import readme from '../../README.md?raw';

const FUNCTIONS = [
  'createId',
  'moveNode',
  'moveWall',
  'setWallLength',
  'addWall',
  'splitWall',
  'removeWall',
  'removeNode',
  'mergeNodes',
  'dropNode',
  'pushPullWall',
  'addOpening',
  'moveOpening',
  'removeOpening',
  'addItem',
  'moveItem',
  'removeItem',
  'addColumn',
  'moveColumn',
  'removeColumn',
  'setSite',
  'setWallFinish',
  'setRoomFinish',
  'renameRoom',
  'addFloor',
  'removeFloor',
  'setFloorHeight',
  'setSlabThickness',
  'setGroundElevation',
  'validateLayout',
  'validatePlacements',
  'checkItem',
  'checkOpening',
  'detectRooms',
  'roomPolygon',
  'roomArea',
  'projectToXML',
  'projectFromXML',
  'obbCorners',
  'wallOBB',
  // classes
  'H3xDocument',
  'H3xError',
  'H3xParseError',
  'H3xVersionError',
  'H3xValidationError',
] as const;
const CONSTANTS = [
  'MIN_WALL_LENGTH',
  'MIN_ROOM_AREA',
  'OPENING_END_MARGIN',
  'XML_DECIMALS',
  'FORMAT_VERSION',
] as const;

describe('public API', () => {
  it.each(FUNCTIONS)('exports %s as a function/class', (name) => {
    expect(typeof (h3x as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(CONSTANTS)('exports constant %s', (name) => {
    expect(typeof (h3x as Record<string, unknown>)[name]).toBe('number');
  });

  it('keeps internals private', () => {
    for (const name of ['applyChanges', 'mergeChanges', 'History', 'normalizeRoomOrientation']) {
      expect((h3x as Record<string, unknown>)[name]).toBeUndefined();
    }
  });

  it('readme documents what ships', () => {
    expect(readme).not.toMatch(/later tasks/i);
    for (const needle of [
      'DOMParser',
      'XMLSerializer',
      'jsdom',
      'GEOM_TOL',
      'clean-room',
      'H3xDocument.fromXML(xml);',
      "doc.execute(moveNode('n3', { x: 5, y: 3 }));",
      "doc.execute(moveNode('n2', { x: 5, y: 0 }));",
      '<room id="r1" walls="w1 w2 w3 w4" name="Living room"/>',
      'invalid-number',
      'duplicate-id',
      'bad-reference',
      'no-floor',
    ]) {
      expect(readme).toContain(needle);
    }
  });

  it('readme example runs', () => {
    // Keep in sync with the usage example in README.md.
    const { H3xDocument, moveNode, roomArea } = h3x;

    const xml = `<h3x version="1" unit="m">
      <floor id="f1" level="0" elevation="0" wallHeight="3.2">
        <node id="n1" x="0" y="0"/><node id="n2" x="4" y="0"/>
        <node id="n3" x="4" y="3"/><node id="n4" x="0" y="3"/>
        <wall id="w1" a="n1" b="n2" thickness="0.2" height="3.2"/>
        <wall id="w2" a="n2" b="n3" thickness="0.2" height="3.2"/>
        <wall id="w3" a="n3" b="n4" thickness="0.2" height="3.2"/>
        <wall id="w4" a="n4" b="n1" thickness="0.2" height="3.2"/>
        <room id="r1" walls="w1 w2 w3 w4" name="Living room"/>
      </floor>
    </h3x>`;

    const doc = H3xDocument.fromXML(xml);
    doc.execute(moveNode('n3', { x: 5, y: 3 }));
    doc.execute(moveNode('n2', { x: 5, y: 0 }));
    const area = roomArea(doc.floor, doc.floor.rooms.r1!, 'center');
    expect(area).toBeCloseTo(15);
    expect(doc.toXML()).toContain('x="5"');
    doc.undo();
  });
});
