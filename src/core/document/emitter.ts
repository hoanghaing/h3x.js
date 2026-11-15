export class Emitter<E> {
  private readonly listeners = new Set<(e: E) => void>();

  on(fn: (e: E) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** Runs every listener; the first listener error is rethrown afterwards. */
  emit(e: E): void {
    let failed = false;
    let error: unknown;
    for (const fn of [...this.listeners]) {
      try {
        fn(e);
      } catch (err) {
        if (!failed) {
          failed = true;
          error = err;
        }
      }
    }
    if (failed) throw error;
  }
}
