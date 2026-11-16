import type { H3xDocument, Id, Vec2 } from '../../core';
import type { H3xPlan } from '../H3xPlan';
import type { HitTarget } from '../hit';
import type { DrawSnapResult, SnapResult } from '../snap';
import type { ScreenPoint } from '../types';

export interface PlanPointerEvent {
  native: PointerEvent | MouseEvent;
  screen: ScreenPoint;
  plan: Vec2;
  hit: HitTarget;
}

export interface ToolContext {
  plan: H3xPlan;
  doc: H3xDocument;
  hit(s: ScreenPoint): HitTarget;
  /** Snaps with the plan's snap options; alignment reaches 8 screen px. `disabled` returns `p` as is. */
  snap(p: Vec2, exclude: Id[], disabled: boolean): SnapResult;
  /**
   * Drawing snap (node > wall > alignment > 45-degree lock from `from` > grid); reach is 8 screen px.
   * `extra` adds alignment points; `structure: false` ignores node / wall targets; `exclude` nodes are
   * neither targets nor alignment points and their walls are not targets. `disabled` returns `p` as a free target.
   */
  snapDraw(
    p: Vec2,
    from: Vec2 | undefined,
    disabled: boolean,
    extra?: Vec2[],
    opts?: { structure?: boolean; exclude?: Id[] },
  ): DrawSnapResult;
  /** Draws snap guides in the overlay; `[]` clears. */
  showGuides(g: SnapResult['guides']): void;
  /** Marks a node as being dragged so its walls show their lengths; `null` ends it. */
  setDragging(nodeId: Id | null): void;
}

export interface Tool {
  activate(ctx: ToolContext): void;
  /** Must cancel or end any gesture in progress. */
  deactivate(): void;
  /** Return true to consume the press (the plan then does not pan). */
  onPointerDown?(e: PlanPointerEvent): boolean;
  onPointerMove?(e: PlanPointerEvent): void;
  onPointerUp?(e: PlanPointerEvent): void;
  onDoubleClick?(e: PlanPointerEvent): void;
  /** Return true when handled. */
  onKeyDown?(e: KeyboardEvent): boolean;
  /** Drawing tools: commits the segment being drawn at `length`; false when there is none. */
  setPendingSegmentLength?(length: number): boolean;
}
