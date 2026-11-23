// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  H3xDocument,
  moveNode,
  openingClearances,
  removeOpening,
  openingGeometry,
  type Floor,
  type Hinge,
  type Opening,
  type Project,
  type Vec2,
} from '../../src/core';
import {
  H3xPlan,
  type OpeningDistanceRequest,
  type OpeningEditRequest,
} from '../../src/plan/H3xPlan';
import { openingShape, paintOpening } from '../../src/plan/openings';
import { DEFAULT_CSS } from '../../src/plan/style';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

/*
 * oneRoomFloor: a 4 x 4 room, walls 0.2 thick, w1 from n1 (0, 0) to n2 (4, 0), w2 from n2 to
 * n3 (4, 4). o1 is a 0.9 m door on w1 at 1.2 (jambs 0.75 and 1.65), swinging into the room.
 * w1's clear length runs from 0.1 to 3.9.
 */

function emptyFloor(id: string, level: number): Floor {
  return {
    id,
    level,
    elevation: level * 3.35,
    wallHeight: 3.2,
    slabThickness: 0.15,
    nodes: {},
    walls: {},
    openings: {},
    rooms: {},
    items: {},
    columns: {},
    stairs: {},
    roofs: {},
  };
}

function docOf(...floors: Floor[]): H3xDocument {
  return H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors,
    } as Project,
    { presets: testPresets },
  );
}

let plans: H3xPlan[] = [];
function makePlan(floor: Floor = oneRoomFloor(), ...more: Floor[]): H3xPlan {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 800 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 600 });
  document.body.appendChild(el);
  const plan = new H3xPlan(el, docOf(floor, ...more));
  // 100 px per metre: 8 px is 0.08 m.
  plan.setView({ cx: 2, cy: 2, scale: 100 });
  plans.push(plan);
  return plan;
}
afterEach(() => {
  for (const p of plans) p.dispose();
  plans = [];
});

interface Mods {
  altKey?: boolean;
  shiftKey?: boolean;
}

// The SVG's bounding rect is all zeros under jsdom, so client coordinates are screen coordinates.
function fire(plan: H3xPlan, type: string, p: Vec2, mods: Mods = {}): void {
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

function press(plan: H3xPlan, p: Vec2, mods: Mods = {}): void {
  fire(plan, 'pointermove', p, mods);
  fire(plan, 'pointerdown', p, mods);
}

function click(plan: H3xPlan, p: Vec2): void {
  press(plan, p);
  fire(plan, 'pointerup', p);
}

/** Presses at `from` and moves through `points`; releases at the last one unless `hold`. */
function drag(plan: H3xPlan, from: Vec2, points: Vec2[], mods: Mods = {}, hold = false): void {
  press(plan, from, mods);
  for (const p of points) fire(plan, 'pointermove', p, mods);
  if (!hold) fire(plan, 'pointerup', points[points.length - 1] ?? from, mods);
}

function key(plan: H3xPlan, k: string, mods: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods });
  plan.svg.dispatchEvent(e);
  return e;
}

const o1 = (plan: H3xPlan): Opening => plan.doc.floor.openings.o1!;
const ghost = (plan: H3xPlan) => plan.svg.querySelector('.h3x-plan-ghost');
const redGhost = (plan: H3xPlan) => plan.svg.querySelector('.h3x-plan-ghost.h3x-plan-invalid');
const handles = (plan: H3xPlan) => plan.svg.querySelectorAll('.h3x-plan-opening-handle');
const label = (plan: H3xPlan, end: Hinge) =>
  plan.svg.querySelector(`.h3x-plan-opening-distance[data-h3x-end="${end}"] text`)?.textContent;
const labelCentre = (plan: H3xPlan, end: Hinge): Vec2 => {
  const r = plan.openingDistanceRects().find((d) => d.end === end)!.rect;
  return plan.screenToPlan({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
};

/** A second door on w1 at 2.5 (jambs 2.05 and 2.95). */
function withNeighbour(): Floor {
  const f = oneRoomFloor();
  f.openings.o2 = { ...f.openings.o1!, id: 'o2', offset: 2.5 };
  return f;
}

describe('moving an opening by drag', () => {
  it('slides it along its wall as one undo step, snapping to the middle', () => {
    const plan = makePlan();
    drag(plan, { x: 1.2, y: 0 }, [
      { x: 1.5, y: 0.02 },
      { x: 1.99, y: 0.02 },
    ]);
    expect(o1(plan)).toMatchObject({ wall: 'w1', hinge: 'a', swing: 'left' });
    expect(o1(plan).offset).toBeCloseTo(2, 9);
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
    expect(ghost(plan)).toBeNull();
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('keeps the grab: a press off-centre moves the centre by the pointer travel', () => {
    const plan = makePlan();
    drag(plan, { x: 1.0, y: 0 }, [{ x: 1.31, y: 0 }], { altKey: true });
    expect(o1(plan).offset).toBeCloseTo(1.51, 9);
  });

  it('takes it to another wall, keeping the room it opens into', () => {
    const plan = makePlan();
    drag(plan, { x: 1.2, y: 0 }, [
      { x: 2, y: 1 }, // no wall in reach
      { x: 3.98, y: 1.6 },
      { x: 4, y: 2 },
    ]);
    // w2 runs up the right side; its left faces the room, as w1's does.
    expect(o1(plan)).toMatchObject({ wall: 'w2', hinge: 'a', swing: 'left' });
    expect(o1(plan).offset).toBeCloseTo(2, 9);
    plan.doc.undo();
    expect(o1(plan)).toMatchObject({ wall: 'w1', offset: 1.2 });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('shows a red bar at the pointer while no wall is in reach and keeps the last valid spot', () => {
    const plan = makePlan();
    drag(
      plan,
      { x: 1.2, y: 0 },
      [
        { x: 1.5, y: 0 },
        { x: 2, y: 1.5 },
      ],
      {},
      true,
    );
    expect(o1(plan).offset).toBeCloseTo(1.5, 9);
    expect(redGhost(plan)?.classList.contains('h3x-plan-ghost-free')).toBe(true);
    fire(plan, 'pointerup', { x: 2, y: 1.5 });
    expect(ghost(plan)).toBeNull();
    expect(o1(plan).offset).toBeCloseTo(1.5, 9);
  });

  it('passes over a neighbour (red ghost, last valid kept) and lands beyond it', () => {
    const plan = makePlan(withNeighbour());
    drag(plan, { x: 1.2, y: 0 }, [{ x: 1.5, y: 0 }], {}, true);
    expect(o1(plan).offset).toBeCloseTo(1.5, 9);
    expect(ghost(plan)).toBeNull();

    fire(plan, 'pointermove', { x: 2.5, y: 0 });
    expect(o1(plan).offset).toBeCloseTo(1.5, 9);
    const red = redGhost(plan);
    expect(red).not.toBeNull();
    const want = paintOpening(openingGeometry(plan.doc.floor, { ...o1(plan), offset: 2.5 })!);
    expect(red!.querySelector('.h3x-plan-opening-gap')!.getAttribute('points')).toBe(want.gap);
    expect(plan.issues.rejected.map((i) => i.code)).toContain('opening-overlap');

    fire(plan, 'pointermove', { x: 3.45, y: 0 });
    expect(o1(plan).offset).toBeCloseTo(3.45, 9);
    expect(ghost(plan)).toBeNull();
    fire(plan, 'pointerup', { x: 3.45, y: 0 });
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('released on an invalid spot keeps the last valid one and clears the ghost', () => {
    const plan = makePlan(withNeighbour());
    drag(plan, { x: 1.2, y: 0 }, [
      { x: 1.5, y: 0 },
      { x: 2.4, y: 0 },
    ]);
    expect(o1(plan).offset).toBeCloseTo(1.5, 9);
    expect(ghost(plan)).toBeNull();
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('out and back leaves no undo step and no change event', () => {
    const plan = makePlan();
    let changes = 0;
    drag(
      plan,
      { x: 1.2, y: 0 },
      [
        { x: 2, y: 0 },
        { x: 4, y: 2 },
      ],
      {},
      true,
    );
    plan.doc.on('change', () => changes++);
    fire(plan, 'pointermove', { x: 1.2, y: 0 });
    fire(plan, 'pointerup', { x: 1.2, y: 0 });
    expect(o1(plan)).toEqual(oneRoomFloor().openings.o1);
    expect(plan.doc.canUndo).toBe(false);
    expect(changes).toBe(1); // the step back itself
  });

  it('Esc mid-drag restores the start, clears the ghost and leaves no step', () => {
    const plan = makePlan(withNeighbour());
    drag(
      plan,
      { x: 1.2, y: 0 },
      [
        { x: 1.6, y: 0 },
        { x: 2.5, y: 0 },
      ],
      {},
      true,
    );
    expect(redGhost(plan)).not.toBeNull();
    expect(key(plan, 'Escape').defaultPrevented).toBe(true);
    expect(o1(plan).offset).toBe(1.2);
    expect(ghost(plan)).toBeNull();
    expect(plan.doc.canUndo).toBe(false);
    fire(plan, 'pointermove', { x: 3, y: 0 });
    fire(plan, 'pointerup', { x: 3, y: 0 });
    expect(o1(plan).offset).toBe(1.2);
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
  });

  it('undo mid-drag ends the gesture', () => {
    const plan = makePlan(withNeighbour());
    drag(
      plan,
      { x: 1.2, y: 0 },
      [
        { x: 1.6, y: 0 },
        { x: 2.5, y: 0 },
      ],
      {},
      true,
    );
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
    expect(ghost(plan)).toBeNull();
    fire(plan, 'pointermove', { x: 1.8, y: 0 });
    fire(plan, 'pointerup', { x: 1.8, y: 0 });
    expect(o1(plan).offset).toBe(1.2);
    expect(plan.doc.canUndo).toBe(false);
    expect(plan.doc.canRedo).toBe(true);
  });

  it('a delete mid-drag ends the gesture', () => {
    const plan = makePlan(withNeighbour());
    drag(
      plan,
      { x: 1.2, y: 0 },
      [
        { x: 1.6, y: 0 },
        { x: 2.5, y: 0 },
      ],
      {},
      true,
    );
    expect(plan.deleteSelection()).toBe(true);
    expect(plan.doc.floor.openings.o1).toBeUndefined();
    expect(ghost(plan)).toBeNull();
    expect(handles(plan)).toHaveLength(0);
    fire(plan, 'pointermove', { x: 1.8, y: 0 });
    fire(plan, 'pointerup', { x: 1.8, y: 0 });
    expect(plan.doc.floor.openings.o1).toBeUndefined();
    plan.doc.undo();
    expect(o1(plan).offset).toBeCloseTo(1.6, 9);
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
  });

  it('a floor switch mid-drag keeps what was done as one step and ends the gesture', () => {
    const plan = makePlan(withNeighbour(), emptyFloor('f2', 1));
    drag(
      plan,
      { x: 1.2, y: 0 },
      [
        { x: 1.6, y: 0 },
        { x: 2.5, y: 0 },
      ],
      {},
      true,
    );
    plan.doc.setActiveFloor('f2');
    expect(ghost(plan)).toBeNull();
    fire(plan, 'pointermove', { x: 1.8, y: 0 });
    fire(plan, 'pointerup', { x: 1.8, y: 0 });
    plan.doc.setActiveFloor('f1');
    expect(o1(plan).offset).toBeCloseTo(1.6, 9);
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
    expect(plan.doc.canUndo).toBe(false);
  });
});

describe('resizing an opening by its jamb handles', () => {
  function selected(floor: Floor = oneRoomFloor()): H3xPlan {
    const plan = makePlan(floor);
    click(plan, { x: 1.2, y: 0 });
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
    return plan;
  }

  it('shows two 8 px handles on the selected opening, none otherwise', () => {
    const plan = makePlan();
    expect(handles(plan)).toHaveLength(0);
    click(plan, { x: 1.2, y: 0 });
    expect(handles(plan)).toHaveLength(2);
    const r = handles(plan)[0]!;
    expect(Number(r.getAttribute('width'))).toBe(8);
    expect(plan.hitAt(plan.planToScreen({ x: 1.65, y: 0.07 }))).toEqual({
      kind: 'openingHandle',
      id: 'o1',
      end: 'b',
    });
    key(plan, 'Escape');
    expect(handles(plan)).toHaveLength(0);
  });

  it('moves one jamb; the other stays; width on a 5 cm grid; one undo step', () => {
    const plan = selected();
    drag(plan, { x: 1.65, y: 0 }, [
      { x: 1.8, y: 0 },
      { x: 1.98, y: 0.03 },
    ]);
    const o = o1(plan);
    expect(o.width).toBeCloseTo(1.25, 9);
    expect(o.offset - o.width / 2).toBeCloseTo(0.75, 9);
    plan.doc.undo();
    expect(o1(plan)).toEqual(oneRoomFloor().openings.o1);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Alt resizes without the grid', () => {
    const plan = selected();
    drag(plan, { x: 0.75, y: 0 }, [{ x: 0.53, y: 0 }], { altKey: true });
    expect(o1(plan).width).toBeCloseTo(1.12, 9);
    expect(o1(plan).offset + o1(plan).width / 2).toBeCloseTo(1.65, 9);
  });

  it('stops at 0.2 m', () => {
    const plan = selected();
    drag(plan, { x: 1.65, y: 0 }, [
      { x: 1.2, y: 0 },
      { x: 0.5, y: 0 },
    ]);
    expect(o1(plan).width).toBeCloseTo(0.2, 9);
    expect(o1(plan).offset - o1(plan).width / 2).toBeCloseTo(0.75, 9);
  });

  it('snaps the jamb onto the end of the clear length', () => {
    const plan = selected();
    drag(plan, { x: 0.75, y: 0 }, [
      { x: 0.4, y: 0 },
      { x: 0.15, y: 0 },
    ]);
    expect(o1(plan).width).toBeCloseTo(1.55, 9);
    expect(openingClearances(plan.doc.floor, o1(plan)).a.face).toBeCloseTo(0, 9);
  });

  it('into a neighbour: red ghost, last valid kept, release clears the ghost', () => {
    const plan = selected(withNeighbour());
    drag(
      plan,
      { x: 1.65, y: 0 },
      [
        { x: 1.8, y: 0 },
        { x: 2.5, y: 0 },
      ],
      {},
      true,
    );
    expect(o1(plan).width).toBeCloseTo(1.05, 9);
    expect(redGhost(plan)).not.toBeNull();
    fire(plan, 'pointerup', { x: 2.5, y: 0 });
    expect(ghost(plan)).toBeNull();
    expect(o1(plan).width).toBeCloseTo(1.05, 9);
  });

  it('past the end of the wall: the red ghost spans where the jamb is dragged', () => {
    const plan = selected();
    drag(
      plan,
      { x: 1.65, y: 0 },
      [
        { x: 3, y: 0 },
        { x: 4.5, y: 0 },
      ],
      {},
      true,
    );
    expect(o1(plan).width).toBeCloseTo(2.25, 9); // the last valid step, at 3
    const red = redGhost(plan)!;
    expect(red.querySelector('.h3x-plan-opening-gap')!.getAttribute('points')).toBe(
      '0.75,0.1 4.5,0.1 4.5,-0.1 0.75,-0.1',
    );
    fire(plan, 'pointerup', { x: 4.5, y: 0 });
  });

  it('a handle beside a node wins over the node', () => {
    const f = oneRoomFloor();
    f.openings.o1!.offset = 0.55; // jamb a at 0.1, 10 px from n1
    const plan = makePlan(f);
    click(plan, { x: 0.55, y: 0 });
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
    // 6 px from n1 and 4 px from the handle.
    expect(plan.hitAt(plan.planToScreen({ x: 0.06, y: 0 }))).toEqual({
      kind: 'openingHandle',
      id: 'o1',
      end: 'a',
    });
    drag(plan, { x: 0.06, y: 0 }, [
      { x: 0.3, y: 0 },
      { x: 0.46, y: 0 },
    ]);
    expect(plan.doc.floor.nodes.n1).toMatchObject({ x: 0, y: 0 });
    // The jamb keeps the 4 px it was grabbed beside: 0.46 + 0.04.
    expect(o1(plan).width).toBeCloseTo(0.5, 9);
    expect(o1(plan).offset + o1(plan).width / 2).toBeCloseTo(1, 9);
  });

  it('Esc mid-resize restores the width', () => {
    const plan = selected();
    drag(
      plan,
      { x: 1.65, y: 0 },
      [
        { x: 2, y: 0 },
        { x: 2.2, y: 0 },
      ],
      {},
      true,
    );
    key(plan, 'Escape');
    expect(o1(plan)).toEqual(oneRoomFloor().openings.o1);
    expect(plan.doc.canUndo).toBe(false);
  });
});

describe('keys on a selected opening', () => {
  it('arrows nudge it along its wall; across the wall they are not handled', () => {
    const plan = makePlan();
    click(plan, { x: 1.2, y: 0 });
    expect(key(plan, 'ArrowRight').defaultPrevented).toBe(true);
    expect(o1(plan).offset).toBeCloseTo(1.21, 9);
    key(plan, 'ArrowLeft', { shiftKey: true });
    expect(o1(plan).offset).toBeCloseTo(1.11, 9);
    expect(key(plan, 'ArrowUp').defaultPrevented).toBe(false);
    expect(o1(plan).offset).toBeCloseTo(1.11, 9);
    plan.doc.undo();
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
    expect(plan.doc.canUndo).toBe(false);
  });

  it('arrows follow the wall direction: up and down on a vertical wall', () => {
    const f = oneRoomFloor();
    f.openings.o1 = { ...f.openings.o1!, wall: 'w2', offset: 2 };
    const plan = makePlan(f);
    click(plan, { x: 4, y: 2 });
    key(plan, 'ArrowUp');
    expect(o1(plan).offset).toBeCloseTo(2.01, 9);
    expect(key(plan, 'ArrowRight').defaultPrevented).toBe(false);
  });

  it('a rejected nudge is reported and changes nothing', () => {
    const f = withNeighbour();
    f.openings.o1!.offset = 1.6; // flush with o2
    const plan = makePlan(f);
    click(plan, { x: 1.4, y: 0 });
    key(plan, 'ArrowRight');
    expect(o1(plan).offset).toBe(1.6);
    expect(plan.issues.rejected.map((i) => i.code)).toContain('opening-overlap');
  });

  it('Space cycles hinge and swing of a door, one undo step each', () => {
    const plan = makePlan();
    click(plan, { x: 1.2, y: 0 });
    expect(key(plan, ' ').defaultPrevented).toBe(true);
    expect(o1(plan)).toMatchObject({ hinge: 'b', swing: 'left' });
    key(plan, ' ');
    expect(o1(plan)).toMatchObject({ hinge: 'b', swing: 'right' });
    plan.doc.undo();
    expect(o1(plan)).toMatchObject({ hinge: 'b', swing: 'left' });
  });

  it('a held Space (key repeat) turns the door once', () => {
    const plan = makePlan();
    click(plan, { x: 1.2, y: 0 });
    key(plan, ' ');
    expect(key(plan, ' ', { repeat: true }).defaultPrevented).toBe(true);
    key(plan, ' ', { repeat: true });
    expect(o1(plan)).toMatchObject({ hinge: 'b', swing: 'left' });
    // Arrows still repeat.
    key(plan, 'ArrowRight', { repeat: true });
    expect(o1(plan).offset).toBeCloseTo(1.21, 9);
  });

  it('Space is not handled for a type with no hinge or swing', () => {
    const f = oneRoomFloor();
    f.openings.o1 = { ...f.openings.o1!, preset: 'window-01', type: 'window-fixed', sill: 0.9 };
    const plan = makePlan(f);
    click(plan, { x: 1.2, y: 0 });
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
    expect(key(plan, ' ').defaultPrevented).toBe(false);
    expect(o1(plan)).toMatchObject({ hinge: 'a', swing: 'left' });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('Space with nothing or something else selected is not handled', () => {
    const plan = makePlan();
    expect(key(plan, ' ').defaultPrevented).toBe(false);
    click(plan, { x: 2, y: 4 });
    expect(plan.selection?.kind).toBe('wall');
    expect(key(plan, ' ').defaultPrevented).toBe(false);
  });

  it('Delete removes the selected opening in one undo step', () => {
    const plan = makePlan();
    click(plan, { x: 1.2, y: 0 });
    expect(key(plan, 'Delete').defaultPrevented).toBe(true);
    expect(plan.doc.floor.openings.o1).toBeUndefined();
    expect(handles(plan)).toHaveLength(0);
    expect(plan.svg.querySelectorAll('.h3x-plan-opening-distance')).toHaveLength(0);
    plan.doc.undo();
    expect(o1(plan)).toBeDefined();
  });
});

describe('clear distances', () => {
  it('both show while the opening is selected, and none otherwise', () => {
    const plan = makePlan();
    expect(label(plan, 'a')).toBeUndefined();
    click(plan, { x: 1.2, y: 0 });
    expect(label(plan, 'a')).toBe('0.65');
    expect(label(plan, 'b')).toBe('2.25');
    click(plan, { x: 2, y: 2 });
    expect(label(plan, 'a')).toBeUndefined();
  });

  it('follow the opening while it is dragged', () => {
    const plan = makePlan(withNeighbour());
    drag(plan, { x: 1.2, y: 0 }, [{ x: 1.0, y: 0 }], { altKey: true }, true);
    expect(label(plan, 'a')).toBe('0.45');
    expect(label(plan, 'b')).toBe('0.60'); // to o2's jamb at 2.05
    fire(plan, 'pointermove', { x: 2.5, y: 0 }); // invalid: the document keeps 1.0
    expect(label(plan, 'a')).toBe('0.45');
    fire(plan, 'pointermove', { x: 3.45, y: 0 });
    const c = openingClearances(plan.doc.floor, o1(plan));
    expect(label(plan, 'a')).toBe(c.a.face.toFixed(2));
    expect(label(plan, 'b')).toBe('0.00');
    fire(plan, 'pointerup', { x: 3.45, y: 0 });
  });

  it('a click on one asks the host for that distance', () => {
    const plan = makePlan();
    const asked: OpeningDistanceRequest[] = [];
    plan.on('openingDistanceRequest', (e) => asked.push(e));
    click(plan, { x: 1.2, y: 0 });
    expect(plan.hitAt(plan.planToScreen(labelCentre(plan, 'b')))).toEqual({
      kind: 'openingDistance',
      id: 'o1',
      end: 'b',
    });
    click(plan, labelCentre(plan, 'b'));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ openingId: 'o1', end: 'b', from: 'face' });
    expect(asked[0]!.distance).toBeCloseTo(2.25, 9);
    const r = plan.openingDistanceRects().find((d) => d.end === 'b')!.rect;
    expect(asked[0]!.at.x).toBeCloseTo(r.x + r.width / 2, 6);
    expect(asked[0]!.at.y).toBeCloseTo(r.y + r.height / 2, 6);
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
    expect(plan.doc.canUndo).toBe(false);
  });

  it('a double click on one asks only once', () => {
    const plan = makePlan();
    const asked: OpeningDistanceRequest[] = [];
    plan.on('openingDistanceRequest', (e) => asked.push(e));
    click(plan, { x: 1.2, y: 0 });
    click(plan, labelCentre(plan, 'b'));
    click(plan, labelCentre(plan, 'b'));
    expect(asked).toHaveLength(1);
  });

  it('setOpeningDistance answers it: one undo step; a rejected value is reported', () => {
    const plan = makePlan(withNeighbour());
    expect(plan.setOpeningDistance('o1', { end: 'a', distance: 0.3 })).toEqual({ ok: true });
    expect(o1(plan).offset).toBeCloseTo(0.85, 9);
    const res = plan.setOpeningDistance('o1', { end: 'a', distance: 2 });
    expect(res.ok).toBe(false);
    expect(plan.issues.rejected.map((i) => i.code)).toContain('opening-overlap');
    expect(o1(plan).offset).toBeCloseTo(0.85, 9);
    expect(plan.setOpeningDistance('o1', { end: 'b', distance: 2.4, from: 'axis' })).toEqual({
      ok: true,
    });
    expect(o1(plan).offset).toBeCloseTo(1.6 - 0.45, 9); // jamb b 2.4 from n2
    plan.doc.undo();
    plan.doc.undo();
    expect(o1(plan).offset).toBe(1.2);
  });

  it('a double-click on an opening asks the host to edit it', () => {
    const plan = makePlan();
    const asked: OpeningEditRequest[] = [];
    plan.on('openingEditRequest', (e) => asked.push(e));
    click(plan, { x: 1.2, y: 0 });
    click(plan, { x: 1.2, y: 0 });
    fire(plan, 'dblclick', { x: 1.2, y: 0 });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.openingId).toBe('o1');
    const s = plan.planToScreen({ x: 1.2, y: 0 });
    expect(asked[0]!.at).toEqual(s);
    expect(plan.doc.canUndo).toBe(false);
    expect(Object.keys(plan.doc.floor.nodes)).toHaveLength(4); // no point inserted
  });
});

describe('the end of the clear distance is where the wall accepts the opening', () => {
  const freeEnd = (): Floor => {
    const f = oneRoomFloor();
    delete f.walls.w4;
    f.rooms = {};
    return f;
  };
  const thinPartition = (): Floor => {
    const f = oneRoomFloor();
    f.walls.w4!.thickness = 0.1;
    return f;
  };

  it.each([
    ['a free wall end', freeEnd],
    ['a 0.1 m meeting wall', thinPartition],
  ])('at %s: label, jamb snap and a typed 0 agree', (_, floor) => {
    const plan = makePlan(floor());
    click(plan, { x: 1.2, y: 0 });
    expect(label(plan, 'a')).toBe('0.65');
    // The jamb snaps onto 0.1 and the document takes it.
    drag(plan, { x: 0.75, y: 0 }, [
      { x: 0.4, y: 0 },
      { x: 0.13, y: 0 },
    ]);
    expect(redGhost(plan)).toBeNull();
    expect(o1(plan).width).toBeCloseTo(1.55, 9);
    expect(label(plan, 'a')).toBe('0.00');
    plan.doc.undo();
    expect(plan.setOpeningDistance('o1', { end: 'a', distance: 0 })).toEqual({ ok: true });
    expect(o1(plan).offset).toBeCloseTo(0.55, 9);
  });
});

describe('opening shapes cached for hit testing', () => {
  /** Every cached shape equals a fresh one, removed openings have none, and hits agree. */
  function expectFresh(plan: H3xPlan): void {
    const floor = plan.doc.floor;
    for (const o of Object.values(floor.openings)) {
      expect(plan.cachedOpeningShape(o.id), o.id).toEqual(openingShape(floor, o));
      const g = openingShape(floor, o).geometry!;
      const centre = {
        x: (g.cut[0].x + g.cut[2].x) / 2,
        y: (g.cut[0].y + g.cut[2].y) / 2,
      };
      expect(plan.hitAt(plan.planToScreen(centre))).toEqual({ kind: 'opening', id: o.id });
    }
  }

  it('follow edits of the opening, its wall, a neighbouring wall, undo and delete', () => {
    const f = oneRoomFloor();
    f.openings.o1!.offset = 0.55; // flush with the corner at n1
    f.openings.o2 = { ...f.openings.o1!, id: 'o2', wall: 'w2', offset: 2 };
    const plan = makePlan(f);
    expectFresh(plan);
    const doc = plan.doc;
    // n4 is not on w1, but w4 meets w1 at n1: the corner (and o1's cut) moves.
    doc.execute(moveNode('n4', { x: -1, y: 4 }));
    expectFresh(plan);
    doc.execute(moveNode('n3', { x: 4.5, y: 4 }));
    expectFresh(plan);
    plan.setOpeningDistance('o2', { end: 'a', distance: 1 });
    expectFresh(plan);
    doc.undo();
    doc.undo();
    expectFresh(plan);
    doc.execute(removeOpening('o2'));
    expect(plan.cachedOpeningShape('o2')).toBeUndefined();
    expect(plan.hitAt(plan.planToScreen({ x: 4, y: 2 }))).toEqual({ kind: 'wall', id: 'w2' });
    expectFresh(plan);
  });
});

describe('an opening wholly beyond its wall', () => {
  function stray(): H3xPlan {
    const f = oneRoomFloor();
    f.openings.o1!.offset = 5; // jambs 4.55 and 5.45, past w1's end at 4
    return makePlan(f);
  }

  it('is drawn where it is stored, flagged, and can be selected and deleted', () => {
    const plan = stray();
    const g = plan.getElement('opening', 'o1')!;
    expect(g.classList.contains('h3x-plan-invalid')).toBe(true);
    expect(g.querySelector('.h3x-plan-opening-gap')!.getAttribute('points')).toBe(
      '4.55,0.1 5.45,0.1 5.45,-0.1 4.55,-0.1',
    );
    expect(plan.hitAt(plan.planToScreen({ x: 5, y: 0 }))).toEqual({ kind: 'opening', id: 'o1' });
    click(plan, { x: 5, y: 0 });
    expect(plan.selection).toEqual({ kind: 'opening', id: 'o1' });
    key(plan, 'Delete');
    expect(plan.doc.floor.openings.o1).toBeUndefined();
  });

  it('can be dragged back onto its wall', () => {
    const plan = stray();
    drag(plan, { x: 5, y: 0 }, [
      { x: 3, y: 0 },
      { x: 2, y: 0 },
    ]);
    expect(o1(plan).offset).toBeCloseTo(2, 9);
    expect(plan.getElement('opening', 'o1')!.classList.contains('h3x-plan-invalid')).toBe(false);
  });
});

describe('swing warnings', () => {
  it('give way to the selection colour, as invalid does not', () => {
    const css = DEFAULT_CSS('h3x-plan');
    const warningRules = css.split(/\r?\n/).filter((l) => l.includes('-warning'));
    expect(warningRules.length).toBeGreaterThan(0);
    for (const rule of warningRules) {
      const selectors = rule.slice(0, rule.indexOf('{')).split(',');
      for (const sel of selectors)
        expect(sel).toContain('.h3x-plan-warning:not(.h3x-plan-selected)');
    }
  });

  it('mark the opening and what blocks it as a warning, not as invalid', () => {
    const f = oneRoomFloor();
    // A column right in front of the door, inside its swing.
    f.columns.c1 = { id: 'c1', x: 1.2, y: 0.5, shape: 'square', width: 0.2, rotation: 0 };
    const plan = makePlan(f);
    const codes = plan.issues.standing.map((i) => i.code);
    expect(codes).toContain('opening-swing-blocked');
    for (const [kind, id] of [
      ['opening', 'o1'],
      ['column', 'c1'],
    ] as const) {
      const g = plan.getElement(kind, id)!;
      expect(g.classList.contains('h3x-plan-warning')).toBe(true);
      expect(g.classList.contains('h3x-plan-invalid')).toBe(false);
    }
  });
});
