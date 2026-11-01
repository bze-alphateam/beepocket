/** A response body that does not have the shape the client expects. */
export class UnexpectedResponseError extends Error {
  override readonly name = 'UnexpectedResponseError';

  /** @param path dotted path of the offending field, e.g. `params.ValidatorMinGasFee.amount`. */
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`unexpected response at ${path}: ${detail}`);
  }
}

/** A status code the call does not define (anything but 200, and 404 where that means "none"). */
export class HttpStatusError extends Error {
  override readonly name = 'HttpStatusError';

  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`unexpected HTTP status ${String(status)} from ${url}`);
  }
}

/** The network call itself failed (connection error, refused redirect, timeout). */
export class TransportError extends Error {
  override readonly name = 'TransportError';
}

/** The node rejected a transaction simulation; `message` is the node's own. */
export class SimulationError extends Error {
  override readonly name = 'SimulationError';

  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The node rejected a broadcast transaction (non-zero `tx_response.code`). */
export class BroadcastError extends Error {
  override readonly name = 'BroadcastError';

  constructor(
    readonly code: number,
    readonly codespace: string,
    readonly rawLog: string,
  ) {
    super(`broadcast rejected (${codespace} ${String(code)}): ${rawLog}`);
  }
}

/** A broadcast transaction was not found on chain before the wait ran out. */
export class TxTimeoutError extends Error {
  override readonly name = 'TxTimeoutError';

  constructor(
    readonly txHash: string,
    readonly timeoutMs: number,
  ) {
    super(`transaction ${txHash} not found after ${String(timeoutMs)} ms`);
  }
}
