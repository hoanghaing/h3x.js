// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, addRoof, moveNode, type Floor } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { planToScreen } from '../../src/plan/view';
import { oneRoomFloor } from '../fixtures/floors';

const P = 'h3x-plan';
let plans: H3xPlan[] = [];
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

function setup(floor: Floor = oneRoomFloor()): { doc: H3xDocument; plan: H3xPlan } {
  const doc = H3xDocument.fromProject({
    version: 1,
    unit: 'm',
    meta: { name: '', created: '' },
    floors: [floor],
  });
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, doc);
  plan.setView({ cx: 2, cy: 2, scale: 50 });
  plans.push(plan);
  return { doc, plan };
}
const roofG = (plan: H3xPlan): SVGGElement =>
  plan.svg.querySelector<SVGGElement>(`.${P}-layer-roofs .${P}-roof`)!;
const at = (plan: H3xPlan, x: number, y: number) => planToScreen(plan.view, { x, y });

describe('plan roofs', () => {
  it('a hip roof draws overhang, outline, 4 lines and 4 arrows with pitch labels', () => {
    const { doc, plan } = setup();
    doc.execute(addRoof({ preset: 'hip', rooms: ['r1'], follow: true }));
    const g = roofG(plan);
    expect(g.getAttribute('data-h3x-kind')).toBe('roof');
    expect(g.querySelectorAll(`.${P}-roof-eave`)).toHaveLength(1);
    expect(g.querySelectorAll(`.${P}-roof-outline`)).toHaveLength(1);
    expect(g.querySelectorAll(`.${P}-roof-line`)).toHaveLength(4);
    expect(g.querySelectorAll(`.${P}-roof-arrow`)).toHaveLength(4);
    const labels = Array.from(g.querySelectorAll(`.${P}-roof-label`)).map((t) => t.textContent);
    expect(labels).toEqual(['30°', '30°', '30°', '30°']);
    expect(g.querySelector(`.${P}-roof-light`)).toBeNull();
  });

  it('glass roofs carry the light hatch class', () => {
    const { doc, plan } = setup();
    const c = addRoof({ preset: 'hip', rooms: ['r1'], follow: true, material: 'glass' });
    doc.execute(c);
    expect(roofG(plan).querySelector(`.${P}-roof-light`)).not.toBeNull();
  });

  it('arrows point downhill: each arrow points away from the roof centre', () => {
    const { doc, plan } = setup();
    doc.execute(addRoof({ preset: 'hip', rooms: ['r1'], follow: true }));
    const arrows = Array.from(roofG(plan).querySelectorAll(`.${P}-roof-arrow`));
    // each arrow sits between the centre (2,2) and the outline: its transform translates there
    const dirs = arrows.map((a) => {
      const m = /matrix\(([^)]*)\)(?:\s*rotate\(([^)]*)\))?/.exec(a.getAttribute('transform')!)!;
      const [, , , , tx, ty] = m[1]!.split(',').map(Number);
      const angle = (-Number(m[2] ?? 0) * Math.PI) / 180;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      return { dot: (tx! - 2) * dir.x + (ty! - 2) * dir.y };
    });
    for (const d of dirs) expect(d.dot).toBeGreaterThan(0.1);
  });

  it('re-renders when a wall node moves (follow outline)', () => {
    const { doc, plan } = setup();
    doc.execute(addRoof({ preset: 'hip', rooms: ['r1'], follow: true }));
    const before = roofG(plan).querySelector(`.${P}-roof-outline`)!.getAttribute('d');
    doc.execute(moveNode('n3', { x: 5, y: 4 }));
    expect(roofG(plan).querySelector(`.${P}-roof-outline`)!.getAttribute('d')).not.toBe(before);
  });

  it('setRoofsVisible toggles the layer', () => {
    const { plan } = setup();
    const layer = plan.svg.querySelector(`.${P}-layer-roofs`)!;
    plan.setRoofsVisible(false);
    expect(layer.getAttribute('display')).toBe('none');
    plan.setRoofsVisible(true);
    expect(layer.getAttribute('display')).toBe('inline');
  });

  it('hit: wall beats roof, empty interior hits the roof, hidden roofs fall through to the room', () => {
    const { doc, plan } = setup();
    const c = addRoof({ preset: 'hip', rooms: ['r1'], follow: true });
    doc.execute(c);
    expect(plan.hitAt(at(plan, 3, 0))).toEqual({ kind: 'wall', id: 'w1' });
    expect(plan.hitAt(at(plan, 2, 1))).toEqual({ kind: 'roof', id: c.createdId });
    expect(plan.hitAt(at(plan, -0.3, 0.6))).toEqual({ kind: 'roof', id: c.createdId }); // overhang
    expect(plan.hitAt(at(plan, -2, 0.6))).toBeNull();
    plan.setRoofsVisible(false);
    expect(plan.hitAt(at(plan, 2, 1))).toEqual({ kind: 'room', id: 'r1' });
  });
});
