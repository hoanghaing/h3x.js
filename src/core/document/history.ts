import type { EntityChange } from './changes';
import { mergeChanges } from './changes';

export const HISTORY_LIMIT = 200;

/** Structural equality for plain snapshot data (internal). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

interface Entry {
  changes: EntityChange[];
  key?: string;
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private sealed = true;
  /** Redo stack as it was just before the open keyed group's first push. */
  private groupRedo: Entry[] = [];

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Next push never merges. */
  seal(): void {
    this.sealed = true;
  }

  push(changes: EntityChange[], key?: string): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && key !== undefined && top.key === key && !this.sealed) {
      top.changes = mergeChanges(top.changes, changes);
      if (top.changes.every((c) => deepEqual(c.before, c.after))) {
        // Net no-op (e.g. dragged back to the start): leave no phantom undo step.
        this.undoStack.pop();
        this.sealed = true;
        this.redoStack = [];
        return;
      }
    } else {
      this.groupRedo = this.redoStack;
      this.undoStack.push({ changes, key });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.sealed = key === undefined;
    this.redoStack = [];
  }

  /**
   * Drop the open keyed group and restore the redo stack it cleared.
   * Returns the group's changes, or undefined if no such group is open.
   */
  cancel(key: string): EntityChange[] | undefined {
    const top = this.undoStack[this.undoStack.length - 1];
    if (this.sealed || !top || top.key !== key) return undefined;
    this.undoStack.pop();
    this.redoStack = this.groupRedo;
    this.sealed = true;
    return top.changes;
  }

  popUndo(): EntityChange[] | undefined {
    const e = this.undoStack.pop();
    if (!e) return undefined;
    this.redoStack.push(e);
    this.sealed = true;
    return e.changes;
  }

  popRedo(): EntityChange[] | undefined {
    const e = this.redoStack.pop();
    if (!e) return undefined;
    this.undoStack.push(e);
    this.sealed = true;
    return e.changes;
  }
}
