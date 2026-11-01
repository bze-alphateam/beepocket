/** Time source, injected so polling loops can be tested without real waiting. */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  sleep(ms: number): Promise<void>;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
