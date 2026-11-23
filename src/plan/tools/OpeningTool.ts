import {
  addOpening,
  nextOrientation,
  openingGeometry,
  presetOpening,
  resolvePlacement,
  type Hinge,
  type Id,
  type Issue,
  type Opening,
  type Placement,
  type Swing,
  type Vec2,
} from '../../core';
import { OPENING_REACH_PX as REACH_PX, OPENING_SNAP_PX as SNAP_PX } from './openingEdit';
import type { PlanPointerEvent, Tool, ToolContext } from './Tool';
/** Width (m) of the bar shown at the pointer when the preset cannot be read. */
const FALLBACK_WIDTH = 0.9;

export interface OpeningToolOptions {
  /** Opening preset to place, e.g. 'door-single-01'. */
  preset: string;
}

/** The pointer the ghost was last drawn for. */
interface Pointer {
  plan: Vec2;
  free: boolean;
}

/** What the ghost shows: where the opening would go (null when no wall is in reach). */
interface Candidate {
  opening: Opening | null;
  placement: Placement | null;
}

/**
 * Places doors and windows from a preset. A ghost with the true symbol follows the pointer onto
 * the nearest wall in reach (red where the opening may not go, a red bar where no wall is near);
 * a click adds the opening (`addOpening`, one undo step) and selects it, and the tool stays. Space
 * cycles hinge and swing until the pointer moves to another wall; Alt turns snapping off; Esc
 * clears the ghost.
 */
export class OpeningTool implements Tool {
  private preset: string;
  private ctx: ToolContext | null = null;
  private pointer: Pointer | null = null;
  /** The wall hosting the ghost, kept against nearby walls (hysteresis). */
  private host: Id | undefined;
  /** Hinge and swing chosen with Space, while the ghost stays on `wall`. */
  private orientation: { wall: Id; hinge: Hinge; swing: Swing } | null = null;
  private candidate: Candidate | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(opts: OpeningToolOptions) {
    this.preset = opts.preset;
  }

  /** Changes what is placed; the ghost follows at once. */
  setOptions(opts: { preset?: string }): void {
    if (opts.preset !== undefined) this.preset = opts.preset;
    if (this.candidate) this.redraw();
  }

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    // An edit under a still pointer (undo while hovering) moves what the ghost stands against.
    this.unsubscribe = ctx.doc.on('change', () => {
      if (this.candidate) this.redraw();
    });
  }

  deactivate(): void {
    this.clear();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.ctx = null;
  }

  onPointerLeave(): void {
    this.hide();
  }

  onKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Alt') this.setFree(false);
  }

  onPointerMove(e: PlanPointerEvent): void {
    if (!this.ctx) return;
    this.pointer = { plan: e.plan, free: (e.native as MouseEvent).altKey };
    this.redraw();
  }

  onPointerDown(e: PlanPointerEvent): boolean {
    const ctx = this.ctx;
    if (!ctx || e.native.button !== 0) return false;
    this.pointer = { plan: e.plan, free: (e.native as MouseEvent).altKey };
    if (ctx.doc.presets(this.preset)?.mount !== 'opening') {
      ctx.plan.reportRejected([notOpeningPreset(this.preset)]);
      return true;
    }
    const { opening, placement } = this.resolve();
    if (!placement || !opening) {
      ctx.plan.reportRejected([noHost()]);
      return true;
    }
    if (placement.issues.length > 0) {
      ctx.plan.reportRejected(placement.issues);
      return true;
    }
    const cmd = addOpening({
      wall: placement.wall,
      preset: this.preset,
      offset: placement.offset,
      hinge: opening.hinge,
      swing: opening.swing,
    });
    const res = ctx.doc.tryExecute(cmd);
    if (!res.ok) {
      ctx.plan.reportRejected(res.issues);
      return true;
    }
    ctx.plan.reportRejected([]);
    ctx.plan.select({ kind: 'opening', id: cmd.createdId });
    // The new opening stands where the ghost was; the next move draws it again.
    this.hide();
    return true;
  }

  onKeyDown(e: KeyboardEvent): boolean {
    if (!this.ctx || e.ctrlKey || e.metaKey) return false;
    if (e.key === 'Alt') {
      this.setFree(true);
      return false;
    }
    if (e.key === 'Escape') {
      if (!this.candidate) return false;
      this.clear();
      return true;
    }
    if (e.key === ' ') {
      const opening = this.candidate?.opening;
      const next = opening && nextOrientation(opening);
      if (!opening || !next) return false;
      this.orientation = { wall: opening.wall, ...next };
      this.redraw();
      return true;
    }
    return false;
  }

  /** Alt pressed or released without a move: snapping follows at once. */
  private setFree(free: boolean): void {
    if (!this.pointer || this.pointer.free === free) return;
    this.pointer = { ...this.pointer, free };
    if (this.candidate) this.redraw();
  }

  /** Re-resolves the last pointer and draws the ghost there. */
  private redraw(): void {
    const ctx = this.ctx;
    if (!ctx || !this.pointer) return;
    const candidate = this.resolve();
    this.candidate = candidate;
    const { opening, placement } = candidate;
    if (!opening || !placement) {
      const info = ctx.doc.presets(this.preset);
      const width = info?.mount === 'opening' ? info.footprint.w : FALLBACK_WIDTH;
      ctx.showGhost({ at: this.pointer.plan, width }, true);
      return;
    }
    const geometry = openingGeometry(ctx.doc.floor, opening);
    ctx.showGhost(geometry, placement.issues.length > 0, placement.guides);
  }

  /** Where the preset goes for the last pointer; tracks the host and drops a stale orientation. */
  private resolve(): Candidate {
    const ctx = this.ctx;
    const info = ctx?.doc.presets(this.preset);
    if (!ctx || !this.pointer || info?.mount !== 'opening')
      return { opening: null, placement: null };
    const scale = ctx.plan.view.scale;
    const subject = presetOpening(info, {
      id: '',
      wall: '',
      preset: this.preset,
      offset: 0,
      hinge: 'a',
      swing: 'left',
    });
    const placement = resolvePlacement(ctx.doc.floor, {
      subject: { mount: 'opening', opening: subject },
      point: this.pointer.plan,
      reach: REACH_PX / scale,
      snapReach: SNAP_PX / scale,
      grid: ctx.plan.snapOptions.grid,
      free: this.pointer.free,
      ...(this.host !== undefined ? { current: this.host } : {}),
    });
    this.host = placement?.wall;
    if (this.orientation && this.orientation.wall !== placement?.wall) this.orientation = null;
    if (!placement) return { opening: null, placement: null };
    const { hinge, swing } = this.orientation ?? placement;
    return {
      opening: { ...subject, wall: placement.wall, offset: placement.offset, hinge, swing },
      placement,
    };
  }

  /** Removes the ghost but keeps the pointer, host and orientation. */
  private hide(): void {
    this.candidate = null;
    this.ctx?.showGhost(null);
  }

  /** Removes the ghost and forgets the gesture. */
  private clear(): void {
    this.hide();
    this.pointer = null;
    this.host = undefined;
    this.orientation = null;
  }
}

function noHost(): Issue {
  return {
    code: 'placement-no-host',
    ids: [],
    message: 'No wall is near enough to hold the opening',
  };
}

function notOpeningPreset(preset: string): Issue {
  return { code: 'unknown-preset', ids: [], message: `Preset ${preset} is not an opening preset` };
}
