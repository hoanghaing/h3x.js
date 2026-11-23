import {
  roofGeometry,
  type RoofGeometry,
  type Floor,
  type Roof,
  type RoofFace,
  type Vec2,
} from '../core';
import { closestPointOnSegment } from '../core/geometry/segment';
import { pointInPolygon } from '../core/geometry/polygon';
import { NON_SCALING, pointsAttr, screenSpaceTransform, svgEl } from './svg';
import type { View } from './view';

/** Half-length and half-width (px) of a slope arrow, and the label offset below it. */
const ARROW_HALF_LENGTH_PX = 9;
const ARROW_HEAD_PX = 5;
const LABEL_OFFSET_PX = 12;
/** Smallest post square drawn (m), so thin posts stay visible. */
const MIN_POST = 0.1;

const ringPath = (r: readonly Vec2[]): string =>
  r.length ? `${r.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('')}Z` : '';
const ringsPath = (rings: readonly (readonly Vec2[])[]): string => rings.map(ringPath).join('');

/** Horizontal direction of steepest descent of a face plane, or undefined for a level face. */
/** Spacing and line width (m) of the glass / polycarbonate hatch. */
const HATCH_STEP = 0.25;
const HATCH_WIDTH = 0.02;

export function faceDescent(face: RoofFace): Vec2 | undefined {
  const poly = face.polygon;
  const n = { x: 0, y: 0, z: 0 };
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  });
  const h = Math.hypot(n.x, n.y);
  if (h < 1e-9) return undefined;
  const s = n.z < 0 ? -1 : 1; // upward normal
  return { x: (s * n.x) / h, y: (s * n.y) / h };
}

/** Area centroid of the plan projection of a face (vertex mean when degenerate). */
export function faceCentroid(face: RoofFace): Vec2 {
  const pts = face.polygon;
  let a = 0;
  let cx = 0;
  let cy = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  });
  if (Math.abs(a) < 1e-9) {
    const n = pts.length || 1;
    return { x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const planArea = (f: RoofFace): number => {
  const pts = f.polygon;
  return Math.abs(
    pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length]!;
      return s + p.x * q.y - q.x * p.y;
    }, 0) / 2,
  );
};

/**
 * One slope face per source edge and pitch: the overhang strip of an edge lies in the same plane
 * as its main face, so only the largest piece of each group carries an arrow.
 */
function arrowFaces(faces: readonly RoofFace[]): RoofFace[] {
  const best = new Map<string, RoofFace>();
  for (const f of faces) {
    if (!f.slope) continue;
    const key = `${f.ring}:${f.edge}:${f.pitch}`;
    const cur = best.get(key);
    if (!cur || planArea(f) > planArea(cur)) best.set(key, f);
  }
  return [...best.values()];
}

/**
 * Children of a roof on its floor: the dashed overhang outline, the outline, ridge / hip / valley
 * lines (a mansard break is drawn as a ridge), one downhill arrow with the pitch per slope face,
 * a hatch for glass and polycarbonate, and posts as squares.
 */
export function roofOwnShapes(
  roof: Roof,
  floor: Readonly<Floor>,
  view: View,
  prefix: string,
  geo: RoofGeometry = roofGeometry(roof, floor),
): SVGElement[] {
  const out: SVGElement[] = [];
  const light = roof.material === 'glass' || roof.material === 'polycarbonate';
  const hatchId = `${prefix}-roof-hatch-${roof.id}`;
  if (light) {
    // Plan coordinates are meters: a true-scale hatch, one line every 0.25 m, 2 cm wide.
    const pattern = svgEl('pattern', {
      id: hatchId,
      width: String(HATCH_STEP),
      height: String(HATCH_STEP),
      patternUnits: 'userSpaceOnUse',
      patternTransform: 'rotate(45)',
    });
    pattern.append(
      svgEl('line', {
        x1: '0',
        y1: '0',
        x2: '0',
        y2: String(HATCH_STEP),
        class: `${prefix}-roof-hatch`,
        style: `stroke-width:${HATCH_WIDTH}`,
      }),
    );
    const defs = svgEl('defs');
    defs.append(pattern);
    out.push(defs);
  }
  for (const body of geo.bodies) {
    if (light) {
      out.push(
        svgEl('path', {
          class: `${prefix}-roof-light`,
          d: ringsPath(body.overhangOutline),
          'fill-rule': 'evenodd',
          // Inline style: the stylesheet's `fill: none` for roof paths would override an attribute.
          style: `fill:url(#${hatchId})`,
          ...NON_SCALING,
        }),
      );
    }
    out.push(
      svgEl('path', {
        class: `${prefix}-roof-eave`,
        d: ringsPath(body.overhangOutline),
        ...NON_SCALING,
      }),
      svgEl('path', {
        class: `${prefix}-roof-outline`,
        d: ringsPath(body.outline),
        ...NON_SCALING,
      }),
    );
    for (const l of body.lines) {
      if (l.kind !== 'ridge' && l.kind !== 'hip' && l.kind !== 'valley') continue;
      out.push(
        svgEl('path', {
          class: `${prefix}-roof-line ${prefix}-roof-${l.kind}`,
          d: `M${l.a.x},${l.a.y}L${l.b.x},${l.b.y}`,
          ...NON_SCALING,
        }),
      );
    }
    for (const face of arrowFaces(body.faces)) {
      const dir = faceDescent(face);
      if (!dir) continue;
      const at = faceCentroid(face);
      const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
      const L = ARROW_HALF_LENGTH_PX;
      const H = ARROW_HEAD_PX;
      out.push(
        svgEl('polygon', {
          class: `${prefix}-roof-arrow`,
          points: `${-L},0 ${L - H},${-H} ${L - H},${H}`,
          transform: screenSpaceTransform(view, at, angle),
          ...NON_SCALING,
        }),
      );
      const t = svgEl('text', {
        class: `${prefix}-roof-label`,
        transform: screenSpaceTransform(view, at),
        y: String(LABEL_OFFSET_PX),
      });
      t.textContent = `${Math.round(face.pitch)}°`;
      out.push(t);
    }
    const half = Math.max(roof.postSize ?? MIN_POST, MIN_POST) / 2;
    for (const p of body.posts) {
      out.push(
        svgEl('polygon', {
          class: `${prefix}-roof-post`,
          points: pointsAttr([
            { x: p.x - half, y: p.y - half },
            { x: p.x + half, y: p.y - half },
            { x: p.x + half, y: p.y + half },
            { x: p.x - half, y: p.y + half },
          ]),
          ...NON_SCALING,
        }),
      );
    }
  }
  return out;
}

/**
 * Whether plan point `p` hits a roof: within `reach` (m) of an outline edge or a ridge / hip /
 * valley line, or inside the overhang outline (holes excluded).
 */
export function roofHit(
  roof: Roof,
  floor: Readonly<Floor>,
  p: Vec2,
  reach: number,
  geo: RoofGeometry = roofGeometry(roof, floor),
): boolean {
  for (const body of geo.bodies) {
    const ring0 = body.overhangOutline[0] ?? [];
    const xs = ring0.map((q) => q.x);
    const ys = ring0.map((q) => q.y);
    if (
      p.x < Math.min(...xs) - reach ||
      p.x > Math.max(...xs) + reach ||
      p.y < Math.min(...ys) - reach ||
      p.y > Math.max(...ys) + reach
    ) {
      continue;
    }
    const near = (a: Vec2, b: Vec2): boolean => {
      const cp = closestPointOnSegment(p, a, b).point;
      return Math.hypot(cp.x - p.x, cp.y - p.y) <= reach;
    };
    for (const ring of body.outline) {
      if (ring.some((a, i) => near(a, ring[(i + 1) % ring.length]!))) return true;
    }
    for (const l of body.lines) {
      if (l.kind !== 'eave' && l.kind !== 'rake' && near(l.a, l.b)) return true;
    }
    const [outer, ...holes] = body.overhangOutline;
    if (outer && pointInPolygon(p, outer) && !holes.some((h) => pointInPolygon(p, h))) return true;
  }
  return false;
}
