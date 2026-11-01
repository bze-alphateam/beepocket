import type { NetworkId } from '@beepocket/core';

/** Read-only context of the home screen. */
export interface HomeProtocol {
  /** Active network and the `brandThemes` setting; a locked wallet answers the default (on). */
  'home.context': { req: Record<string, never>; res: { network: NetworkId; brandThemes: boolean } };
}
