import type { FeatureProtocol } from './types';

/** Shell-level methods. */
export interface AppProtocol extends FeatureProtocol {
  /** Round-trip probe: the worker echoes the nonce and says when it answered. */
  'app.ping': { req: { nonce: string }; res: { nonce: string; at: number } };
}
