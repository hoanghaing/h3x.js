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
}
export interface Opening {
  id: Id;
  wall: Id;
  preset: string;
  offset: number;
  width: number;
  height: number;
  sill: number;
  flip: boolean;
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
}
export type PresetResolver = (presetId: string) => PresetInfo | undefined;
export type EntityKind =
  'node' | 'wall' | 'opening' | 'room' | 'item' | 'column' | 'stair' | 'site' | 'floor';
export interface Issue {
  code: string;
  ids: Id[];
  message: string;
}
