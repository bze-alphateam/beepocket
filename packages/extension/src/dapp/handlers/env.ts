import {
  HttpStatusError,
  SimulationError,
  TransportError,
  UnexpectedResponseError,
  type ChainClient,
  type FeeEstimator,
  type Network,
  type TokenInfo,
} from '@beepocket/core';
import type { Outcome } from '../types';
import { refuse } from '../types';
import { DappErrorCodes } from '../wire';
import type { KeyDeps } from './key';

/** The node-facing pieces a transaction request needs, for the active network. */
export interface ChainEnv {
  network: Network;
  chain: Pick<
    ChainClient,
    'account' | 'balances' | 'broadcast' | 'markets' | 'liquidityPools' | 'marketOrder'
  >;
  fees: Pick<FeeEstimator, 'estimate' | 'feeData'>;
  tokens: { resolve(denom: string): Promise<TokenInfo> };
}

/** Builds the clients when a request needs them; nothing is kept between calls. */
export type ChainEnvProvider = () => Promise<ChainEnv>;

/** What the transaction handlers use on top of what `connect` and `getKey` use. */
export interface TxDeps extends KeyDeps {
  env: ChainEnvProvider;
}

/**
 * Runs a node call. A node that fails or refuses becomes the refusal the page sees (`ok:
 * false`), so a flaky network never reaches the page as "the wallet is not ready".
 */
export async function guarded<T>(
  run: () => Promise<T>,
  rejected: (e: unknown) => string | null,
): Promise<{ ok: true; value: T } | { ok: false; outcome: Outcome }> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    const message = rejected(e);
    if (message !== null) {
      return { ok: false, outcome: refuse(DappErrorCodes.invalidRequest, message) };
    }
    if (
      e instanceof TransportError ||
      e instanceof HttpStatusError ||
      e instanceof UnexpectedResponseError
    ) {
      return {
        ok: false,
        outcome: refuse(
          DappErrorCodes.invalidRequest,
          'The network did not answer. Try again in a moment.',
        ),
      };
    }
    throw e;
  }
}

/** A simulation the node would not take is the node's own words to the page. */
export const simulationMessage = (e: unknown): string | null =>
  e instanceof SimulationError ? e.message : null;
