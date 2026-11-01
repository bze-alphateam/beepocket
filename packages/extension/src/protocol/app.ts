/** Shell-level methods. */
export interface AppProtocol {
  /** Round-trip probe: the worker echoes the nonce and says when it answered. */
  'app.ping': { req: { nonce: string }; res: { nonce: string; at: number } };
}
