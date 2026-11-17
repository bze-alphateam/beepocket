/**
 * Reads in flight, shared by whoever asks for the same key meanwhile: requests that overlap (a
 * poll and a screen, two screens) cost the node one read. Nothing is kept once a read ends.
 */
export class SharedReads {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  run<T>(key: string, read: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key);
    if (running) return running as Promise<T>;
    const started = read().finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, started);
    return started;
  }
}
