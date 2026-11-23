import { signedArea } from './geometry/polygon';
import { roofFaceArea, roofGeometry } from './roofs/geometry';
import { roomArea } from './rooms/detect';
import { openingSpan, wallOutlines } from './shapes';
import type { Floor, Id, Opening, OpeningType, Project } from './types';
import { wallLength } from './validate/layout';

/** One wall: centre-line length, one face's area and the solid it fills. */
export interface WallQuantity {
  id: Id;
  /** Node to node (m). */
  length: number;
  thickness: number;
  height: number;
  /** length × height (m²), one face. */
  grossArea: number;
  /** The part of its openings inside the wall (m²). */
  openingArea: number;
  /** grossArea − openingArea. */
  netArea: number;
  /** Joined outline × height, less the openings (m³): corners are counted once. */
  volume: number;
}

export interface RoomQuantity {
  id: Id;
  name: string;
  /** Floor between the walls (m²), holes excluded. */
  area: number;
}

/** Openings of one type, preset and size. */
export interface OpeningQuantity {
  type: OpeningType;
  preset: string;
  width: number;
  height: number;
  count: number;
  /** count × width × height (m²). */
  area: number;
}

export interface RoofQuantity {
  id: Id;
  /** True (sloped) area of every roof face, overhangs included; vertical gable ends excluded (m²). */
  area: number;
}

export interface QuantityTotals {
  wallLength: number;
  wallNetArea: number;
  wallVolume: number;
  floorArea: number;
  openingCount: number;
  openingArea: number;
  roofArea: number;
}

export interface FloorQuantities {
  floorId: Id;
  walls: WallQuantity[];
  rooms: RoomQuantity[];
  openings: OpeningQuantity[];
  roofs: RoofQuantity[];
  totals: QuantityTotals;
}

export interface ProjectQuantities {
  floors: FloorQuantities[];
  totals: QuantityTotals;
}

/** The part of `o` inside its wall (m²): its span clipped to the wall, its height to the wall's. */
function openingAreaIn(o: Opening, length: number, height: number): number {
  const { lo, hi } = openingSpan(o);
  const along = Math.min(hi, length) - Math.max(lo, 0);
  const up = Math.min(o.sill + o.height, height) - Math.max(o.sill, 0);
  return along > 0 && up > 0 ? along * up : 0;
}

const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);

/** Lengths, areas, volumes and counts of one floor, for estimates. */
export function floorQuantities(floor: Readonly<Floor>): FloorQuantities {
  const f = floor as Floor;
  const outlines = wallOutlines(f);
  const byWall = new Map<Id, Opening[]>();
  for (const o of Object.values(f.openings)) {
    const list = byWall.get(o.wall);
    if (list) list.push(o);
    else byWall.set(o.wall, [o]);
  }

  const walls: WallQuantity[] = [];
  for (const w of Object.values(f.walls)) {
    if (!f.nodes[w.a] || !f.nodes[w.b]) continue;
    const length = wallLength(f, w.id);
    const grossArea = length * w.height;
    const openingArea = sum(
      (byWall.get(w.id) ?? []).map((o) => openingAreaIn(o, length, w.height)),
    );
    const outline = outlines[w.id];
    const footprint = outline ? Math.abs(signedArea(outline)) : length * w.thickness;
    walls.push({
      id: w.id,
      length,
      thickness: w.thickness,
      height: w.height,
      grossArea,
      openingArea,
      netArea: grossArea - openingArea,
      volume: Math.max(0, footprint * w.height - openingArea * w.thickness),
    });
  }

  const rooms: RoomQuantity[] = Object.values(f.rooms).map((r) => ({
    id: r.id,
    name: r.name,
    area: Math.abs(roomArea(f, r, 'inner')),
  }));

  const groups = new Map<string, OpeningQuantity>();
  for (const o of Object.values(f.openings)) {
    const key = [o.type, o.preset, o.width, o.height].join('|');
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.area = g.count * o.width * o.height;
    } else {
      groups.set(key, {
        type: o.type,
        preset: o.preset,
        width: o.width,
        height: o.height,
        count: 1,
        area: o.width * o.height,
      });
    }
  }
  const openings = [...groups.values()].sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.preset.localeCompare(b.preset) ||
      a.width - b.width ||
      a.height - b.height,
  );

  const roofs: RoofQuantity[] = Object.values(f.roofs).map((roof) => {
    const g = roofGeometry(roof, f);
    // Gable ends are vertical: no plan area. Flat slabs and slopes both cover the plan.
    const faces = g.bodies
      .flatMap((b) => b.faces)
      .filter((face) => Math.abs(signedArea(face.polygon.map(({ x, y }) => ({ x, y })))) > 1e-9);
    return { id: roof.id, area: sum(faces.map(roofFaceArea)) };
  });

  return {
    floorId: f.id,
    walls,
    rooms,
    openings,
    roofs,
    totals: {
      wallLength: sum(walls.map((w) => w.length)),
      wallNetArea: sum(walls.map((w) => w.netArea)),
      wallVolume: sum(walls.map((w) => w.volume)),
      floorArea: sum(rooms.map((r) => r.area)),
      openingCount: sum(openings.map((o) => o.count)),
      openingArea: sum(openings.map((o) => o.area)),
      roofArea: sum(roofs.map((r) => r.area)),
    },
  };
}

/** `floorQuantities` of every floor, in project order, and their sums. */
export function projectQuantities(project: Readonly<Project>): ProjectQuantities {
  const floors = project.floors.map((f) => floorQuantities(f));
  const keys = [
    'wallLength',
    'wallNetArea',
    'wallVolume',
    'floorArea',
    'openingCount',
    'openingArea',
    'roofArea',
  ] as const satisfies readonly (keyof QuantityTotals)[];
  const totals = Object.fromEntries(
    keys.map((k) => [k, sum(floors.map((f) => f.totals[k]))]),
  ) as unknown as QuantityTotals;
  return { floors, totals };
}
