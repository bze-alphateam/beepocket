import { feePricing, priceGasOverride, signDocBytes, withWalletFee } from '@beepocket/core';
import { ErrorCodes, fail, ok, WalletErrorCodes } from '../../protocol';
import { SendErrorCodes, type ReviewedFee } from '../../protocol';
import { multiplierOf } from '../../features/send/override';
import type { DappRegistry, DappHandler } from '../registry';
import { answer, refuse } from '../types';
import { bigintToWire, bytesToWire, DappErrorCodes } from '../wire';
import type { TxDeps } from './env';
import {
  detailsOf,
  prepareSign,
  validateSignParams,
  type Prepared,
  type SignParams,
} from './sign-prepare';

/**
 * `signDirect(chainId, signer, signDoc)`: a connected site gets one transaction signed after
 * the user has read it. The wallet signs the request's own `bodyBytes` untouched, with the fee
 * the user approved in a rebuilt auth info: the site's own fee by default, or one of the
 * wallet's options; both the review and the signature run `prepareSign`.
 */
export function signDirectHandler(deps: TxDeps): DappHandler<SignParams> {
  return {
    validate: validateSignParams,

    async decide(request) {
      const prep = await prepareSign(deps, request, request.params);
      switch (prep.kind) {
        case 'ready':
          return { kind: 'sign', details: detailsOf(prep.prepared) };
        case 'refuse':
          return { kind: 'answer', outcome: prep.outcome };
        case 'locked':
          return { kind: 'locked' };
        case 'unlock':
          return { kind: 'unlock' };
      }
    },

    async confirm(request, user) {
      if (!user.approve) return ok(refuse(DappErrorCodes.rejected, 'The request was rejected.'));
      const prep = await prepareSign(deps, request, request.params);
      if (prep.kind === 'refuse') return ok(prep.outcome);
      if (prep.kind === 'locked') return fail(WalletErrorCodes.locked, 'The wallet is locked.');
      if (prep.kind === 'unlock') {
        return fail(WalletErrorCodes.needsPassword, 'Enter your password to approve this.');
      }
      const p = prep.prepared;
      // Hiding the button is not enough: a dangerous request needs the tick, checked here too,
      // and the page is told so instead of waiting.
      if (p.summary.level === 'dangerous' && user.trusted !== true) {
        return ok(
          refuse(DappErrorCodes.invalidRequest, 'The request was not confirmed as trusted.'),
        );
      }
      const reviewed = user.fee;
      if (!reviewed) return fail(ErrorCodes.badRequest, 'dapp.answer needs the reviewed fee.');
      // What was reviewed is what gets signed: the site's fee or one of the wallet's, exactly
      // as shown, or Advanced settings priced again here. Any other fee goes back to the review.
      const chosen = reviewed.override
        ? overrideFee(p, reviewed)
        : p.options.find(
            (o) =>
              o.denom === reviewed.denom &&
              o.amount === reviewed.amount &&
              o.gasLimit === reviewed.gasLimit,
          );
      if (!chosen) {
        return fail(SendErrorCodes.reviewChanged, 'The network fee changed. Review it again.');
      }
      const authInfoBytes = withWalletFee(
        p.authInfoBytes,
        {
          amount: [{ denom: chosen.denom, amount: chosen.amount }],
          gasLimit: BigInt(chosen.gasLimit),
        },
        p.pubKey,
      );
      const signed = await deps.wallet.signDirect(
        p.entry.address,
        signDocBytes({
          bodyBytes: p.bodyBytes,
          authInfoBytes,
          chainId: p.chainId,
          accountNumber: p.accountNumber,
        }),
      );
      if (!signed.ok) return signed;
      return ok(
        answer({
          signed: {
            bodyBytes: bytesToWire(p.bodyBytes),
            authInfoBytes: bytesToWire(authInfoBytes),
            chainId: p.chainId,
            accountNumber: bigintToWire(p.accountNumber),
          },
          signature: {
            pub_key: { type: 'tendermint/PubKeySecp256k1', value: bytesToWire(p.pubKey) },
            signature: bytesToWire(signed.value),
          },
        }),
      );
    },
  };
}

/**
 * The reviewed fee when its Advanced settings still price to exactly it on this preparation's
 * simulation and prices, inside the bounds and within the balance; null otherwise.
 */
function overrideFee(
  p: Prepared,
  reviewed: ReviewedFee,
): { denom: string; amount: string; gasLimit: string } | null {
  const { override } = reviewed;
  const pricing = feePricing(p.feeData, reviewed.denom);
  if (!override || !pricing || override.gasLimit !== reviewed.gasLimit) return null;
  const priced = priceGasOverride({
    pricing,
    gasUsed: p.gasUsed,
    gasLimit: BigInt(override.gasLimit),
    gasPrice: multiplierOf(override.gasPrice),
    spendable: p.balances.get(reviewed.denom) ?? 0n,
  });
  if (priced.status !== 'ok' && priced.status !== 'warn') return null;
  if (priced.amount.toString() !== reviewed.amount) return null;
  return { denom: reviewed.denom, amount: reviewed.amount, gasLimit: reviewed.gasLimit };
}

export function registerSignDirect(registry: DappRegistry, deps: TxDeps): void {
  registry.register('signDirect', signDirectHandler(deps));
}
