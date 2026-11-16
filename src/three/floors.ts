import { BufferGeometry, Float32BufferAttribute, Vector2, Vector3 } from 'three';
import { H3xValidationError, roomPolygon, roomShape, type Floor, type Room } from '../core';
import { signedArea } from '../core/geometry/polygon';
import { toWorld } from './coords';
import { TriangleSink, triangulateInto } from './triangulate';

/**
 * Floor slab geometry for a room: the inner polygon at the floor elevation with
 * +Y normals. Returns null when the room outline is invalid or not CCW.
 */
export function buildFloorGeometry(floor: Floor, room: Room): BufferGeometry | null {
  let center;
  let shape;
  try {
    center = roomPolygon(floor, room, 'center');
    if (signedArea(center) <= 0) return null;
    shape = roomShape(floor, room, 'inner');
  } catch (e) {
    if (e instanceof H3xValidationError) return null;
    throw e;
  }
  if (shape.outer.length < 3) return null;

  const sink = new TriangleSink();
  const toV = (p: { x: number; y: number }) => new Vector2(p.x, p.y);
  const contour = shape.outer.map(toV);
  const holes = shape.holes.map((h) => h.map(toV));
  triangulateInto(sink, contour, holes, (p) => toWorld(p, floor.elevation), new Vector3(0, 1, 0));

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}
