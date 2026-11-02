import type { Outcome } from './types';

export interface TabsLike {
  sendMessage(tabId: number, message: unknown, options?: { documentId?: string }): Promise<unknown>;
}

/** Sends answers and pushes to the exact document that asked, through its content script. */
export class Deliverer {
  constructor(private readonly tabs: TabsLike) {}

  /** A page that navigated away or a closed tab is nobody to answer: failures are ignored. */
  async answer(target: { tabId: number; documentId: string }, id: string, outcome: Outcome) {
    try {
      await this.tabs.sendMessage(
        target.tabId,
        { dapp: { id, ...outcome } },
        {
          documentId: target.documentId,
        },
      );
    } catch {
      // nobody is listening any more
    }
  }
}
