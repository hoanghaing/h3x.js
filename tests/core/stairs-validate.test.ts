// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { addFloor, removeFloor, setFloorHeight } from '../../src/core/commands/floors';
import { oneRoomFloor } from '../fixtures/floors';
import type { Floor, Stair } from '../../src/core/types';

/** Ground floor: one room whose inner faces enclose a 2.2 x 4.5 bay centred at (1.2, 2.35). */
function stairFloor(over: Partial<Stair> = {}): Floor {
  const f = oneRoomFloor();
  f.openings = {};
  f.nodes = {
    n1: { id: 'n1', x: 0, y: 0 },
    n2: { id: 'n2', x: 2.4, y: 0 },
    n3: { id: 'n3', x: 2.4, y: 4.7 },
    n4: { id: 'n4', x: 0, y: 4.7 },
  };
  f.stairs = {
    s1: {
      id: 's1',
      x: 1.2,
      y: 2.35,
      width: 2.2,
      depth: 4.5,
      rotation: 0,
      type: 'U',
      turn: 'landing',
      hand: 'right',
      flightWidth: 0.9,
      ...over,
    },
  };
  return f;
}

function docWith(over: Partial<Stair> = {}, upper = true): H3xDocument {
  const doc = H3xDocument.fromProject({
    version: 1,
    unit: 'm',
    meta: { name: 't', created: '2026-11-17T00:00:00Z' },
    floors: [stairFloor(over)],
  } as never);
  if (upper) doc.execute(addFloor({ position: 'above' }));
  doc.setActiveFloor('f1');
  return doc;
}

const stairIssues = (d: H3xDocument) =>
  d.validateLayout().filter((i) => i.code.startsWith('stair-'));

describe('stair warnings', () => {
  it('a bay matching the wall faces has no issues', () => {
    expect(stairIssues(docWith())).toEqual([]);
  });

  it('reports stair-overlaps-wall with [stair, wall] when the bay enters a wall', () => {
    const issues = stairIssues(docWith({ x: 1.1 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'stair-overlaps-wall', ids: ['s1', 'w4'] });
  });

  it('reports stair-no-floor-above on the top floor only', () => {
    const issues = stairIssues(docWith({}, false));
    expect(issues.map((i) => i.code)).toEqual(['stair-no-floor-above']);
    expect(issues[0]!.ids).toEqual(['s1']);
  });

  it('reports stair-does-not-fit when the storey grows, without blocking', () => {
    const doc = docWith({ type: 'straight', flightWidth: 1, depth: 4.5 });
    expect(stairIssues(doc)).toEqual([]);
    doc.execute(setFloorHeight('f1', 4.2));
    const issues = stairIssues(doc);
    expect(issues.map((i) => i.code)).toEqual(['stair-does-not-fit']);
    expect(issues[0]!.ids).toEqual(['s1']);
  });

  it('removing the upper floor warns, undo clears it', () => {
    const doc = docWith();
    const upper = doc.project.floors[1]!.id;
    doc.execute(removeFloor(upper));
    expect(stairIssues(doc).map((i) => i.code)).toEqual(['stair-no-floor-above']);
    doc.undo();
    expect(stairIssues(doc)).toEqual([]);
  });
});
