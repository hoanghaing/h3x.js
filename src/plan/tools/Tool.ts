import type { H3xDocument, Id, OpeningGeometry, PlacementGuide, Vec2 } from '../../core';
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
   * Drawing snap (node > wall > site corner > site edge > alignment > 45-degree lock from `from` > grid); reach is 8 screen px.
   * `extra` adds alignment points; `structure: false` ignores node / wall targets; `exclude` nodes are
   * neither targets nor alignment points and their walls are not targets. Site corners and edges (the existing site outline) are targets
   * regardless of `structure` / `exclude`, for drawing and for node / column / roof-vertex drags alike; `site: false` turns them off. `disabled` returns `p` as a free target.
   */
  snapDraw(
    p: Vec2,
    from: Vec2 | undefined,
    disabled: boolean,
    extra?: Vec2[],
    opts?: { structure?: boolean; exclude?: Id[]; site?: boolean },
  ): DrawSnapResult;
  /** Draws snap guides in the overlay; `[]` clears. */
  showGuides(g: SnapResult['guides']): void;
  /**
   * Draws the ghost of an opening being placed: its symbol, a bar `width` long at `at` when it
   * has no wall, or a closed `outline`. `invalid` draws it red; `guides` are the snap ticks across
   * the wall. `null` draws the guides alone, and with no guides clears.
   */
  showGhost(
    g: OpeningGeometry | { at: Vec2; width: number } | { outline: readonly Vec2[] } | null,
    invalid?: boolean,
    guides?: readonly PlacementGuide[],
  ): void;
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
  onKeyUp?(e: KeyboardEvent): void;
  /** The pointer left the plan. */
  onPointerLeave?(): void;
  /** Drawing tools: commits the segment being drawn at `length`; false when there is none. */
  setPendingSegmentLength?(length: number): boolean;
}
