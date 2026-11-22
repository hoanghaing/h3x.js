// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  openingGeometry,
  pieceOutline,
  type Floor,
  type Opening,
} from '../../src/core';
import { hitTest } from '../../src/plan/hit';
import { paintOpening } from '../../src/plan/openings';
import { createEntityElement, updateEntityElement } from '../../src/plan/render';
import { DEFAULT_CSS } from '../../src/plan/style';
import { computeJoins } from '../../src/shared/walls/joins';
import { oneRoomFloor } from '../fixtures/floors';
import { DOOR_SYMBOLS, SAMPLE_SYMBOLS, WINDOW_SYMBOL } from '../fixtures/openingPaths';
import { OPENING_CASES, openingFloor } from '../fixtures/openings';

const P = 'h3x-plan';
const view = { cx: 2, cy: 0, scale: 100, width: 800, height: 600 };

/** What the plan puts in the DOM for an opening: gap points, solid path, dashed path. */
function drawn(floor: Floor, entity: Opening): string[] {
  const g = createEntityElement('opening', entity.id, P);
  const ctx = { floor, view, corners: {}, presets: undefined };
  updateEntityElement(g, { kind: 'opening', entity }, ctx);
  return [
    g.querySelector(`.${P}-opening-gap`)!.getAttribute('points')!,
    g.querySelector(`.${P}-opening-lines`)!.getAttribute('d')!,
    g.querySelector(`.${P}-opening-arc`)!.getAttribute('d')!,
  ];
}

describe('opening symbols', () => {
  it.each(Object.keys(SAMPLE_SYMBOLS))('%s draws exactly these coordinates', (file) => {
    const doc = H3xDocument.fromXML(readFileSync(`examples/layouts/${file}`, 'utf8'));
    const actual: Record<string, string[]> = {};
    for (const { id } of doc.project.floors) {
      doc.setActiveFloor(id);
      for (const o of Object.values(doc.floor.openings)) {
        actual[`${id}/${o.id}`] = drawn(doc.floor, o);
      }
    }
    expect(actual).toEqual(SAMPLE_SYMBOLS[file]);
  });

  it.each(Object.entries(DOOR_SYMBOLS))('swing door %s', (key, symbol) => {
    const f = oneRoomFloor();
    const [hinge, swing] = key.split('/') as [Opening['hinge'], Opening['swing']];
    expect(drawn(f, { ...f.openings.o1!, hinge, swing })).toEqual(symbol);
  });

  it('one-pane fixed window: three lines', () => {
    const f = oneRoomFloor();
    const o: Opening = { ...f.openings.o1!, type: 'window-fixed', sill: 0.9 };
    expect(drawn(f, o)).toEqual(WINDOW_SYMBOL);
  });

  it('follows the type, not the sill', () => {
    const f = oneRoomFloor();
    expect(drawn(f, { ...f.openings.o1!, type: 'window-fixed' })).toEqual(WINDOW_SYMBOL);
    expect(drawn(f, { ...f.openings.o1!, sill: 0.9 })).toEqual(DOOR_SYMBOLS['a/left']);
  });

  it('draws nothing without the wall', () => {
    const f = oneRoomFloor();
    expect(drawn(f, { ...f.openings.o1!, wall: 'gone' })).toEqual(['', '', '']);
  });

  it.each(OPENING_CASES)('$name: draws each piece of the geometry', ({ over }) => {
    const f = openingFloor(over);
    const g = openingGeometry(f, f.openings.o1!)!;
    const { lines, arcs } = paintOpening(g);
    for (const piece of g.plan) {
      const path = piece.role === 'box' ? arcs : lines;
      const rect = piece.depth > 0;
      const pts = rect ? pieceOutline(piece) : [piece.a, piece.b];
      const d = pts.map((p) => `${p.x},${p.y}`).join('L');
      expect(path).toContain(rect ? `M${d}Z` : `M${d}`);
    }
    expect(arcs.split('A').length - 1).toBe(g.sweeps.filter((s) => s.arc).length);
    expect(lines + arcs).not.toMatch(/NaN|Infinity/);
  });

  it('dashes the box of a rolling door, not its shutter', () => {
    const f = openingFloor({ type: 'door-rolling' });
    const { lines, arcs } = paintOpening(openingGeometry(f, f.openings.o1!)!);
    expect(lines).not.toContain('Z');
    expect(arcs.match(/Z/g)).toHaveLength(1);
  });

  it.each(['selected', 'invalid', 'rejected'])('%s colours the cut and every stroke', (state) => {
    const css = DEFAULT_CSS(P);
    expect(css).toContain(`.${P}-opening.${P}-${state} path`);
    expect(css).toContain(`.${P}-opening.${P}-${state} .${P}-opening-gap`);
  });
});

describe('opening geometry and paint on a room wall', () => {
  const xs = (pts: { x: number }[]) => pts.map((p) => p.x);

  it('builds a door with hinge at the near end', () => {
    const floor = oneRoomFloor();
    const g = openingGeometry(floor, floor.openings.o1!)!;
    expect(Math.min(...xs(g.cut))).toBeCloseTo(0.75);
    expect(Math.max(...xs(g.cut))).toBeCloseTo(1.65);
    expect(g.plan.map((p) => p.role)).toEqual(['leaf']);
    expect(g.plan[0]!.a.x).toBeCloseTo(0.75);
    expect(g.plan[0]!.b.y).toBeCloseTo(0.9);
    expect(g.sweeps[0]!.arc!.r).toBeCloseTo(0.9);
    expect(g.sweeps[0]!.arc!.center.x).toBeCloseTo(0.75);
  });

  it('mirrors the door when hinged at the other end', () => {
    const floor = oneRoomFloor();
    const g = openingGeometry(floor, { ...floor.openings.o1!, hinge: 'b', swing: 'right' })!;
    expect(g.plan[0]!.a.x).toBeCloseTo(1.65);
    expect(g.plan[0]!.b.y).toBeCloseTo(-0.9);
    expect(g.sweeps[0]!.arc!.center.x).toBeCloseTo(1.65);
  });

  it.each([
    [false, { x: 0.75, y: 0.9 }, { x: 1.65, y: 0 }, { x: 0.75, y: 0 }],
    [true, { x: 1.65, y: -0.9 }, { x: 0.75, y: 0 }, { x: 1.65, y: 0 }],
  ])('arc geometry for mirrored=%s', (mirrored, from, to, center) => {
    const floor = oneRoomFloor();
    const g = openingGeometry(floor, {
      ...floor.openings.o1!,
      hinge: mirrored ? 'b' : 'a',
      swing: mirrored ? 'right' : 'left',
    })!;
    const arc = g.sweeps[0]!.arc!;
    expect(arc.from.x).toBeCloseTo(from.x);
    expect(arc.from.y).toBeCloseTo(from.y);
    expect(arc.to.x).toBeCloseTo(to.x);
    expect(arc.to.y).toBeCloseTo(to.y);
    expect(arc.center.x).toBeCloseTo(center.x);
    expect(arc.center.y).toBeCloseTo(center.y);
    // both go clockwise in plan space (+y up), so the SVG flag is 0
    expect(arc.ccw).toBe(false);
    expect(paintOpening(g).arcs).toContain('A0.9,0.9 0 0 0 ');
  });

  it('builds a window with three lines', () => {
    const floor = oneRoomFloor();
    const g = openingGeometry(floor, { ...floor.openings.o1!, type: 'window-fixed', sill: 0.9 })!;
    expect(g.sweeps).toEqual([]);
    expect(g.plan.some((p) => p.role === 'leaf')).toBe(false);
    expect(g.plan).toHaveLength(3);
    const lineYs = g.plan.map((p) => p.a.y).sort((a, b) => a - b);
    expect(lineYs[0]).toBeCloseTo(-0.1);
    expect(lineYs[1]).toBeCloseTo(0);
    expect(lineYs[2]).toBeCloseTo(0.1);
  });
});

describe('opening hit', () => {
  const scene = (floor: Floor, scale: number) => ({
    floor,
    view: { ...view, scale },
    corners: computeJoins(floor).corners,
    dimensions: [],
  });
  const at = (scale: number, x: number, y: number) => ({
    x: view.width / 2 + (x - view.cx) * scale,
    y: view.height / 2 - y * scale,
  });
  const o1 = { kind: 'opening', id: 'o1' };

  describe.each([50, 200, 800])('at %i px/m', (scale) => {
    it.each(OPENING_CASES)('$name: cut and leaves', ({ over }) => {
      const f = openingFloor(over);
      const g = openingGeometry(f, f.openings.o1!)!;
      const s = scene(f, scale);
      for (const l of g.plan.filter((p) => p.role === 'leaf')) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const x = l.a.x + (l.b.x - l.a.x) * t;
          const y = l.a.y + (l.b.y - l.a.y) * t;
          expect(hitTest(s, at(scale, x, y))).toEqual(o1);
        }
      }
      for (const x of [1.401, 1.7, 2, 2.3, 2.599]) {
        for (const y of [-0.099, 0, 0.099]) expect(hitTest(s, at(scale, x, y))).toEqual(o1);
      }
    });

    it('a point in the sweep only is left to what stands there', () => {
      expect(hitTest(scene(openingFloor(), scale), at(scale, 2, 0.6))).toBeNull();
    });

    it('a leaf line has 4 px of reach', () => {
      const s = scene(openingFloor(), scale);
      expect(hitTest(s, at(scale, 1.4 - 3.5 / scale, 0.7))).toEqual(o1);
      expect(hitTest(s, at(scale, 1.4 - 4.5 / scale, 0.7))).toBeNull();
    });
  });

  it('a point in one cut wins over the reach of a neighbour leaf', () => {
    const f = openingFloor({ offset: 1.4, hinge: 'b' }); // its leaf stands at x = 2
    f.openings.o2 = { ...f.openings.o1!, id: 'o2', offset: 2.6, hinge: 'a', swing: 'right' };
    expect(hitTest(scene(f, 100), at(100, 2.02, 0.05))).toEqual({ kind: 'opening', id: 'o2' });
  });
});
