import { BoxGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import type { Column, Floor } from '../core';
import { planRotationToWorldY, toWorld } from './coords';

const ROUND_SEGMENTS = 24;

/**
 * Column solid from the floor elevation up to `height` (default: floor wallHeight).
 * Square columns are boxes rotated by `rotation`; round ones are 24-sided cylinders.
 */
export function buildColumnGeometry(floor: Floor, c: Column): BufferGeometry {
  const height = c.height ?? floor.wallHeight;
  const centre = toWorld({ x: c.x, y: c.y }, floor.elevation + height / 2);
  let geom: BufferGeometry;
  if (c.shape === 'round') {
    geom = new CylinderGeometry(c.width / 2, c.width / 2, height, ROUND_SEGMENTS);
  } else {
    geom = new BoxGeometry(c.width, height, c.depth ?? c.width);
    geom.rotateY(planRotationToWorldY(c.rotation));
  }
  geom.translate(centre.x, centre.y, centre.z);
  return geom;
}
