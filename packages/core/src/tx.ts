import { sha256 } from '@noble/hashes/sha2.js';
import { Any } from './proto/google/protobuf/any';
import { Coin } from './proto/cosmos/base/v1beta1/coin';
import { PubKey } from './proto/cosmos/crypto/secp256k1/keys';
import { MsgSend } from './proto/cosmos/bank/v1beta1/tx';
import { SignMode } from './proto/cosmos/tx/signing/v1beta1/signing';
import { AuthInfo, Fee, SignDoc, TxBody, TxRaw } from './proto/cosmos/tx/v1beta1/tx';

export type { Coin };

/** A protobuf message wrapped the way a transaction carries it (`google.protobuf.Any`). */
export interface AnyMsg {
  typeUrl: string;
  value: Uint8Array;
}

export interface TxFee {
  amount: Coin[];
  gasLimit: bigint;
}

export const PUBKEY_TYPE_URL = '/cosmos.crypto.secp256k1.PubKey';

/** `/cosmos.bank.v1beta1.MsgSend`. */
export function encodeMsgSend(msg: {
  fromAddress: string;
  toAddress: string;
  amount: Coin[];
}): AnyMsg {
  return {
    typeUrl: MsgSend.typeUrl,
    value: MsgSend.encode(MsgSend.fromPartial(msg)).finish(),
  };
}

/** Serialized `TxBody` (`timeout_height` 0, no extension options). */
export function buildBody(params: { messages: AnyMsg[]; memo?: string }): Uint8Array {
  return TxBody.encode(
    TxBody.fromPartial({
      messages: params.messages.map((m) => Any.fromPartial(m)),
      memo: params.memo ?? '',
    }),
  ).finish();
}

function signerInfo(pubKey: Uint8Array, sequence: bigint) {
  return {
    publicKey: Any.fromPartial({
      typeUrl: PUBKEY_TYPE_URL,
      value: PubKey.encode(PubKey.fromPartial({ key: pubKey })).finish(),
    }),
    modeInfo: { single: { mode: SignMode.SIGN_MODE_DIRECT } },
    sequence,
  };
}

/** Serialized `AuthInfo`: one signer, `SIGN_MODE_DIRECT`, no payer and no granter. */
export function buildAuthInfo(params: {
  pubKey: Uint8Array;
  sequence: bigint;
  fee: TxFee;
}): Uint8Array {
  return AuthInfo.encode(
    AuthInfo.fromPartial({
      signerInfos: [signerInfo(params.pubKey, params.sequence)],
      fee: Fee.fromPartial({ amount: params.fee.amount, gasLimit: params.fee.gasLimit }),
    }),
  ).finish();
}

/** Serialized `SignDoc`: the bytes a `SIGN_MODE_DIRECT` signature covers (before hashing). */
export function signDocBytes(params: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  chainId: string;
  accountNumber: bigint;
}): Uint8Array {
  return SignDoc.encode(SignDoc.fromPartial(params)).finish();
}

/** Serialized `TxRaw`, ready for broadcast (base64 it for `/cosmos/tx/v1beta1/txs`). */
export function txRawBytes(params: {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  signatures: Uint8Array[];
}): Uint8Array {
  return TxRaw.encode(TxRaw.fromPartial(params)).finish();
}

/** Reads serialized `TxRaw` bytes; throws when they are not a `TxRaw`. */
export function decodeTxRaw(txRaw: Uint8Array): {
  bodyBytes: Uint8Array;
  authInfoBytes: Uint8Array;
  signatures: Uint8Array[];
} {
  const { bodyBytes, authInfoBytes, signatures } = TxRaw.decode(txRaw);
  return { bodyBytes, authInfoBytes, signatures };
}

/**
 * `TxRaw` for `/cosmos/tx/v1beta1/simulate`: empty signature, a zero gas limit and `fee` (none
 * by default). A fee coin makes the chain run the fee deduction, and its gas, as it will for real.
 */
export function simulationTxBytes(
  bodyBytes: Uint8Array,
  pubKey: Uint8Array,
  sequence: bigint,
  fee: Coin[] = [],
): Uint8Array {
  return txRawBytes({
    bodyBytes,
    authInfoBytes: buildAuthInfo({ pubKey, sequence, fee: { amount: fee, gasLimit: 0n } }),
    signatures: [new Uint8Array()],
  });
}

/** The hash a node reports for a transaction: SHA-256 of the `TxRaw` bytes, uppercase hex. */
export function txHash(txRaw: Uint8Array): string {
  return Array.from(sha256(txRaw), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}
