export type Id = string;
export interface Vec2 {
  x: number;
  y: number;
}
export interface PlanNode {
  id: Id;
  x: number;
  y: number;
}
export interface Wall {
  id: Id;
  a: Id;
  b: Id;
  thickness: number;
  height: number;
  finishLeft?: string;
  finishRight?: string;
  /** Locked: every edit but unlocking is rejected (`setLocked`). */
  locked?: boolean;
}
export type OpeningType =
  | 'door-swing'
  | 'door-double'
  | 'door-sliding'
  | 'door-folding'
  | 'door-rolling'
  | 'opening'
  | 'window-casement'
  | 'window-sliding'
  | 'window-awning'
  | 'window-fixed';
/** The wall end (`a` or `b`) nearer the hinge. */
export type Hinge = 'a' | 'b';
/** The side of the wall `a -> b` an opening opens to. */
export type Swing = 'left' | 'right';
/** An opening parameter that applies to some types only. */
export type OpeningParam = 'hinge' | 'swing' | 'leaves' | 'split';
export interface Opening {
  id: Id;
  wall: Id;
  preset: string;
  offset: number;
  width: number;
  height: number;
  sill: number;
  type: OpeningType;
  hinge: Hinge;
  swing: Swing;
  /** Leaf count; the type's default when absent. */
  leaves?: number;
  /** Share of the larger leaf of a double door, 0.5 <= split < 1. */
  split?: number;
  /** Locked: every edit but unlocking is rejected (`setLocked`). */
  locked?: boolean;
}
export interface Room {
  id: Id;
  walls: Id[];
  name: string;
  floorFinish?: string;
  /** Closed wall loops inside the room (atriums, free-standing blocks); each stored clockwise. */
  holes?: Id[][];
}
export interface Footprint {
  w: number;
  d: number;
  h: number;
}
export type Mount = 'floor' | 'wall' | 'ceiling' | 'opening';
interface ItemBase {
  id: Id;
  preset: string;
  variant?: string;
  /** Locked: every edit but unlocking is rejected (`setLocked`). */
  locked?: boolean;
}
export interface FloorItem extends ItemBase {
  mount: 'floor';
  x: number;
  y: number;
  rotation: number;
}
export interface WallItem extends ItemBase {
  mount: 'wall';
  wall: Id;
  side: 'left' | 'right';
  offset: number;
  elevation: number;
}
export interface CeilingItem extends ItemBase {
  mount: 'ceiling';
  x: number;
  y: number;
  rotation: number;
}
export type Item = FloorItem | WallItem | CeilingItem;
export interface Column {
  id: Id;
  x: number;
  y: number;
  shape: 'round' | 'square';
  /** Diameter for round; side along local x for square. */
  width: number;
  /** Square only; defaults to width. */
  depth?: number;
  /** Radians CCW; square only. */
  rotation: number;
  /** Defaults to the floor wallHeight. */
  height?: number;
  /** Locked: every edit but unlocking is rejected (`setLocked`). */
  locked?: boolean;
}
export type StairType = 'straight' | 'L' | 'U' | 'spiral';
export interface Stair {
  id: Id;
  /** Centre of the footprint rectangle. */
  x: number;
  y: number;
  /** Footprint size along local x / y. */
  width: number;
  depth: number;
  /** Radians CCW. */
  rotation: number;
  type: StairType;
  /** Turn style for L and U stairs. */
  turn: 'landing' | 'winder';
  /** Turn direction for L / U, rotation sense for spiral. */
  hand: 'left' | 'right';
  /** Width of each flight; ignored for spiral. */
  flightWidth: number;
  /** Locked: every edit but unlocking is rejected (`setLocked`). */
  locked?: boolean;
}
export type RoofMaterial = 'tile' | 'metal' | 'concrete' | 'glass' | 'polycarbonate';
export type RoofEdge =
  | {
      kind: 'slope';
      /** Degrees, 0 < pitch < 90. */
      pitch: number;
      /** Metres above the eaves where the slope changes to `upperPitch` (broken roof). */
      breakHeight?: number;
      upperPitch?: number;
    }
  | { kind: 'gable' };
export interface Roof {
  id: Id;
  /** 'pitched' uses edges; 'flat' is a horizontal slab with an optional parapet. */
  kind: 'pitched' | 'flat';
  /** Informational: the preset the roof was created from. */
  preset?: string;
  /** true = the outline follows the walls of `rooms`. */
  follow: boolean;
  /** Independent mode: CCW outline at wall-top level (outer wall faces); holes CW. */
  points?: Vec2[];
  holes?: Vec2[][];
  /** Independent mode: one spec per outline edge (edge i = points[i] to points[i + 1]). */
  edges?: RoofEdge[];
  /** Independent mode: specs per hole edge; missing = slope at `pitch`. */
  holeEdges?: RoofEdge[][];
  /** Follow mode: the rooms whose union is the outline. */
  rooms?: Id[];
  /** Follow mode: overrides keyed by wall id; other edges use `pitch`. */
  wallEdges?: Record<Id, RoofEdge>;
  /** Default slope, degrees. */
  pitch: number;
  /** Default break for every slope edge (mansard). */
  breakHeight?: number;
  upperPitch?: number;
  /** Metres above floor elevation + wall height. */
  base: number;
  /** Eaves overhang, metres horizontal from the outline. */
  overhang: number;
  /** Rake overhang at gable edges, metres. */
  gableOverhang: number;
  thickness: number;
  material: RoofMaterial;
  /** Flat only: parapet height, metres. */
  parapet?: number;
  /** Automatic steel posts. */
  supports?: 'posts';
  /** Locked: every edit but unlocking is rejected (`setLocked`). */
  locked?: boolean;
  postSize?: number;
  postSpacing?: number;
}
export interface Site {
  id: 'site';
  /** Counter-clockwise ground outline. */
  points: Vec2[];
}
export interface Floor {
  id: Id;
  level: number;
  elevation: number;
  wallHeight: number;
  /** Slab thickness in meters; the slab occupies [elevation - slabThickness, elevation]. */
  slabThickness: number;
  nodes: Record<Id, PlanNode>;
  walls: Record<Id, Wall>;
  openings: Record<Id, Opening>;
  rooms: Record<Id, Room>;
  items: Record<Id, Item>;
  columns: Record<Id, Column>;
  stairs: Record<Id, Stair>;
  roofs: Record<Id, Roof>;
}
export type FloorProps = Pick<Floor, 'id' | 'level' | 'elevation' | 'wallHeight' | 'slabThickness'>;
export interface ProjectMeta {
  name: string;
  created: string; // ISO 8601
}
export interface Project {
  version: number;
  unit: 'm';
  meta: ProjectMeta;
  floors: Floor[];
  site?: Site;
}
export interface PresetInfo {
  mount: Mount;
  footprint: Footprint;
  layer?: 'covering';
  sill?: number;
  /** Initial type and parameters of an opening preset. */
  opening?: Partial<Pick<Opening, 'type' | OpeningParam>>;
}
export type PresetResolver = (presetId: string) => PresetInfo | undefined;
export type EntityKind =
  'node' | 'wall' | 'opening' | 'room' | 'item' | 'column' | 'stair' | 'roof' | 'site' | 'floor';
export interface Issue {
  code: string;
  ids: Id[];
  message: string;
}
