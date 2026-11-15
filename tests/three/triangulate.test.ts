import { Vector2, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TriangleSink, triangulateInto } from '../../src/three/triangulate';

function area(sink: TriangleSink): number {
  const p = sink.positions;
  let s = 0;
  for (let i = 0; i < p.length; i += 9) {
    const a = new Vector3(p[i], p[i + 1], p[i + 2]);
    const b = new Vector3(p[i + 3], p[i + 4], p[i + 5]);
    const c = new Vector3(p[i + 6], p[i + 7], p[i + 8]);
    s += new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).length() / 2;
  }
  return s;
}

const v = (x: number, y: number) => new Vector2(x, y);
const toW = (p: Vector2) => new Vector3(p.x, 0, -p.y);
const up = new Vector3(0, 1, 0);

describe('triangulateInto', () => {
  it('handles a closed contour (last == first) with a hole', () => {
    const sink = new TriangleSink();
    const contour = [v(0, 0), v(4, 0), v(4, 4), v(0, 4), v(0, 0)];
    const hole = [v(1, 1), v(1, 2), v(2, 2), v(2, 1)];
    triangulateInto(sink, contour, [hole], toW, up);
    expect(area(sink)).toBeCloseTo(15, 9);
  });

  it('does not mutate its inputs', () => {
    const contour = [v(0, 0), v(4, 0), v(4, 4), v(0, 4), v(0, 0)];
    const hole = [v(1, 1), v(1, 2), v(2, 2), v(2, 1), v(1, 1)];
    triangulateInto(new TriangleSink(), contour, [hole], toW, up);
    expect(contour).toHaveLength(5);
    expect(hole).toHaveLength(5);
  });
});
