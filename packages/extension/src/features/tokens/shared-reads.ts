/**
 * Reads in flight, shared by whoever asks for the same key meanwhile: requests that overlap (a
 * poll and a screen, two screens) cost the node one read. Nothing is kept once a read ends.
 */
export class SharedReads {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  /**
   * Joins the read of `key` in flight, or starts one. With `fresh`, a new read starts whatever is
   * in flight (it may have started before the change the caller wants to see), and later callers
   * join that one.
   */
  run<T>(key: string, read: () => Promise<T>, fresh = false): Promise<T> {
    const running = this.inFlight.get(key);
    if (running && !fresh) return running as Promise<T>;
    const started = read().finally(() => {
      if (this.inFlight.get(key) === started) this.inFlight.delete(key);
    });
    this.inFlight.set(key, started);
    return started;
  }
}
