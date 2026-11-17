import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
import {
  H3xValidationError,
  roomPolygon,
  roomShape,
  type Floor,
  type Room,
  type Vec2,
} from '../core';
import { signedArea } from '../core/geometry/polygon';
import { toWorld } from './coords';
import { cutConvex, emitConvex, triangulate2D } from './openings';
import { TriangleSink } from './triangulate';

/**
 * Floor slab geometry for a room: the inner polygon at the floor elevation with
 * +Y normals, minus the convex `openings` (e.g. stair bays of the floor below). Returns null
 * when the room outline is invalid or not CCW.
 */
export function buildFloorGeometry(
  floor: Floor,
  room: Room,
  openings: Vec2[][] = [],
): BufferGeometry | null {
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
  const tris = cutConvex(triangulate2D(shape.outer, shape.holes), openings);
  emitConvex(sink, tris, (p) => toWorld(p, floor.elevation), new Vector3(0, 1, 0));

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(sink.positions, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(sink.normals, 3));
  return geom;
}
