// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { H3xDocument, moveNode, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xPlan } from '../../src/plan/H3xPlan';
import { DrawWallTool } from '../../src/plan/tools/DrawWallTool';
import { DrawWallTool as Exported, type SegmentLengthRequest } from '../../src/plan';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

function docOf(floor: Floor): H3xDocument {
  return H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );
}

let plans: H3xPlan[] = [];
function makePlan(tool = new DrawWallTool()): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, docOf(oneRoomFloor()), { tool });
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

// The SVG's bounding rect is all zeros under jsdom, so client coordinates are screen coordinates.
function fire(plan: H3xPlan, type: string, p: Vec2, mods: { altKey?: boolean } = {}): void {
  const s = plan.planToScreen(p);
  const e = new MouseEvent(type, {
    clientX: s.x,
    clientY: s.y,
    button: 0,
    bubbles: true,
    cancelable: true,
    ...mods,
  });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  plan.svg.dispatchEvent(e);
}

function click(plan: H3xPlan, p: Vec2): void {
  fire(plan, 'pointermove', p);
  fire(plan, 'pointerdown', p);
  fire(plan, 'pointerup', p);
}

function key(plan: H3xPlan, k: string): void {
  plan.svg.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
}

const wallCount = (plan: H3xPlan) => Object.keys(plan.doc.floor.walls).length;
const roomCount = (plan: H3xPlan) => Object.keys(plan.doc.floor.rooms).length;
const previewLines = (plan: H3xPlan) => Array.from(plan.svg.querySelectorAll('.h3x-plan-preview'));
const previewLabel = (plan: H3xPlan) => plan.svg.querySelector('.h3x-plan-preview-label');

/** Start of the (single) preview segment. */
function previewFrom(plan: H3xPlan): Vec2 {
  const [line] = previewLines(plan);
  expect(line).toBeDefined();
  return { x: Number(line!.getAttribute('x1')), y: Number(line!.getAttribute('y1')) };
}

function hasWallBetween(plan: H3xPlan, p: Vec2, q: Vec2): boolean {
  const f = plan.doc.floor;
  const near = (n: Vec2 | undefined, v: Vec2) =>
    !!n && Math.abs(n.x - v.x) < 1e-6 && Math.abs(n.y - v.y) < 1e-6;
  return Object.values(f.walls).some((w) => {
    const a = f.nodes[w.a];
    const b = f.nodes[w.b];
    return (near(a, p) && near(b, q)) || (near(a, q) && near(b, p));
  });
}

describe('DrawWallTool', () => {
  it('is exported from h3x/plan', () => {
    expect(Exported).toBe(DrawWallTool);
  });

  it('draws a closed square: 4 walls, 1 room, one undo step per click', () => {
    const plan = makePlan();
    const corners = [
      { x: 10, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 4 },
      { x: 10, y: 4 },
    ];
    for (const c of corners) click(plan, c);
    click(plan, corners[0]!);
    expect(wallCount(plan)).toBe(8);
    expect(roomCount(plan)).toBe(2);
    for (let i = 0; i < 4; i++) expect(plan.doc.undo()).toBe(true);
    expect(wallCount(plan)).toBe(4);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('closing on the start node ends the chain', () => {
    const plan = makePlan();
    for (const c of [
      { x: 10, y: 0 },
      { x: 14, y: 0 },
      { x: 14, y: 4 },
    ])
      click(plan, c);
    click(plan, { x: 10, y: 0 });
    fire(plan, 'pointermove', { x: 12, y: 7 });
    expect(previewLines(plan)).toHaveLength(0);
  });

  it('shows a preview segment with its live length while drawing', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    fire(plan, 'pointermove', { x: 12.5, y: 0 });
    expect(previewFrom(plan)).toEqual({ x: 10, y: 0 });
    expect(previewLabel(plan)!.textContent).toBe('2.50 m');
    expect(wallCount(plan)).toBe(4);
  });

  it('clicking an existing wall mid-chain commits a T and ends the chain', () => {
    const plan = makePlan();
    click(plan, { x: 7, y: 2 });
    click(plan, { x: 4, y: 2 });
    expect(wallCount(plan)).toBe(6);
    expect(hasWallBetween(plan, { x: 7, y: 2 }, { x: 4, y: 2 })).toBe(true);
    fire(plan, 'pointermove', { x: 6, y: 6 });
    expect(previewLines(plan)).toHaveLength(0);
  });

  it('clicking a wall 0.2 m from a corner ends the chain on the corner node', () => {
    const plan = makePlan();
    click(plan, { x: 7, y: 0.2 });
    click(plan, { x: 4, y: 0.2 });
    expect(plan.issues.rejected).toEqual([]);
    expect(wallCount(plan)).toBe(5);
    expect(hasWallBetween(plan, { x: 7, y: 0.2 }, { x: 4, y: 0 })).toBe(true);
  });

  it('clicking an existing node ends the chain', () => {
    const plan = makePlan();
    click(plan, { x: 7, y: 4 });
    click(plan, { x: 4, y: 4 });
    expect(wallCount(plan)).toBe(5);
    fire(plan, 'pointermove', { x: 6, y: 6 });
    expect(previewLines(plan)).toHaveLength(0);
    click(plan, { x: 6, y: 6 }); // starts a new chain, adds nothing
    expect(wallCount(plan)).toBe(5);
  });

  it('double-click ends the chain at the last point without an extra wall', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    click(plan, { x: 12, y: 0 });
    fire(plan, 'dblclick', { x: 12, y: 0 });
    expect(wallCount(plan)).toBe(5);
    expect(plan.issues.rejected).toEqual([]);
    fire(plan, 'pointermove', { x: 12, y: 3 });
    expect(previewLines(plan)).toHaveLength(0);
  });

  it('Enter ends the chain at the last point', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    key(plan, 'Enter');
    expect(wallCount(plan)).toBe(5);
    fire(plan, 'pointermove', { x: 12, y: 3 });
    expect(previewLines(plan)).toHaveLength(0);
  });

  it('Esc removes only the preview; committed walls stay', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    fire(plan, 'pointermove', { x: 12, y: 2 });
    expect(previewLines(plan)).toHaveLength(1);
    key(plan, 'Escape');
    expect(previewLines(plan)).toHaveLength(0);
    expect(previewLabel(plan)).toBeNull();
    expect(wallCount(plan)).toBe(5);
  });

  it('Backspace undoes the chain’s last click and moves the chain back one point', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    click(plan, { x: 12, y: 2 });
    expect(wallCount(plan)).toBe(6);
    key(plan, 'Backspace');
    expect(wallCount(plan)).toBe(5);
    expect(plan.doc.canRedo).toBe(true);
    fire(plan, 'pointermove', { x: 12, y: 3 });
    expect(previewFrom(plan)).toEqual({ x: 12, y: 0 });
    // Back to the start point, then nothing more to take back.
    key(plan, 'Backspace');
    expect(wallCount(plan)).toBe(4);
    fire(plan, 'pointermove', { x: 11, y: 3 });
    expect(previewFrom(plan)).toEqual({ x: 10, y: 0 });
    key(plan, 'Backspace');
    expect(wallCount(plan)).toBe(4);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Backspace does nothing when the newest history entry is not the chain’s', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    plan.doc.execute(moveNode('n1', { x: -1, y: 0 }));
    key(plan, 'Backspace');
    expect(wallCount(plan)).toBe(5);
    expect(plan.doc.floor.nodes['n1']!.x).toBe(-1);
  });

  it('setPendingSegmentLength commits a wall of exactly that length along the preview direction', () => {
    const plan = makePlan();
    const requests: SegmentLengthRequest[] = [];
    plan.on('segmentLengthRequest', (e) => void requests.push(e));
    expect(plan.setPendingSegmentLength(3)).toBe(false);
    click(plan, { x: 10, y: 0 });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.from).toEqual({ x: 10, y: 0 });
    expect(requests[0]!.length).toBe(0);
    fire(plan, 'pointermove', { x: 11.3, y: 0 });
    expect(plan.setPendingSegmentLength(3)).toBe(true);
    expect(hasWallBetween(plan, { x: 10, y: 0 }, { x: 13, y: 0 })).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[1]!.from).toEqual({ x: 13, y: 0 });
    fire(plan, 'pointermove', { x: 13, y: 2 });
    expect(previewFrom(plan)).toEqual({ x: 13, y: 0 });
  });

  it('two typed lengths in a row continue along the same direction until the pointer moves', () => {
    const plan = makePlan();
    const requests: SegmentLengthRequest[] = [];
    plan.on('segmentLengthRequest', (e) => void requests.push(e));
    click(plan, { x: 10, y: 0 });
    fire(plan, 'pointermove', { x: 11.3, y: 0 });
    expect(plan.setPendingSegmentLength(3)).toBe(true);
    expect(requests.at(-1)!.direction).toEqual({ x: 1, y: 0 });
    expect(plan.setPendingSegmentLength(2)).toBe(true);
    expect(hasWallBetween(plan, { x: 13, y: 0 }, { x: 15, y: 0 })).toBe(true);
    fire(plan, 'pointermove', { x: 15, y: 4 });
    expect(plan.setPendingSegmentLength(1)).toBe(true);
    expect(hasWallBetween(plan, { x: 15, y: 0 }, { x: 15, y: 1 })).toBe(true);
  });

  it('setPendingSegmentLength ignores a non-finite or non-positive length', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    fire(plan, 'pointermove', { x: 11.3, y: 0 });
    for (const len of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(plan.setPendingSegmentLength(len)).toBe(false);
    }
    expect(wallCount(plan)).toBe(4);
    expect(plan.issues.rejected).toEqual([]);
    expect(previewFrom(plan)).toEqual({ x: 10, y: 0 });
  });

  it('a rejected click flashes the issue and leaves the chain unchanged', () => {
    const plan = makePlan();
    click(plan, { x: 6, y: 0 });
    click(plan, { x: 3, y: 0 }); // runs along w1 from n2
    expect(plan.issues.rejected.map((i) => i.code)).toContain('walls-overlap');
    expect(wallCount(plan)).toBe(4);
    fire(plan, 'pointermove', { x: 6, y: 3 });
    expect(previewFrom(plan)).toEqual({ x: 6, y: 0 });
  });

  it('an external undo that removes the chain’s node resets the chain', () => {
    const plan = makePlan();
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    plan.doc.undo();
    expect(() => fire(plan, 'pointermove', { x: 12, y: 3 })).not.toThrow();
    expect(previewLines(plan)).toHaveLength(0);
    click(plan, { x: 12, y: 3 }); // a new first point
    expect(wallCount(plan)).toBe(4);
  });

  it('deactivate clears the preview and the chain', () => {
    const tool = new DrawWallTool();
    const plan = makePlan(tool);
    click(plan, { x: 10, y: 0 });
    fire(plan, 'pointermove', { x: 12, y: 0 });
    expect(previewLines(plan)).toHaveLength(1);
    plan.setTool(null);
    expect(previewLines(plan)).toHaveLength(0);
    plan.setTool(tool);
    fire(plan, 'pointermove', { x: 12, y: 2 });
    expect(previewLines(plan)).toHaveLength(0);
  });

  it('uses the thickness option and the floor height by default', () => {
    const plan = makePlan(new DrawWallTool({ thickness: 0.15 }));
    click(plan, { x: 10, y: 0 });
    click(plan, { x: 12, y: 0 });
    const added = Object.values(plan.doc.floor.walls).find((w) => !/^w\d$/.test(w.id))!;
    expect(added.thickness).toBe(0.15);
    expect(added.height).toBe(3.2);
  });
});
