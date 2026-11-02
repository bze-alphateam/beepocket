import { signDocBytes, withWalletFee } from '@beepocket/core';
import { ErrorCodes, fail, ok, WalletErrorCodes } from '../../protocol';
import { SendErrorCodes } from '../../protocol/send';
import type { DappRegistry, DappHandler } from '../registry';
import { answer, refuse } from '../types';
import { bigintToWire, bytesToWire, DappErrorCodes } from '../wire';
import type { TxDeps } from './env';
import { detailsOf, prepareSign, validateSignParams, type SignParams } from './sign-prepare';

/**
 * `signDirect(chainId, signer, signDoc)`: a connected site gets one transaction signed after
 * the user has read it. The wallet signs the request's own `bodyBytes` untouched, with its own
 * fee in the auth info; both the review and the signature run `prepareSign`.
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
      // Hiding the button is not enough: a dangerous request needs the tick, checked here too.
      if (p.summary.level === 'dangerous' && user.trusted !== true) {
        return fail(ErrorCodes.badRequest, 'Tick the box to confirm you trust this request.');
      }
      const reviewed = user.fee;
      if (!reviewed) return fail(ErrorCodes.badRequest, 'dapp.answer needs the reviewed fee.');
      const chosen = p.options.find((o) => o.denom === reviewed.denom);
      // What was reviewed is what gets signed: any other fee goes back to the review.
      if (
        !chosen ||
        chosen.amount !== reviewed.amount ||
        p.gasLimit.toString() !== reviewed.gasLimit
      ) {
        return fail(SendErrorCodes.reviewChanged, 'The network fee changed. Review it again.');
      }
      const authInfoBytes = withWalletFee(
        p.authInfoBytes,
        { amount: [{ denom: chosen.denom, amount: chosen.amount }], gasLimit: p.gasLimit },
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

export function registerSignDirect(registry: DappRegistry, deps: TxDeps): void {
  registry.register('signDirect', signDirectHandler(deps));
}
