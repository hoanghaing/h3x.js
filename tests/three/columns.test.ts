import { Box3, LineLoop, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  addColumn,
  moveColumn,
  removeColumn,
  setSite,
  type Project,
} from '../../src/core';
import { H3xScene, buildColumnGeometry } from '../../src/three';
import { oneRoomFloor } from '../fixtures/floors';

const size = (g: BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!.getSize(new Box3().max);
};

const makeDoc = () =>
  H3xDocument.fromProject({ name: 'p', floors: [oneRoomFloor()] } as unknown as Project);

describe('buildColumnGeometry', () => {
  const floor = oneRoomFloor();
  it('square column is width x depth x wallHeight', () => {
    const g = buildColumnGeometry(floor, {
      id: 'c',
      x: 1,
      y: 2,
      shape: 'square',
      width: 0.3,
      rotation: 0,
    });
    const s = size(g);
    expect([s.x, s.y, s.z].map((v) => +v.toFixed(6))).toEqual([0.3, 3.2, 0.3]);
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(g.boundingBox!.getCenter(new Box3().max).x).toBeCloseTo(1, 6);
  });
  it('rotated square widens its bounding box', () => {
    const g = buildColumnGeometry(floor, {
      id: 'c',
      x: 0,
      y: 0,
      shape: 'square',
      width: 0.3,
      rotation: Math.PI / 4,
      height: 1,
    });
    expect(size(g).x).toBeCloseTo(0.3 * Math.SQRT2, 6);
    expect(size(g).y).toBeCloseTo(1, 6);
  });
  it('round column has the diameter', () => {
    const g = buildColumnGeometry(
      { ...floor, elevation: 3 },
      { id: 'c', x: 0, y: 0, shape: 'round', width: 0.35, rotation: 0 },
    );
    expect(size(g).x).toBeCloseTo(0.35, 6);
    expect(g.boundingBox!.min.y).toBeCloseTo(3, 6);
  });
});

describe('H3xScene columns and site', () => {
  it('keeps mesh identity across moveColumn and removes on removeColumn', () => {
    const doc = makeDoc();
    const scene = new H3xScene(doc);
    const add = addColumn({ x: 1, y: 1, shape: 'square', width: 0.3 });
    const id = add.createdId;
    doc.execute(add);
    const mesh = scene.getColumnMesh(id)!;
    expect(mesh.userData).toEqual({ h3xKind: 'column', h3xId: id });
    doc.execute(moveColumn(id, { x: 2 }));
    expect(scene.getColumnMesh(id)).toBe(mesh);
    doc.execute(removeColumn(id));
    expect(scene.getColumnMesh(id)).toBeUndefined();
    expect(mesh.parent).toBeNull();
  });

  it('draws and removes the site line', () => {
    const doc = makeDoc();
    const scene = new H3xScene(doc);
    expect(scene.root.getObjectByName('h3x-site')).toBeUndefined();
    doc.execute(
      setSite([
        { x: -1, y: -1 },
        { x: 9, y: -1 },
        { x: 9, y: 9 },
        { x: -1, y: 9 },
      ]),
    );
    const line = scene.root.getObjectByName('h3x-site') as LineLoop;
    expect(line.isLineLoop).toBe(true);
    expect(line.geometry.getAttribute('position').count).toBe(4);
    expect(line.geometry.getAttribute('position').getY(0)).toBeCloseTo(0.005, 6);
    doc.execute(setSite(null));
    expect(scene.root.getObjectByName('h3x-site')).toBeUndefined();
  });
});
