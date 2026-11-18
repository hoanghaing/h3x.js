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

describe('junction fill with mixed wall heights', () => {
  /** T junction at the origin: through wall along x with `through` height, stem down -y with `stem` height. */
  function tFloor(through: number, stem: number): Floor {
    const f = floorOf({ a: [-4, 0], n: [0, 0], b: [4, 0], s: [0, -4] }, [
      ['w1', 'a', 'n', 0.2],
      ['w2', 'n', 'b', 0.2],
      ['w3', 'n', 's', 0.2],
    ]);
    f.walls.w1!.height = through;
    f.walls.w2!.height = through;
    f.walls.w3!.height = stem;
    return f;
  }

  function joinVertices(floor: Floor): { x: number; y: number; z: number }[] {
    const scene = sceneOf(floor);
    const out: { x: number; y: number; z: number }[] = [];
    scene.root.getObjectByName('h3x-joins')!.traverse((o) => {
      const pos = (o as Mesh).geometry?.getAttribute('position');
      if (!pos) return;
      for (let i = 0; i < pos.count; i++)
        out.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) });
    });
    return out;
  }

  it('keeps a low parapet junction from rising to a taller butting wall', () => {
    const verts = joinVertices(tFloor(1.1, 3));
    expect(verts.length).toBeGreaterThan(0);
    // The 3 m stem outline in plan: x in [-0.1, 0.1], y <= -0.1. Nothing above 1.1 may lie outside it.
    for (const v of verts) {
      if (v.y <= 1.1 + 1e-6) continue;
      const planY = -v.z;
      expect(Math.abs(v.x) <= 0.1 + 1e-6 && planY <= -0.1 + 1e-6).toBe(true);
    }
  });

  it('caps the junction at the tall through wall height', () => {
    const hits = hitsDown(sceneOf(tFloor(3, 1.1)).root, { x: 0, y: 0.05 });
    expect(hits[0]!.point.y).toBeCloseTo(3, 6);
  });

  it('caps the junction at the low through wall height', () => {
    const hits = hitsDown(sceneOf(tFloor(1.1, 3)).root, { x: 0, y: 0.05 });
    expect(hits[0]!.point.y).toBeCloseTo(1.1, 6);
  });
});

describe('closing height steps between walls and junction fill', () => {
  /** Horizontal ray at height y from plan `from` along plan direction `dir`. */
  function hitsAlong(root: Object3D, from: Vec2, dir: Vec2, y: number) {
    return new Raycaster(
      new Vector3(from.x, y, -from.y),
      new Vector3(dir.x, 0, -dir.y).normalize(),
    ).intersectObject(root, true);
  }

  function tFloor(through: number, stem: number): Floor {
    const f = floorOf({ a: [-4, 0], n: [0, 0], b: [4, 0], s: [0, -4] }, [
      ['w1', 'a', 'n', 0.2],
      ['w2', 'n', 'b', 0.2],
      ['w3', 'n', 's', 0.2],
    ]);
    f.walls.w1!.height = through;
    f.walls.w2!.height = through;
    f.walls.w3!.height = stem;
    return f;
  }

  it('closes the end of a tall stem above a low through wall', () => {
    const scene = sceneOf(tFloor(1.1, 3));
    const hits = hitsAlong(scene.root, { x: 0, y: 1 }, { x: 0, y: -1 }, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.y).toBeCloseTo(2, 6);
    // Below the parapet top the through wall itself blocks the ray.
    expect(hitsAlong(scene.root, { x: 0, y: 1 }, { x: 0, y: -1 }, 0.5)[0]!.point.z).toBeCloseTo(
      -0.1,
      6,
    );
  });

  it('closes the side of a high through junction above a low stem', () => {
    const scene = sceneOf(tFloor(3, 1.1));
    const hits = hitsAlong(scene.root, { x: 0, y: -3 }, { x: 0, y: 1 }, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.z).toBeCloseTo(0.1, 6);
  });

  it('closes the mitre end of a tall wall meeting a low wall in an L corner', () => {
    const f = floorOf({ a: [-4, 0], n: [0, 0], c: [0, 4] }, [
      ['w1', 'a', 'n', 0.2],
      ['w2', 'n', 'c', 0.2],
    ]);
    f.walls.w2!.height = 1.1;
    const scene = sceneOf(f);
    const hits = hitsAlong(scene.root, { x: 0, y: 2 }, { x: 0, y: -1 }, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.y).toBeCloseTo(2, 6);
    expect(hits[0]!.point.z).toBeCloseTo(0, 6);
  });

  it('closes the seam between fan pieces of different heights', () => {
    const f = floorOf({ n: [0, 0], e: [4, 0], w: [-4, 0], t: [0, 4], s: [0, -4] }, [
      ['w1', 'n', 'e', 0.2],
      ['w2', 'n', 'w', 0.2],
      ['w3', 'n', 't', 0.2],
      ['w4', 'n', 's', 0.2],
    ]);
    f.walls.w3!.height = 1.1;
    f.walls.w4!.height = 1.1;
    const scene = sceneOf(f);
    const hits = hitsAlong(scene.root, { x: 0.05, y: 1 }, { x: 0, y: -1 }, 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.point.z).toBeCloseTo(-0.05, 6);
  });
});
