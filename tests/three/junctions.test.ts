import { DoubleSide, Mesh, Raycaster, Vector3, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { H3xDocument, type Floor, type Project, type Vec2 } from '../../src/core';
import { H3xScene } from '../../src/three';
import { computeJoins, computeWallCorners } from '../../src/three/walls/joins';
import { twoRoomFloor } from '../fixtures/floors';

function sceneOf(floor: Floor): H3xScene {
  const project = { name: 'p', floors: [floor] } as unknown as Project;
  return new H3xScene(H3xDocument.fromProject(project));
}

/** Twin of floorOf in joins.test.ts: walls of height 3. */
function floorOf(
  nodes: Record<string, [number, number]>,
  walls: [string, string, string, number][],
): Floor {
  return {
    id: 'f',
    level: 0,
    elevation: 0,
    wallHeight: 3,
    slabThickness: 0.15,
    nodes: Object.fromEntries(Object.entries(nodes).map(([id, [x, y]]) => [id, { id, x, y }])),
    walls: Object.fromEntries(
      walls.map(([id, a, b, thickness]) => [id, { id, a, b, thickness, height: 3 }]),
    ),
    openings: {},
    rooms: {},
    items: {},
    columns: {},
    stairs: {},
    roofs: {},
  };
}

function xFloor(): Floor {
  const f = twoRoomFloor();
  f.nodes.n7 = { id: 'n7', x: 4, y: -3 };
  f.walls.w8 = { id: 'w8', a: 'n2', b: 'n7', thickness: 0.2, height: 3.2 };
  return f;
}

/** Downward ray from y = 10 at plan (x, y); returns the hits. */
function hitsDown(root: Object3D, p: Vec2) {
  return new Raycaster(new Vector3(p.x, 10, -p.y), new Vector3(0, -1, 0)).intersectObject(
    root,
    true,
  );
}

const sortedPts = (pts: Vec2[]) =>
  pts.map((p) => [+p.x.toFixed(6), +p.y.toFixed(6)]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

describe('computeJoins', () => {
  it('keeps corners identical to computeWallCorners', () => {
    const f = twoRoomFloor();
    expect(computeJoins(f).corners).toEqual(computeWallCorners(f));
  });

  it('returns the T junction triangle', () => {
    const j = computeJoins(twoRoomFloor()).junctions.n2!;
    expect(j).toBeDefined();
    expect(j.height).toBe(3.2);
    expect(sortedPts(j.points)).toEqual([
      [3.9, 0.1],
      [4, -0.1],
      [4.1, 0.1],
    ]);
    expect(j.bevels).toEqual([]);
  });

  it('returns the X junction square', () => {
    const j = computeJoins(xFloor()).junctions.n2!;
    expect(sortedPts(j.points)).toEqual([
      [3.9, -0.1],
      [3.9, 0.1],
      [4.1, -0.1],
      [4.1, 0.1],
    ]);
  });

  it('has no junction at mitered corners, collinear continuations or free ends', () => {
    const f = floorOf({ a: [0, 0], b: [4, 0], c: [8, 0], d: [8, 4] }, [
      ['w1', 'a', 'b', 0.2],
      ['w2', 'b', 'c', 0.2],
      ['w3', 'c', 'd', 0.2],
    ]);
    expect(computeJoins(f).junctions).toEqual({});
  });

  it('bevels square fallbacks at an acute join', () => {
    const t = (20 * Math.PI) / 180;
    const f = floorOf({ o: [0, 0], p: [4, 0], q: [4 * Math.cos(t), 4 * Math.sin(t)] }, [
      ['a', 'o', 'p', 0.2],
      ['b', 'o', 'q', 0.2],
    ]);
    const j = computeJoins(f).junctions.o!;
    expect(j).toBeDefined();
    expect(j.bevels).toHaveLength(2);
    expect(j.points.length).toBe(4);
  });
});

describe('H3xScene junction caps', () => {
  it('covers the T junction top', () => {
    const scene = sceneOf(twoRoomFloor());
    const hits = hitsDown(scene.root, { x: 4, y: 0.05 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.y).toBeCloseTo(3.2, 6);
    expect(hits[0]!.object.userData).toEqual({ h3xKind: 'join', h3xId: 'n2', h3xFloorId: 'f1' });
  });

  it('covers the X junction top', () => {
    const scene = sceneOf(xFloor());
    const hits = hitsDown(scene.root, { x: 4, y: 0 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.y).toBeCloseTo(3.2, 6);
  });

  it('puts join meshes in an h3x-joins group with trim material', () => {
    const scene = sceneOf(twoRoomFloor());
    const group = scene.root.getObjectByName('h3x-joins')!;
    expect(group).toBeDefined();
    expect(group.children.map((c) => c.userData.h3xId).sort()).toEqual(['n2', 'n5']);
    const mesh = group.children[0] as Mesh;
    const trim = (scene.getWallMesh('w1')!.material as Material[])[2];
    expect(mesh.material).toBe(trim);
  });

  it('closes the outer slot of a 20 degree join', () => {
    const t = (20 * Math.PI) / 180;
    const scene = sceneOf(
      floorOf({ o: [0, 0], p: [4, 0], q: [4 * Math.cos(t), 4 * Math.sin(t)] }, [
        ['a', 'o', 'p', 0.2],
        ['b', 'o', 'q', 0.2],
      ]),
    );
    scene.root.traverse((o) => {
      if (o instanceof Mesh) {
        const mats = (Array.isArray(o.material) ? o.material : [o.material]) as Material[];
        for (const m of mats) m.side = DoubleSide;
      }
    });
    // From outside the wedge (plan -x) toward the node at wall mid-height.
    const hits = new Raycaster(new Vector3(-2, 1, 0), new Vector3(1, 0, 0)).intersectObject(
      scene.root,
      true,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.object.userData.h3xKind).toBe('join');
    expect(hits[0]!.point.x).toBeLessThanOrEqual(1e-9);
  });
});
