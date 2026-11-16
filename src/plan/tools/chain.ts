import type { Id, Vec2, WallEnd } from '../../core';

/** One clicked point of a drawing chain. */
export interface ChainPoint {
  at: Vec2;
  /** The node at this point, or null while none exists yet (a first point off any node). */
  node: Id | null;
  /** What the click picked; for the first point it is restored when the chain steps back to it. */
  end: WallEnd;
  /** History state right after this click's commit; null when it added no history entry. */
  mark: number | null;
  /** History state just before this click's commit. */
  before: number;
  /** Ids this click's commit created. */
  created: ReadonlySet<Id>;
}

/**
 * Shared click-chain state of the drawing tools. The owner feeds it every document change so it
 * knows whether the newest history entry is still the chain's last click: `historyState` gets a
 * fresh value on every foreign change and is restored when the chain undoes its own click.
 */
export class ClickChain {
  points: ChainPoint[] = [];
  /** Identifies the current top of the history as far as the chain can tell. */
  historyState = 0;
  private seq = 0;

  get last(): ChainPoint | undefined {
    return this.points[this.points.length - 1];
  }

  /** History state right after the chain's last click, or null when it has none. */
  get lastHistoryMark(): number | null {
    return this.last?.mark ?? null;
  }

  /** Records a document change (a foreign one, or one of the chain's own commits). */
  noteChange(): number {
    this.historyState = ++this.seq;
    return this.historyState;
  }

  /** True when undoing would revert exactly the chain's last click. */
  canStepBack(canUndo: boolean): boolean {
    const last = this.last;
    return (
      canUndo && this.points.length > 1 && last?.mark != null && last.mark === this.historyState
    );
  }

  /** Drops the last point after its click was undone; the history is back where it was before it. */
  stepBack(): void {
    const popped = this.points.pop();
    if (!popped) return;
    this.historyState = popped.before;
    const first = this.points[0];
    if (this.points.length === 1 && first) first.node = 'node' in first.end ? first.end.node : null;
  }

  reset(): void {
    this.points = [];
  }
}
