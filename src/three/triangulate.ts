import { ShapeUtils, Vector2, Vector3 } from 'three';

/** Shared triangle accumulator that forces winding to agree with a wanted normal. */
export class TriangleSink {
  readonly positions: number[] = [];
  readonly normals: number[] = [];

  /** Emits a triangle wound so its geometric normal agrees with `want`. */
  tri(a: Vector3, b: Vector3, c: Vector3, want: Vector3): void {
    const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const [p, q] = n.dot(want) < 0 ? [c, b] : [b, c];
    for (const v of [a, p, q]) {
      this.positions.push(v.x, v.y, v.z);
      this.normals.push(want.x, want.y, want.z);
    }
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, want: Vector3): void {
    this.tri(a, b, c, want);
    this.tri(a, c, d, want);
  }

  get vertexCount(): number {
    return this.positions.length / 3;
  }
}

/** Triangulates a planar 2D contour (with holes) and emits it through `toW` into `sink`. */
export function triangulateInto(
  sink: TriangleSink,
  contour: Vector2[],
  holes: Vector2[][],
  toW: (p: Vector2) => Vector3,
  want: Vector3,
): void {
  // triangulateShape drops a closing duplicate point in place; work on copies and
  // map to world afterwards so the triangle indices match the cleaned rings.
  const c = [...contour];
  const hs = holes.map((h) => [...h]);
  const tris = ShapeUtils.triangulateShape(c, hs);
  const world = [c, ...hs].flat().map(toW);
  for (const [i = -1, j = -1, k = -1] of tris) {
    const a = world[i];
    const b = world[j];
    const c = world[k];
    if (a && b && c) sink.tri(a, b, c, want);
  }
}
