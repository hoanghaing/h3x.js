import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineLoop } from 'three';
import type { Site } from '../core';
import { toWorld } from './coords';

export const SITE_LINE_Y = 0.005;

/** Closed outline of the site boundary just above the ground plane. */
export function buildSiteLine(site: Site): LineLoop {
  const pos: number[] = [];
  for (const p of site.points) {
    const w = toWorld(p, SITE_LINE_Y);
    pos.push(w.x, w.y, w.z);
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const line = new LineLoop(geom, new LineBasicMaterial({ color: '#8a8a8a' }));
  line.name = 'h3x-site';
  return line;
}
