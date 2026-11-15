import type { EntityChange } from './changes';
import { mergeChanges } from './changes';

export const HISTORY_LIMIT = 200;

interface Entry {
  changes: EntityChange[];
  key?: string;
}

export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private sealed = true;

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
    } else {
      this.undoStack.push({ changes, key });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.sealed = key === undefined;
    this.redoStack = [];
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
