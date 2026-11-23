import { floorOutline } from './floors/outline';
import { uncoveredArea } from './geometry/clip';
import { pointInPolygon, signedArea } from './geometry/polygon';
import { roofFaceArea, roofGeometry } from './roofs/geometry';
import { roomArea, roomShape } from './rooms/detect';
import { openingSpan, wallOutline } from './shapes';
import { stairOutline } from './stairs/layout';
import type { Floor, Id, Opening, OpeningType, Project, Vec2 } from './types';
import { wallLength } from './validate/layout';
import { stairRise } from './validate/stairs';
import { computeJoins } from './walls/joins';

/** One face of a wall, for paint and plaster. */
export interface WallFace {
  /** 'interior' when the face looks into a room. */
  side: 'interior' | 'exterior';
  /** Along the joined outline (m): an inner corner face is shorter than the outer one. */
  length: number;
  /** length × height (m²). */
  grossArea: number;
  /** The part of the wall's openings inside the wall (m²). */
  openingArea: number;
  /** grossArea − openingArea, never below 0. */
  netArea: number;
}

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
  /** The faces left and right of the wall going from node a to node b. */
  faces: { left: WallFace; right: WallFace };
}

export interface RoomQuantity {
  id: Id;
  name: string;
  /** Floor between the walls (m²), holes excluded. */
  area: number;
  /** Length of the outlines between the walls, holes included (m): skirting before doors. */
  perimeter: number;
}

/** The floor slab: the rooms grown to the outer wall faces, as the 3D view draws it. */
export interface SlabQuantity {
  /** Plan area (m²), courtyards and stair holes excluded. */
  area: number;
  /** The part of the stair holes (stairs of the floor below) inside the slab (m²). */
  holeArea: number;
  /** area × slabThickness (m³). */
  volume: number;
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
  slabArea: number;
  slabVolume: number;
  /** Net area of every interior wall face (m²). */
  paintInterior: number;
  /** Net area of every exterior wall face (m²). */
  paintExterior: number;
}

export interface FloorQuantities {
  floorId: Id;
  walls: WallQuantity[];
  rooms: RoomQuantity[];
  openings: OpeningQuantity[];
  roofs: RoofQuantity[];
  slab: SlabQuantity;
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

/** How far past a wall face (m) the room test looks. */
const FACE_PROBE = 0.01;

const sum = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const dist = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);
const ringLength = (r: readonly Vec2[]): number =>
  sum(r.map((p, i) => dist(p, r[(i + 1) % r.length]!)));

/** Room centre shapes, to tell which side of a wall a room lies on. */
function roomTest(f: Floor): (p: Vec2) => boolean {
  const shapes = Object.values(f.rooms).map((r) => roomShape(f, r, 'center'));
  return (p) =>
    shapes.some((s) => pointInPolygon(p, s.outer) && !s.holes.some((h) => pointInPolygon(p, h)));
}

/** The slab of `f`, less the outlines of the stairs of `below`. */
function slabQuantity(f: Floor, below: Floor | undefined): SlabQuantity {
  const rings = floorOutline(f);
  const holes = rings.filter((r) => r.hole).map((r) => r.points);
  const cuts = below
    ? Object.values(below.stairs).map((s) => stairOutline(s, stairRise(below, f)))
    : [];
  let full = 0;
  let area = 0;
  for (const outer of rings.filter((r) => !r.hole).map((r) => r.points)) {
    const own = holes.filter((h) => h[0] && pointInPolygon(h[0], outer));
    const whole = uncoveredArea(outer, own);
    full += whole;
    area += cuts.length > 0 ? uncoveredArea(outer, [...own, ...cuts]) : whole;
  }
  return { area, holeArea: Math.max(0, full - area), volume: area * f.slabThickness };
}

/**
 * Lengths, areas, volumes and counts of one floor, for estimates. Pass the floor `below` to cut
 * its stairs out of this floor's slab.
 */
export function floorQuantities(floor: Readonly<Floor>, below?: Readonly<Floor>): FloorQuantities {
  const f = floor as Floor;
  const { corners } = computeJoins(f);
  const inRoom = roomTest(f);
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
    const c = corners[w.id];
    const footprint = c ? Math.abs(signedArea(wallOutline(c))) : length * w.thickness;
    const a = f.nodes[w.a]!;
    const b = f.nodes[w.b]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // Unit left normal of a -> b; a probe just past each face tells which side a room is on.
    const n = length > 0 ? { x: -(b.y - a.y) / length, y: (b.x - a.x) / length } : { x: 0, y: 0 };
    const reach = w.thickness / 2 + FACE_PROBE;
    const face = (sign: 1 | -1, faceLength: number): WallFace => {
      const gross = faceLength * w.height;
      const probe = { x: mid.x + sign * n.x * reach, y: mid.y + sign * n.y * reach };
      return {
        side: length > 0 && inRoom(probe) ? 'interior' : 'exterior',
        length: faceLength,
        grossArea: gross,
        openingArea,
        netArea: Math.max(0, gross - openingArea),
      };
    };
    walls.push({
      id: w.id,
      length,
      thickness: w.thickness,
      height: w.height,
      grossArea,
      openingArea,
      netArea: grossArea - openingArea,
      volume: Math.max(0, footprint * w.height - openingArea * w.thickness),
      faces: {
        left: face(1, c ? dist(c.startLeft, c.endLeft) : length),
        right: face(-1, c ? dist(c.startRight, c.endRight) : length),
      },
    });
  }

  const rooms: RoomQuantity[] = Object.values(f.rooms).map((r) => {
    const { outer, holes } = roomShape(f, r, 'inner');
    return {
      id: r.id,
      name: r.name,
      area: Math.abs(roomArea(f, r, 'inner')),
      perimeter: ringLength(outer) + sum(holes.map(ringLength)),
    };
  });
  const slab = slabQuantity(f, below as Floor | undefined);
  const faces = walls.flatMap((w) => [w.faces.left, w.faces.right]);
  const paint = (side: WallFace['side']): number =>
    sum(faces.filter((x) => x.side === side).map((x) => x.netArea));

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
    slab,
    totals: {
      wallLength: sum(walls.map((w) => w.length)),
      wallNetArea: sum(walls.map((w) => w.netArea)),
      wallVolume: sum(walls.map((w) => w.volume)),
      floorArea: sum(rooms.map((r) => r.area)),
      openingCount: sum(openings.map((o) => o.count)),
      openingArea: sum(openings.map((o) => o.area)),
      roofArea: sum(roofs.map((r) => r.area)),
      slabArea: slab.area,
      slabVolume: slab.volume,
      paintInterior: paint('interior'),
      paintExterior: paint('exterior'),
    },
  };
}

/** `floorQuantities` of every floor, in project order, and their sums. */
export function projectQuantities(project: Readonly<Project>): ProjectQuantities {
  const floors = project.floors.map((f, i) => floorQuantities(f, project.floors[i - 1]));
  const keys = [
    'wallLength',
    'wallNetArea',
    'wallVolume',
    'floorArea',
    'openingCount',
    'openingArea',
    'roofArea',
    'slabArea',
    'slabVolume',
    'paintInterior',
    'paintExterior',
  ] as const satisfies readonly (keyof QuantityTotals)[];
  const totals = Object.fromEntries(
    keys.map((k) => [k, sum(floors.map((f) => f.totals[k]))]),
  ) as unknown as QuantityTotals;
  return { floors, totals };
}
