import type { Hinge, Id, Issue, Opening, Swing, Vec2 } from '../types';

/** What is being placed: an opening, with or without an id yet (a new one has none). */
export interface OpeningSubject {
  mount: 'opening';
  /** Hinge and swing are as on the start wall of a drag (`PlacementRequest.from`). */
  opening: Omit<Opening, 'id' | 'wall' | 'offset'> & { id?: Id };
}

export type PlacementSubject = OpeningSubject;

/** Where the pointer is and what is being placed. Lengths are in metres. */
export interface PlacementRequest {
  subject: PlacementSubject;
  point: Vec2;
  /** How far from a wall face the pointer may be to host on it. */
  reach: number;
  /** How far from a snap the centre may be to take it. */
  snapReach: number;
  /** Grid step for the centre offset; 0 for none. */
  grid: number;
  /** No snapping at all. */
  free: boolean;
  /** A drag: the wall it started on and the pointer minus the centre, along that wall. */
  from?: { wall: Id; grab: number };
  /** The host of the previous move, kept until another wall is clearly nearer. */
  current?: Id;
  /** The host when it is already known (a 3D ray hit). */
  wall?: Id;
}

/**
 * What a snap aligned with, drawn as a tick across the host wall (face to face) at that place
 * along it.
 */
export interface PlacementGuide {
  kind: 'end' | 'middle' | 'opening' | 'gap' | 'grid';
  from: Vec2;
  to: Vec2;
}

/** Where the subject goes, and why it may not be valid there (`issues`, empty when it is). */
export interface Placement {
  wall: Id;
  offset: number;
  hinge: Hinge;
  swing: Swing;
  guides: PlacementGuide[];
  issues: Issue[];
}
