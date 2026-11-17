// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, type Floor, type Project, type Vec2 } from '../../src/core';
import { signedArea } from '../../src/core/geometry/polygon';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

/*
 * Hit-testing uses the outline the plan draws: for every kind, a point 1 cm inside an edge of the
 * drawn shape hits the entity and a point 1 cm outside does not.
 */

const P = 'h3x-plan';
const EPS = 0.01;

let plans: H3xPlan[] = [];
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

/** Ground floor (one 4 × 4 room) with a column of each shape, a sofa and a stair, plus a floor above. */
function floor(): Floor {
  const f = oneRoomFloor();
  f.columns = {
    c1: { id: 'c1', x: 1, y: 3, width: 0.3, rotation: 0.3, shape: 'square' },
    c2: { id: 'c2', x: 3, y: 3.2, width: 0.3, rotation: 0, shape: 'round' },
  } as Floor['columns'];
  f.items = {
    i1: { id: 'i1', preset: 'sofa-3s-01', mount: 'floor', x: 2, y: 1.2, rotation: 0.2 },
  } as Floor['items'];
  f.stairs = {
    s1: {
      id: 's1',
      x: 8,
      y: 2,
      width: 3.4,
      depth: 4.85,
      rotation: 0,
      type: 'spiral',
      turn: 'landing',
      hand: 'right',
      flightWidth: 0.9,
    },
  };
  return f;
}

function makePlan(): H3xPlan {
  const ground = floor();
  const upper = { ...oneRoomFloor(), id: 'f2', level: 1, elevation: 3.35 } as Floor;
  upper.openings = {};
  const doc = H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-11-17T00:00:00Z' },
      floors: [ground, upper],
      site: {
        id: 'site',
        points: [
          { x: -3, y: -3 },
          { x: 12, y: -3 },
          { x: 12, y: 7 },
          { x: -3, y: 7 },
        ],
      },
    } as Project,
    { presets: testPresets },
  );
  doc.setActiveFloor('f1');
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, doc);
  plan.setView({ cx: 4, cy: 2, scale: 100 }); // a 0.2 m wall is 20 px: hit on its outline only
  plans.push(plan);
  return plan;
}

const group = (plan: H3xPlan, kind: string, id: string): SVGGElement =>
  plan.svg.querySelector<SVGGElement>(`[data-h3x-kind="${kind}"][data-h3x-id="${id}"]`)!;

const parsePoints = (attr: string): Vec2[] =>
  attr
    .trim()
    .split(/\s+/)
    .map((p) => {
      const [x, y] = p.split(',').map(Number);
      return { x: x!, y: y! };
    });

/** The first ring of an SVG path `M…L…Z`. */
const parsePath = (d: string): Vec2[] => parsePoints(d.slice(1, d.indexOf('Z')).replace(/L/g, ' '));

const hit = (plan: H3xPlan, p: Vec2) => plan.hitAt(plan.planToScreen(p));

/** Probes the midpoint of every edge at least `minEdge` long, 1 cm in and 1 cm out. */
function probeEdges(
  plan: H3xPlan,
  poly: Vec2[],
  target: { kind: string; id: string },
  minEdge = 0.15,
) {
  const ccw = signedArea(poly) > 0 ? 1 : -1;
  let probed = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < minEdge) return;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // outward normal: right of the edge for a counter-clockwise polygon
    const n = { x: (ccw * (b.y - a.y)) / len, y: (-ccw * (b.x - a.x)) / len };
    expect(hit(plan, { x: m.x - n.x * EPS, y: m.y - n.y * EPS }), `inside edge ${i}`).toEqual(
      target,
    );
    expect(hit(plan, { x: m.x + n.x * EPS, y: m.y + n.y * EPS }), `outside edge ${i}`).not.toEqual(
      target,
    );
    probed++;
  });
  expect(probed).toBeGreaterThan(0);
}

describe('hit region = drawn outline', () => {
  it('wall: its drawn polygon (long faces)', () => {
    const plan = makePlan();
    const poly = parsePoints(
      group(plan, 'wall', 'w2').querySelector('polygon')!.getAttribute('points')!,
    );
    probeEdges(plan, poly, { kind: 'wall', id: 'w2' }, 1);
  });

  it('room: its drawn inner outline', () => {
    const plan = makePlan();
    const ring = parsePath(group(plan, 'room', 'r1').querySelector('path')!.getAttribute('d')!);
    // edge midpoints are clear of the door gap (x 0.75 … 1.65 on the bottom side)
    probeEdges(plan, ring, { kind: 'room', id: 'r1' }, 1);
  });

  it('opening: its drawn gap', () => {
    const plan = makePlan();
    const gap = group(plan, 'opening', 'o1').querySelector(`.${P}-opening-gap`)!;
    probeEdges(plan, parsePoints(gap.getAttribute('points')!), { kind: 'opening', id: 'o1' });
  });

  it('column: the drawn rectangle and circle', () => {
    const plan = makePlan();
    const sq = group(plan, 'column', 'c1').querySelector('polygon')!;
    probeEdges(plan, parsePoints(sq.getAttribute('points')!), { kind: 'column', id: 'c1' });
    const c = group(plan, 'column', 'c2').querySelector('circle')!;
    const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(c.getAttribute(k)));
    for (let k = 0; k < 8; k++) {
      const t = (k / 8) * Math.PI * 2;
      const at = (d: number) => ({ x: cx! + Math.cos(t) * d, y: cy! + Math.sin(t) * d });
      expect(hit(plan, at(r! - EPS))).toEqual({ kind: 'column', id: 'c2' });
      expect(hit(plan, at(r! + EPS))).not.toEqual({ kind: 'column', id: 'c2' });
    }
  });

  it('item: its drawn footprint', () => {
    const plan = makePlan();
    const poly = parsePoints(
      group(plan, 'item', 'i1').querySelector('polygon')!.getAttribute('points')!,
    );
    probeEdges(plan, poly, { kind: 'item', id: 'i1' });
  });

  it('stair: its drawn outline (a spiral square, not the bay)', () => {
    const plan = makePlan();
    const outline = group(plan, 'stair', 's1').querySelector(`.${P}-stair-outline`)!;
    const poly = parsePoints(outline.getAttribute('points')!);
    const ys = poly.map((p) => p.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(3.4, 9);
    probeEdges(plan, poly, { kind: 'stair', id: 's1' });
  });

  it('site: its drawn line (not filled)', () => {
    const plan = makePlan();
    const line = parsePoints(
      group(plan, 'site', 'site').querySelector('polygon')!.getAttribute('points')!,
    );
    const a = line[0]!;
    const b = line[1]!;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(hit(plan, m)).toEqual({ kind: 'site', id: 'site' });
    expect(hit(plan, { x: m.x, y: m.y + 0.2 })).toBeNull(); // inside the site, off the line
  });
});
