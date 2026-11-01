import { isLockStateEvent, type LockStateEvent } from '../../protocol';

/** Where the popup hears about wallet state changes pushed by the worker. */
export interface StateEvents {
  /** Returns the unsubscribe function. */
  subscribe(listener: (event: LockStateEvent) => void): () => void;
}

/** The slice of `chrome.runtime.onMessage` the popup uses. */
export interface MessageEventLike {
  addListener(listener: (message: unknown) => void): void;
  removeListener(listener: (message: unknown) => void): void;
}

/** `StateEvents` over `chrome.runtime.onMessage`; other messages are ignored. */
export class RuntimeStateEvents implements StateEvents {
  constructor(private readonly onMessage: MessageEventLike) {}

  subscribe(listener: (event: LockStateEvent) => void): () => void {
    const handler = (message: unknown) => {
      if (isLockStateEvent(message)) listener(message);
    };
    this.onMessage.addListener(handler);
    return () => {
      this.onMessage.removeListener(handler);
    };
  }
}
