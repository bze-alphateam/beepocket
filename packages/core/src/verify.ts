import { GOVERNANCE_ONLY } from './governance';
import type { Network } from './net';
import { signersOf } from './signers';
import { strictEncodingProblem } from './strict';
import { PubKey } from './proto/cosmos/crypto/secp256k1/keys';
import { SignMode } from './proto/cosmos/tx/signing/v1beta1/signing';
import { AuthInfo, Fee, TxBody } from './proto/cosmos/tx/v1beta1/tx';
import { PUBKEY_TYPE_URL, type AnyMsg, type TxFee } from './tx';

/** Why a sign request was refused. The first failing check wins. */
export type VerifyErrorCode =
  | 'wrong-chain'
  | 'not-connected-signer'
  | 'bad-body'
  | 'bad-auth-info'
  | 'multi-signer'
  | 'pubkey-mismatch'
  | 'sign-mode'
  | 'account-number'
  | 'sequence'
  | 'fee-granter';

export interface VerifyInput {
  network: Network;
  /** The bech32 address the dapp names as the signer. */
  signer: string;
  /** The address connected to the requesting site. */
  connectedAddress: string;
  /** Compressed secp256k1 public key of `connectedAddress`. */
  connectedPubKey: Uint8Array;
  signDoc: {
    bodyBytes: Uint8Array;
    authInfoBytes: Uint8Array;
    chainId: string;
    accountNumber: bigint;
  };
  /** The account as the chain knows it; `null` for an address that was never seen. */
  chainAccount: { accountNumber: bigint; sequence: bigint } | null;
}

export type VerifyResult =
  | { ok: true; body: TxBody; authInfo: AuthInfo; messages: AnyMsg[] }
  | { ok: false; code: VerifyErrorCode; message: string };

// Dapp input is untrusted: nothing legitimate comes near these sizes.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_AUTH_INFO_BYTES = 8 * 1024;
const MAX_MESSAGES = 64;

const fail = (code: VerifyErrorCode, message: string): VerifyResult => ({
  ok: false,
  code,
  message,
});

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/**
 * Checks a sign request before anything is shown to the user: right network, right address,
 * one signer, our key, plain `SIGN_MODE_DIRECT`, the chain's account number and sequence (0
 * for an account the chain has not seen) and no fee payer or granter. A `timeoutHeight` is
 * allowed: it can only shorten how long the transaction stays valid. A failure is never
 * approvable. The wallet checks the dapp's fee itself and rebuilds the auth info with the fee
 * the user approved, using `withWalletFee`.
 *
 * The body and every readable message must also pass `strictEncodingProblem`: exactly the
 * bytes the wallet would write itself, plain whole-number amounts, bounded nesting. Anything
 * else is refused as `bad-body`, so what the wallet shows is what the chain executes.
 *
 * Messages of a type the wallet cannot decode (and that are not in `RAW_SIGNER_FIELD`) have no
 * checkable signer field; they are let through (the chain refuses a transaction that lacks a
 * signature) and summarised as unknown.
 */
export function verifySignRequest(input: VerifyInput): VerifyResult {
  const { signDoc, connectedAddress } = input;
  if (signDoc.chainId !== input.network.chainId)
    return fail('wrong-chain', 'The request is for a different network');
  if (input.signer !== connectedAddress)
    return fail(
      'not-connected-signer',
      'The request is not for the address connected to this site',
    );

  if (signDoc.bodyBytes.length > MAX_BODY_BYTES)
    return fail('bad-body', 'The transaction body is too large');
  let body: TxBody;
  try {
    body = TxBody.decode(signDoc.bodyBytes);
  } catch {
    return fail('bad-body', 'The transaction body cannot be read');
  }
  if (body.messages.length === 0) return fail('bad-body', 'The transaction has no messages');
  if (body.messages.length > MAX_MESSAGES)
    return fail('bad-body', 'The transaction has too many messages');
  if (body.extensionOptions.length > 0 || body.nonCriticalExtensionOptions.length > 0)
    return fail('bad-body', 'Transaction extension options are not supported');
  // An unordered transaction skips the sequence the wallet checks; neither is shown to the user.
  if (body.unordered || body.timeoutTimestamp !== undefined)
    return fail('bad-body', 'Unordered transactions and time-based timeouts are not supported');
  const messages: AnyMsg[] = body.messages.map((m) => ({ typeUrl: m.typeUrl, value: m.value }));

  if (signDoc.authInfoBytes.length > MAX_AUTH_INFO_BYTES)
    return fail('bad-auth-info', 'The signer information is too large');
  let authInfo: AuthInfo;
  try {
    authInfo = AuthInfo.decode(signDoc.authInfoBytes);
  } catch {
    return fail('bad-auth-info', 'The signer information cannot be read');
  }

  // Signed by the gov module only: a wallet user never signs one, whatever it decodes to.
  if (messages.some((msg) => GOVERNANCE_ONLY.has(msg.typeUrl)))
    return fail('multi-signer', 'A message can only be signed by governance');

  const problem = strictEncodingProblem(signDoc.bodyBytes, messages);
  if (problem !== null) return fail('bad-body', problem);

  const messageSigners: (string[] | null)[] = [];
  for (const msg of messages) {
    try {
      messageSigners.push(signersOf(msg));
    } catch {
      return fail('bad-body', 'A message in the transaction cannot be read');
    }
  }

  const signerInfo = authInfo.signerInfos[0];
  if (authInfo.signerInfos.length !== 1 || !signerInfo)
    return fail('multi-signer', 'The transaction must have exactly one signer');
  for (const signers of messageSigners) {
    if (signers === null) continue;
    if (signers.length === 0)
      return fail('multi-signer', 'The signer of a message could not be determined');
    if (signers.some((s) => s !== connectedAddress))
      return fail('multi-signer', 'A message needs a signature from another address');
  }

  if (signerInfo.publicKey) {
    let key: Uint8Array | null = null;
    if (signerInfo.publicKey.typeUrl === PUBKEY_TYPE_URL) {
      try {
        key = PubKey.decode(signerInfo.publicKey.value).key;
      } catch {
        key = null;
      }
    }
    if (key === null || !sameBytes(key, input.connectedPubKey))
      return fail('pubkey-mismatch', "The request's public key is not this address's key");
  }

  if (signerInfo.modeInfo?.single?.mode !== SignMode.SIGN_MODE_DIRECT)
    return fail('sign-mode', 'Only direct signing is supported');

  if (input.chainAccount !== null && input.chainAccount.accountNumber !== signDoc.accountNumber)
    return fail('account-number', "The account number does not match the chain's");

  if (signerInfo.sequence !== (input.chainAccount?.sequence ?? 0n))
    return fail('sequence', "The sequence does not match the account's current sequence");

  if (authInfo.fee && (authInfo.fee.granter !== '' || authInfo.fee.payer !== ''))
    return fail('fee-granter', 'Fee payers and fee granters are not supported');

  return { ok: true, body, authInfo, messages };
}

/**
 * The request's `AuthInfo` with the fee the wallet signs: same signer info (sequence, key, mode),
 * a fresh `Fee` without payer or granter, and no tip. `pubKey` fills the key in when the
 * request carries none. Call it only on bytes `verifySignRequest` accepted (one signer).
 */
export function withWalletFee(
  authInfoBytes: Uint8Array,
  fee: TxFee,
  pubKey?: Uint8Array,
): Uint8Array {
  const authInfo = AuthInfo.decode(authInfoBytes);
  const signerInfo = authInfo.signerInfos[0];
  if (authInfo.signerInfos.length !== 1 || !signerInfo)
    throw new RangeError('expected exactly one signer');
  const keep =
    signerInfo.publicKey || !pubKey
      ? signerInfo
      : {
          ...signerInfo,
          publicKey: {
            typeUrl: PUBKEY_TYPE_URL,
            value: PubKey.encode(PubKey.fromPartial({ key: pubKey })).finish(),
          },
        };
  return AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [keep],
      fee: Fee.fromPartial({ amount: fee.amount, gasLimit: fee.gasLimit }),
    }),
  ).finish();
}
