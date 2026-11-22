// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  H3xDocument,
  ROOF_PRESETS,
  addRoof,
  addWall,
  floorOutline,
  pushPullWall,
  removeNode,
  removeWall,
  roofFaceArea,
  roofGeometry,
  type Floor,
  type Id,
  type Project,
  type RoofPresetId,
  type Vec2,
} from '../../src/core';
import { signedArea } from '../../src/core/geometry/polygon';
import { holedRoomFloor, oneRoomFloor, testPresets, twoRoomFloor } from '../fixtures/floors';

function setup(floor: Floor, rooms: Id[], preset: RoofPresetId = 'hip') {
  const doc = H3xDocument.fromProject(
    {
      version: 1,
      unit: 'm',
      meta: { name: 't', created: '2026-01-01T00:00:00Z' },
      floors: [floor],
    } as Project,
    { presets: testPresets },
  );
  const cmd = addRoof({ rooms, preset });
  doc.execute(cmd);
  doc.endCoalesce();
  return { doc, id: cmd.createdId };
}

function bare(): Floor {
  const f = oneRoomFloor();
  f.openings = {};
  return f;
}

/** twoRoomFloor with the dividing wall at x: r1 is left of it, r2 right. */
function dividedAt(x: number): Floor {
  const f = twoRoomFloor();
  f.nodes.n2!.x = x;
  f.nodes.n5!.x = x;
  return f;
}

const wall = (a: Vec2, b: Vec2) => addWall({ from: { at: a }, to: { at: b }, thickness: 0.2 });
const partition = (x: number) => wall({ x, y: 0 }, { x, y: 4 });

function surface(doc: H3xDocument): number {
  return Object.values(doc.floor.roofs)
    .flatMap((r) => roofGeometry(r, doc.floor).bodies)
    .flatMap((b) => b.faces)
    .reduce((s, f) => s + roofFaceArea(f), 0);
}
const covered = (doc: H3xDocument, id: Id): number =>
  floorOutline(doc.floor, doc.floor.roofs[id]!.rooms).reduce((s, r) => s + signedArea(r.centre), 0);

describe('a follow roof when rooms split', () => {
  it.each(Object.keys(ROOF_PRESETS) as RoofPresetId[])('%s covers both parts', (preset) => {
    const { doc, id } = setup(bare(), ['r1'], preset);
    const before = surface(doc);
    doc.execute(partition(2.5));
    expect(doc.floor.roofs[id]!.follow).toBe(true);
    expect(doc.floor.roofs[id]!.rooms).toHaveLength(2);
    expect(covered(doc, id)).toBeCloseTo(16, 6);
    expect(surface(doc)).toBeCloseTo(before, 4);
  });

  it('survives several splits', () => {
    const { doc, id } = setup(bare(), ['r1']);
    doc.execute(partition(2.5));
    doc.execute(wall({ x: 0, y: 2 }, { x: 4, y: 2 }));
    expect(doc.floor.roofs[id]!.rooms).toHaveLength(4);
    expect(covered(doc, id)).toBeCloseTo(16, 6);
  });

  it('ignores the split of a room it does not cover', () => {
    const { doc, id } = setup(twoRoomFloor(), ['r1']);
    doc.execute(partition(6));
    expect(doc.floor.roofs[id]!.rooms).toEqual(['r1']);
  });

  it('ignores a room built next to it', () => {
    const { doc, id } = setup(bare(), ['r1']);
    doc.execute(wall({ x: 4, y: 0 }, { x: 8, y: 0 }));
    doc.execute(wall({ x: 8, y: 0 }, { x: 8, y: 4 }));
    doc.execute(wall({ x: 8, y: 4 }, { x: 4, y: 4 }));
    expect(doc.floor.roofs[id]!.rooms).toEqual(['r1']);
  });

  it('is one undo step and survives XML', () => {
    const { doc, id } = setup(bare(), ['r1']);
    const before = structuredClone(doc.floor);
    doc.execute(partition(2.5));
    const after = structuredClone(doc.floor);
    expect(H3xDocument.fromXML(doc.toXML()).floor.roofs[id]!.rooms).toHaveLength(2);
    doc.undo();
    expect(doc.floor).toEqual(before);
    doc.redo();
    expect(doc.floor).toEqual(after);
  });

  it.each([
    ['small', 1, 3],
    ['bigger than the ring around it', 0.5, 3.5],
  ])('a closed block (%s) drawn inside makes no second body', (_, lo, hi) => {
    const { doc, id } = setup(bare(), ['r1']);
    const pts = [
      { x: lo, y: lo },
      { x: hi, y: lo },
      { x: hi, y: hi },
      { x: lo, y: hi },
    ];
    pts.forEach((p, i) => doc.execute(wall(p, pts[(i + 1) % 4]!)));
    expect(roofGeometry(doc.floor.roofs[id]!, doc.floor).bodies).toHaveLength(1);
    expect(covered(doc, id)).toBeCloseTo(16, 6);
  });
});

describe('a follow roof when rooms merge', () => {
  it.each([
    ['smaller', 3, 12],
    ['bigger', 5, 20],
  ])('over the %s room keeps its shape as an independent roof', (_, x, area) => {
    const { doc, id } = setup(dividedAt(x), ['r1']);
    expect(covered(doc, id)).toBeCloseTo(area);
    const outline = floorOutline(doc.floor, ['r1'])[0]!.points;
    const before = surface(doc);
    doc.execute(removeWall('w7'));
    const r = doc.floor.roofs[id]!;
    expect(r.follow).toBe(false);
    expect(r.rooms).toBeUndefined();
    expect(r.points).toEqual(outline);
    expect(surface(doc)).toBeCloseTo(before, 6);
  });

  it('keeps gable edges when it detaches', () => {
    const { doc, id } = setup(dividedAt(3), ['r1'], 'gable');
    const before = surface(doc);
    doc.execute(removeWall('w7'));
    expect(doc.floor.roofs[id]!.edges!.some((e) => e.kind === 'gable')).toBe(true);
    expect(surface(doc)).toBeCloseTo(before, 6);
  });

  it('over both rooms keeps following', () => {
    const { doc, id } = setup(dividedAt(3), ['r1', 'r2']);
    doc.execute(removeWall('w7'));
    expect(doc.floor.roofs[id]!.follow).toBe(true);
    expect(doc.floor.roofs[id]!.rooms).toEqual(['r2']);
    expect(covered(doc, id)).toBeCloseTo(32);
  });

  it.each([
    ['removeWall', () => removeWall('w3')],
    ['removeNode', () => removeNode('n5')],
  ])('%s that opens or drops the roofed room keeps the shape', (_, cmd) => {
    const { doc } = setup(twoRoomFloor(), ['r2']);
    const before = surface(doc);
    doc.execute(cmd());
    expect(surface(doc)).toBeCloseTo(before, 6);
  });

  it('detaches a roof of several bodies into several roofs, one undo step', () => {
    const f = twoRoomFloor();
    Object.assign(f.nodes, {
      p1: { id: 'p1', x: 12, y: 0 },
      p2: { id: 'p2', x: 15, y: 0 },
      p3: { id: 'p3', x: 15, y: 3 },
      p4: { id: 'p4', x: 12, y: 3 },
    });
    for (let i = 1; i <= 4; i++) {
      f.walls[`q${i}`] = { ...f.walls.w1!, id: `q${i}`, a: `p${i}`, b: `p${(i % 4) + 1}` };
    }
    f.rooms.r3 = { id: 'r3', name: '', walls: ['q1', 'q2', 'q3', 'q4'] };
    const { doc } = setup(f, ['r1', 'r3']);
    const before = structuredClone(doc.floor);
    const was = surface(doc);
    const cmd = removeWall('w7');
    doc.execute(cmd);
    const ids = Object.keys(doc.floor.roofs).sort();
    expect(ids).toHaveLength(2);
    expect(surface(doc)).toBeCloseTo(was, 6);
    doc.undo();
    expect(doc.floor).toEqual(before);
    doc.execute(cmd);
    expect(Object.keys(doc.floor.roofs).sort()).toEqual(ids); // re-running a command keeps its ids
  });

  it('removing a block inside the roofed room keeps following', () => {
    const f = holedRoomFloor();
    f.rooms.island = { id: 'island', name: '', walls: ['hw3', 'hw2', 'hw1', 'hw0'] };
    const { doc, id } = setup(f, ['r1']);
    doc.execute(removeWall('hw0'));
    expect(doc.floor.roofs[id]!.follow).toBe(true);
  });
});

it('a push / pull still makes the roof follow its walls', () => {
  const { doc, id } = setup(twoRoomFloor(), ['r2']);
  doc.execute(pushPullWall('w3', -1)); // outward
  expect(doc.floor.roofs[id]).toMatchObject({ follow: true, rooms: ['r2'] });
  expect(covered(doc, id)).toBeCloseTo(20, 6);
});
