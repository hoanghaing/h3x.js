import type { Floor, Id, Vec2 } from '../../core';
import { EPS, cross, leftNormal, normalize } from '../../core/geometry/vec';

/** Wall outline corners in plan space. start = node a, left = left of a→b. */
export interface WallCorners {
  startLeft: Vec2;
  startRight: Vec2;
  endLeft: Vec2;
  endRight: Vec2;
}

/** A join point farther than MITER_LIMIT × half-thickness from its node falls back to a square end. */
export const MITER_LIMIT = 4;

interface Incident {
  corners: WallCorners;
  atStart: boolean;
  d: Vec2;
  h: number;
}

export function computeWallCorners(floor: Floor): Record<Id, WallCorners> {
  const out: Record<Id, WallCorners> = {};
  const incident: Record<Id, Incident[]> = {};

  for (const w of Object.values(floor.walls)) {
    const a = floor.nodes[w.a];
    const b = floor.nodes[w.b];
    if (!a || !b) continue;
    const d = normalize({ x: b.x - a.x, y: b.y - a.y });
    const h = w.thickness / 2;
    const zero = { x: 0, y: 0 };
    const corners: WallCorners = {
      startLeft: zero,
      startRight: zero,
      endLeft: zero,
      endRight: zero,
    };
    out[w.id] = corners;
    (incident[w.a] ??= []).push({ corners, atStart: true, d, h });
    (incident[w.b] ??= []).push({ corners, atStart: false, d: { x: -d.x, y: -d.y }, h });
  }

  const setLeft = (i: Incident, p: Vec2) => {
    i.corners[i.atStart ? 'startLeft' : 'endRight'] = p;
  };
  const setRight = (i: Incident, p: Vec2) => {
    i.corners[i.atStart ? 'startRight' : 'endLeft'] = p;
  };

  for (const [nodeId, list] of Object.entries(incident)) {
    const n = floor.nodes[nodeId];
    const first = list[0];
    if (!n || !first) continue;
    const left = (i: Incident): Vec2 => {
      const ln = leftNormal(i.d);
      return { x: n.x + ln.x * i.h, y: n.y + ln.y * i.h };
    };
    const right = (i: Incident): Vec2 => {
      const ln = leftNormal(i.d);
      return { x: n.x - ln.x * i.h, y: n.y - ln.y * i.h };
    };

    if (list.length === 1) {
      setLeft(first, left(first));
      setRight(first, right(first));
      continue;
    }

    const sorted = [...list].sort((p, q) => Math.atan2(p.d.y, p.d.x) - Math.atan2(q.d.y, q.d.x));
    sorted.forEach((wi, idx) => {
      const wj = sorted[(idx + 1) % sorted.length];
      if (!wj) return;
      const p = left(wi);
      const q = right(wj);
      let pi = p;
      let pj = q;
      const den = cross(wi.d, wj.d);
      if (Math.abs(den) >= EPS) {
        const t = cross({ x: q.x - p.x, y: q.y - p.y }, wj.d) / den;
        const m = { x: p.x + wi.d.x * t, y: p.y + wi.d.y * t };
        if (Math.hypot(m.x - n.x, m.y - n.y) <= MITER_LIMIT * Math.max(wi.h, wj.h)) {
          pi = m;
          pj = m;
        }
      }
      setLeft(wi, pi);
      setRight(wj, pj);
    });
  }
  return out;
}
