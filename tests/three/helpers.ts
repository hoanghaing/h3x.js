import { Vector3, type BufferGeometry } from 'three';

function groupRange(geom: BufferGeometry, groupIndex: number): { start: number; count: number } {
  const g = geom.groups.find((x) => x.materialIndex === groupIndex);
  if (!g) throw new Error(`no group ${groupIndex}`);
  return { start: g.start, count: g.count };
}

function vertexIndex(geom: BufferGeometry, i: number): number {
  return geom.index ? geom.index.getX(i) : i;
}

/** Total triangle area of the given material group. */
export function groupArea(geom: BufferGeometry, groupIndex: number): number {
  const pos = geom.getAttribute('position');
  const { start, count } = groupRange(geom, groupIndex);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let area = 0;
  for (let i = start; i < start + count; i += 3) {
    a.fromBufferAttribute(pos, vertexIndex(geom, i));
    b.fromBufferAttribute(pos, vertexIndex(geom, i + 1));
    c.fromBufferAttribute(pos, vertexIndex(geom, i + 2));
    area += new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
  }
  return area;
}

/** Vertex normals of the given material group. */
export function groupNormals(geom: BufferGeometry, groupIndex: number): Vector3[] {
  const nrm = geom.getAttribute('normal');
  const { start, count } = groupRange(geom, groupIndex);
  const out: Vector3[] = [];
  for (let i = start; i < start + count; i++) {
    out.push(new Vector3().fromBufferAttribute(nrm, vertexIndex(geom, i)));
  }
  return out;
}

/** Geometric (winding) normals of each triangle in the given material group. */
export function groupFaceNormals(geom: BufferGeometry, groupIndex: number): Vector3[] {
  const pos = geom.getAttribute('position');
  const { start, count } = groupRange(geom, groupIndex);
  const out: Vector3[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = start; i < start + count; i += 3) {
    a.fromBufferAttribute(pos, vertexIndex(geom, i));
    b.fromBufferAttribute(pos, vertexIndex(geom, i + 1));
    c.fromBufferAttribute(pos, vertexIndex(geom, i + 2));
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    if (n.lengthSq() > 1e-18) out.push(n.normalize());
  }
  return out;
}
