import { BroadcastError, decodeTxRaw } from '@beepocket/core';
import { ErrorCodes, fail, ok, type Result } from '../../protocol';
import type { DappRegistry, DappHandler } from '../registry';
import { answer, refuse, type Outcome, type PendingRequest } from '../types';
import { bytesFromWire, bytesToWire, DappErrorCodes } from '../wire';
import { guarded, type TxDeps } from './env';
import { connectedAddress, networkRefusal } from './key';

export interface SendTxParams {
  chainId: string;
  /** Base64 of the signed `TxRaw`. */
  txBytes: string;
}

const MAX_CHAIN_ID = 64;
const MAX_TX_BYTES = 512 * 1024;
/** Base64 length of the largest accepted transaction, so nothing huge is decoded. */
const MAX_TX_TEXT = Math.ceil(MAX_TX_BYTES / 3) * 4;

const invalid = (message: string): Outcome => refuse(DappErrorCodes.invalidRequest, message);
const done = (outcome: Outcome) => ({ kind: 'answer', outcome }) as const;

function validate(params: unknown): Result<SendTxParams> {
  if (typeof params !== 'object' || params === null) {
    return fail(ErrorCodes.badRequest, 'sendTx needs a chainId, txBytes and a mode.');
  }
  const { chainId, txBytes, mode } = params as Record<string, unknown>;
  if (mode !== 'sync') return fail(ErrorCodes.badRequest, "Only the 'sync' mode is supported.");
  if (typeof chainId !== 'string' || chainId.length === 0 || chainId.length > MAX_CHAIN_ID) {
    return fail(ErrorCodes.badRequest, 'chainId must be a string.');
  }
  if (typeof txBytes !== 'string' || txBytes.length === 0 || txBytes.length > MAX_TX_TEXT) {
    return fail(ErrorCodes.badRequest, 'The transaction is empty or too large.');
  }
  try {
    if (bytesFromWire(txBytes).length > MAX_TX_BYTES) throw new RangeError('too large');
  } catch {
    return fail(ErrorCodes.badRequest, 'The transaction is empty or too large.');
  }
  return ok({ chainId, txBytes });
}

const TX_HASH = /^[0-9A-Fa-f]{64}$/;

function hashBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

/**
 * `sendTx(chainId, txBytes, 'sync')`: broadcasts a transaction that is already signed. It needs
 * no key and no user, so it never opens a window: a fully locked wallet answers at once.
 * It always answers in `decide`, which therefore broadcasts at most once per request.
 */
export function sendTxHandler(deps: TxDeps): DappHandler<SendTxParams> {
  return {
    validate,

    async beforeNode(request) {
      const checked = await checkLocally(deps, request);
      return 'outcome' in checked ? done(checked.outcome) : null;
    },

    // No signal: a broadcast cannot be called back once sent; the cancel check before it counts.
    async decide(request) {
      const checked = await checkLocally(deps, request);
      if ('outcome' in checked) return done(checked.outcome);
      const { txBytes } = checked;
      const env = await deps.env();
      // Checked right before the broadcast: the page may have given up while the request waited.
      if (await deps.cancelled.has(request)) {
        return done(refuse(DappErrorCodes.unavailable, 'The page stopped waiting.'));
      }
      const sent = await guarded(
        () => env.chain.broadcast(txBytes),
        (e) => (e instanceof BroadcastError ? e.rawLog || e.message : null),
      );
      if (!sent.ok) return done(sent.outcome);
      // A reply without a proper hash is not a success the page can follow up.
      if (!TX_HASH.test(sent.value.txHash)) {
        return done(invalid('The node returned an unusable transaction hash.'));
      }
      return done(answer(bytesToWire(hashBytes(sent.value.txHash))));
    },

    confirm() {
      return Promise.resolve(fail(ErrorCodes.internal, 'sendTx has nothing to confirm.'));
    },
  };
}

/**
 * The checks that need no node: network, wallet state, the connected site and a signed
 * transaction. A request that fails them is answered without reaching the node.
 */
async function checkLocally(
  deps: TxDeps,
  request: PendingRequest & { params: SendTxParams },
): Promise<{ outcome: Outcome } | { txBytes: Uint8Array }> {
  const active = await deps.services.activeNetwork();
  const wrong = networkRefusal(request, request.params, active.id);
  if (wrong) return { outcome: wrong };
  const { state } = await deps.wallet.state();
  if (state === 'uninitialised') {
    return { outcome: refuse(DappErrorCodes.notConnected, 'BeePocket has no wallet yet.') };
  }
  if (state === 'locked') {
    return { outcome: refuse(DappErrorCodes.lockedTimeout, 'Unlock BeePocket') };
  }
  const profile = await deps.wallet.getProfile();
  if (!profile.ok) return { outcome: refuse(DappErrorCodes.lockedTimeout, 'Unlock BeePocket') };
  if (!connectedAddress(profile.value, request)) {
    return { outcome: refuse(DappErrorCodes.notConnected, 'This site is not connected.') };
  }
  const txBytes = bytesFromWire(request.params.txBytes);
  try {
    const raw = decodeTxRaw(txBytes);
    if (
      raw.bodyBytes.length === 0 ||
      raw.authInfoBytes.length === 0 ||
      raw.signatures.length === 0
    ) {
      return { outcome: invalid('The transaction is not signed.') };
    }
  } catch {
    return { outcome: invalid('The transaction cannot be read.') };
  }
  return { txBytes };
}

export function registerSendTx(registry: DappRegistry, deps: TxDeps): void {
  registry.register('sendTx', sendTxHandler(deps));
}
