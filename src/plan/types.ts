import type { Id, Issue } from '../core';

export type PlanKind =
  'node' | 'wall' | 'room' | 'opening' | 'item' | 'column' | 'stair' | 'roof' | 'site';

export interface Selection {
  kind: PlanKind;
  id: Id;
}

/** A point in viewport pixels (origin top-left, +y down). */
export interface ScreenPoint {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlanIssues {
  rejected: Issue[];
  standing: Issue[];
}
