// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { H3xDocument } from '../../src/core/document/H3xDocument';
import { pushPullWall, splitWall } from '../../src/core/commands/structure';
import { H3xValidationError } from '../../src/core/errors';
import { openingRange } from '../../src/core/validate/layout';
import { roomArea } from '../../src/core/rooms/detect';
import type { Floor, Opening, Project, Wall } from '../../src/core/types';
import { oneRoomFloor, testPresets } from '../fixtures/floors';

const mk = (floor: Floor): H3xDocument =>
  H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );

const count = (rec: object): number => Object.keys(rec).length;
const area = (doc: H3xDocument): number =>
  roomArea(doc.floor, Object.values(doc.floor.rooms)[0]!, 'center');

function codeOf(fn: () => void): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof H3xValidationError) return err.issues[0]?.code;
    throw err;
  }
  return undefined;
}

function oneStep(doc: H3xDocument, run: () => void): void {
  const before = structuredClone(doc.floor);
  run();
  const after = structuredClone(doc.floor);
  doc.undo();
  expect(doc.floor).toEqual(before);
  doc.redo();
  expect(doc.floor).toEqual(after);
}

const opening = (id: string, wall: string, offset: number, width = 0.9): Opening => ({
  id,
  wall,
  preset: 'door-single-01',
  offset,
  width,
  height: 2.1,
  sill: 0,
  flip: false,
});

function withOpeningOnW2(offset: number): Floor {
  const f = oneRoomFloor();
  f.openings.o2 = opening('o2', 'w2', offset);
  return f;
}

/** 4x4 room whose bottom wall is split into w1 (0..1), w5 (1..3, thick) and w6 (3..4). */
function thickMiddleFloor(): Floor {
  const f = oneRoomFloor();
  f.nodes.n5 = { id: 'n5', x: 1, y: 0 };
  f.nodes.n6 = { id: 'n6', x: 3, y: 0 };
  f.walls.w1 = { ...f.walls.w1!, b: 'n5' };
  f.walls.w5 = { id: 'w5', a: 'n5', b: 'n6', thickness: 0.6, height: 3.2 };
  f.walls.w6 = { id: 'w6', a: 'n6', b: 'n2', thickness: 0.2, height: 3.2 };
  f.openings = { o5: opening('o5', 'w5', 0.6) };
  f.rooms.r1!.walls = ['w1', 'w5', 'w6', 'w2', 'w3', 'w4'];
  return f;
}

/** w1 split at x=1 and x=3; returns the middle segment. */
function splitTwice(doc: H3xDocument): Wall {
  doc.execute(splitWall('w1', { x: 1, y: 0 }));
  const second = Object.values(doc.floor.walls).find((w) => w.a === doc.floor.walls.w1!.b)!;
  doc.execute(splitWall(second.id, { x: 3, y: 0 }));
  return Object.values(doc.floor.walls).find(
    (w) => doc.floor.nodes[w.a]!.x === 1 && doc.floor.nodes[w.b]!.x === 3,
  )!;
}

describe('pushPullWall', () => {
  it('pushes a whole wall outward by sliding the neighbours', () => {
    const doc = mk(oneRoomFloor());
    oneStep(doc, () => doc.execute(pushPullWall('w1', -1)));
    expect(count(doc.floor.walls)).toBe(4);
    expect(count(doc.floor.nodes)).toBe(4);
    expect(doc.floor.nodes.n1).toMatchObject({ x: 0, y: -1 });
    expect(doc.floor.nodes.n2).toMatchObject({ x: 4, y: -1 });
    expect(Object.keys(doc.floor.rooms)).toEqual(['r1']);
    expect(area(doc)).toBeCloseTo(20, 6);
  });

  it('pulls a whole wall inward', () => {
    const doc = mk(oneRoomFloor());
    oneStep(doc, () => doc.execute(pushPullWall('w1', 1)));
    expect(area(doc)).toBeCloseTo(12, 6);
    expect(Object.keys(doc.floor.rooms)).toEqual(['r1']);
  });

  it('keeps openings on the pushed wall at their offsets', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(pushPullWall('w1', -1));
    expect(doc.floor.openings.o1).toMatchObject({ wall: 'w1', offset: 1.2 });
  });

  it('re-fits an opening on a slid neighbour that survives the shortening', () => {
    const doc = mk(withOpeningOnW2(3.3));
    doc.execute(pushPullWall('w1', 1));
    const o = doc.floor.openings.o2!;
    expect(o.wall).toBe('w2');
    const { hi } = openingRange(doc.floor, o);
    expect(o.offset).toBeLessThan(3.3);
    expect(o.offset).toBeCloseTo(hi, 6);
  });

  it('rejects with push-pull-cuts-opening when a slid neighbour cannot hold its opening', () => {
    const doc = mk(withOpeningOnW2(2));
    const before = structuredClone(doc.floor);
    expect(codeOf(() => doc.execute(pushPullWall('w1', 3.5)))).toBe('push-pull-cuts-opening');
    expect(doc.floor).toEqual(before);
  });

  it('re-fits the pushed wall when a connector changes its usable range', () => {
    const doc = mk(thickMiddleFloor());
    const mid = 'w5';
    const before = doc.floor.openings.o5!.offset;
    doc.execute(pushPullWall(mid, -1));
    const o = doc.floor.openings.o5!;
    expect(o.wall).toBe(mid);
    expect(o.offset).toBeGreaterThan(before);
    expect(o.offset).toBeCloseTo(openingRange(doc.floor, o).lo, 6);
  });

  it('slides one end and adds a connector at the other', () => {
    const doc = mk(oneRoomFloor());
    doc.execute(splitWall('w1', { x: 3, y: 0 }));
    const w1 = doc.floor.walls.w1!;
    oneStep(doc, () => doc.execute(pushPullWall('w1', -1)));
    expect(doc.floor.nodes.n1).toMatchObject({ x: 0, y: -1 });
    expect(count(doc.floor.walls)).toBe(6);
    expect(count(doc.floor.nodes)).toBe(6);
    const newB = doc.floor.walls.w1!.b;
    const connector = Object.values(doc.floor.walls).find((c) => c.a === w1.b && c.b === newB);
    expect(connector).toMatchObject({ thickness: 0.2, height: 3.2 });
    expect(doc.floor.nodes[newB]).toMatchObject({ x: 3, y: -1 });
    expect(doc.floor.walls.w1!.b).not.toBe(w1.b);
    expect(Object.keys(doc.floor.rooms)).toEqual(['r1']);
    expect(Object.values(doc.floor.rooms)[0]!.walls).toHaveLength(6);
    expect(area(doc)).toBeCloseTo(19, 6);
  });

  it('moves the free end and adds a connector at the attached end of a partial wall', () => {
    const doc = mk({
      id: 'f1',
      level: 0,
      elevation: 0,
      wallHeight: 3.2,
      nodes: {
        p: { id: 'p', x: 0, y: 0 },
        q: { id: 'q', x: 2, y: 0 },
        r: { id: 'r', x: 4, y: 0 },
      },
      walls: {
        w: { id: 'w', a: 'p', b: 'q', thickness: 0.2, height: 3.2 },
        v: { id: 'v', a: 'q', b: 'r', thickness: 0.2, height: 3.2 },
      },
      openings: {},
      rooms: {},
      items: {},
      columns: {},
    });
    oneStep(doc, () => doc.execute(pushPullWall('w', 0.5)));
    expect(count(doc.floor.walls)).toBe(3);
    expect(doc.floor.nodes.p).toMatchObject({ x: 0, y: 0.5 });
    expect(doc.floor.nodes.q).toMatchObject({ x: 2, y: 0 });
    expect(doc.floor.nodes.r).toMatchObject({ x: 4, y: 0 });
    const newB = doc.floor.walls.w!.b;
    expect(doc.floor.nodes[newB]).toMatchObject({ x: 2, y: 0.5 });
    const connector = Object.values(doc.floor.walls).find((c) => c.a === 'q' && c.b === newB);
    expect(connector).toMatchObject({ thickness: 0.2, height: 3.2 });
    expect(doc.floor.walls.v).toMatchObject({ a: 'q', b: 'r' });
  });

  it('makes a square bump-out with two connectors from the middle segment', () => {
    const doc = mk(oneRoomFloor());
    const mid = splitTwice(doc);
    const cmd = pushPullWall(mid.id, -1);
    oneStep(doc, () => doc.execute(cmd));
    const room = Object.values(doc.floor.rooms);
    expect(room).toHaveLength(1);
    expect(room[0]!.id).toBe('r1');
    expect(room[0]!.walls).toHaveLength(8);
    expect(area(doc)).toBeCloseTo(18, 6);
    const vertical = Object.values(doc.floor.walls).filter((w) => {
      const [p, q] = [doc.floor.nodes[w.a]!, doc.floor.nodes[w.b]!];
      return p.x === q.x && (p.x === 1 || p.x === 3) && Math.abs(p.y - q.y) === 1;
    });
    expect(vertical).toHaveLength(2);
    // same command object re-run is deterministic
    doc.undo();
    doc.redo();
    expect(count(doc.floor.walls)).toBe(8);
  });

  it('makes a recess when pushed inward and copies thickness / height', () => {
    const doc = mk(oneRoomFloor());
    const mid = splitTwice(doc);
    doc.execute(pushPullWall(mid.id, 1));
    expect(count(doc.floor.walls)).toBe(8);
    expect(area(doc)).toBeCloseTo(14, 6);
    const added = Object.values(doc.floor.walls).filter((w) => w.id !== 'w1' && w.a !== mid.a);
    for (const w of added) {
      expect(w.thickness).toBe(0.2);
      expect(w.height).toBe(3.2);
      expect(w.finishLeft).toBeUndefined();
    }
  });

  it('moves a free end without a connector', () => {
    const doc = mk({
      id: 'f1',
      level: 0,
      elevation: 0,
      wallHeight: 3.2,
      nodes: { p: { id: 'p', x: 0, y: 0 }, q: { id: 'q', x: 2, y: 0 } },
      walls: { w: { id: 'w', a: 'p', b: 'q', thickness: 0.2, height: 3.2 } },
      openings: {},
      rooms: {},
      items: {},
      columns: {},
    });
    doc.execute(pushPullWall('w', 0.5));
    expect(count(doc.floor.walls)).toBe(1);
    expect(doc.floor.nodes.p).toMatchObject({ x: 0, y: 0.5 });
    expect(doc.floor.nodes.q).toMatchObject({ x: 2, y: 0.5 });
  });

  it('does nothing below GEOM_TOL', () => {
    const doc = mk(oneRoomFloor());
    const before = structuredClone(doc.floor);
    doc.execute(pushPullWall('w1', 0.0005));
    expect(doc.floor).toEqual(before);
  });

  it('rejects connectors shorter than the minimum wall length', () => {
    const doc = mk(oneRoomFloor());
    const mid = splitTwice(doc);
    const before = structuredClone(doc.floor);
    expect(codeOf(() => doc.execute(pushPullWall(mid.id, -0.2)))).toBe('wall-too-short');
    expect(doc.floor).toEqual(before);
  });

  it('rejects a slide that would collapse the neighbour', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(pushPullWall('w1', 3.9)))).toBe('wall-too-short');
  });

  it('throws not-found for an unknown wall', () => {
    const doc = mk(oneRoomFloor());
    expect(codeOf(() => doc.execute(pushPullWall('nope', 1)))).toBe('not-found');
  });
});
