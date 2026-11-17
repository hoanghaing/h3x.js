import type { Floor, FloorProps, Project } from '../types';

export const floorProps = (f: Floor): FloorProps => ({
  id: f.id,
  level: f.level,
  elevation: f.elevation,
  wallHeight: f.wallHeight,
  slabThickness: f.slabThickness,
});

/**
 * Levels and elevations of a floor stack, lowest floor first. The floor at
 * `groundIndex` keeps `groundElevation`; the others follow from heights:
 * above ground `elev(n) = elev(n-1) + wallHeight(n-1) + slab(n)`, below ground
 * `elev(n) = elev(n+1) - slab(n+1) - wallHeight(n)`.
 */
export function deriveStack(
  floors: FloorProps[],
  groundIndex: number,
  groundElevation: number,
): FloorProps[] {
  const out = floors.map((f, i) => ({ ...f, level: i - groundIndex }));
  if (out.length === 0) return out;
  out[groundIndex]!.elevation = groundElevation;
  for (let i = groundIndex + 1; i < out.length; i++) {
    out[i]!.elevation = out[i - 1]!.elevation + out[i - 1]!.wallHeight + out[i]!.slabThickness;
  }
  for (let i = groundIndex - 1; i >= 0; i--) {
    out[i]!.elevation = out[i + 1]!.elevation - out[i + 1]!.slabThickness - out[i]!.wallHeight;
  }
  return out;
}

/** Sort floors by level (file order breaks ties), pick the ground floor, renumber and recompute elevations. */
export function normalizeFloors(project: Project): void {
  const sorted = project.floors
    .map((f, i) => ({ f, i }))
    .sort((a, b) => a.f.level - b.f.level || a.i - b.i)
    .map((e) => e.f);
  const zeros = sorted.filter((f) => f.level === 0);
  let ground = zeros.length === 1 ? zeros[0]! : sorted.find((f) => f.level >= 0);
  ground ??= sorted[sorted.length - 1]!;
  const groundIndex = sorted.indexOf(ground);
  const derived = deriveStack(sorted.map(floorProps), groundIndex, ground.elevation);
  sorted.forEach((f, i) => {
    f.level = derived[i]!.level;
    f.elevation = derived[i]!.elevation;
  });
  project.floors = sorted;
}
