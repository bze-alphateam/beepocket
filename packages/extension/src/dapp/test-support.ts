import type { AnyMsg } from '@beepocket/core';

/** A tiny protobuf writer for tests: messages the wallet's own encoders do not build. */
const encoder = new TextEncoder();

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function varint(value: number): Uint8Array {
  const bytes: number[] = [];
  let n = value;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n > 0) b |= 0x80;
    bytes.push(b);
  } while (n > 0);
  return Uint8Array.from(bytes);
}

const bytesField = (no: number, bytes: Uint8Array): Uint8Array =>
  cat(varint((no << 3) | 2), varint(bytes.length), bytes);
const textField = (no: number, text: string): Uint8Array => bytesField(no, encoder.encode(text));
const any = (typeUrl: string, value: Uint8Array): Uint8Array =>
  cat(textField(1, typeUrl), bytesField(2, value));

/** An authz `MsgGrant` of a generic authorization for `msgTypeUrl`: always dangerous. */
export function grantMsg(granter: string, grantee: string, msgTypeUrl: string): AnyMsg {
  const authorization = any('/cosmos.authz.v1beta1.GenericAuthorization', textField(1, msgTypeUrl));
  const grant = bytesField(1, authorization);
  return {
    typeUrl: '/cosmos.authz.v1beta1.MsgGrant',
    value: cat(textField(1, granter), textField(2, grantee), bytesField(3, grant)),
  };
}

/** A message of a type the wallet has never heard of, with arbitrary bytes. */
export const nothingMsg = (): AnyMsg => ({
  typeUrl: '/test.v1.MsgNothing',
  value: Uint8Array.from([1, 2, 3, 250]),
});

/**
 * A vesting `MsgCreateVestingAccount` from `from` to `to` of `amount` ubze, ending at
 * `endTime`: a type the wallet has no decoder for.
 */
export function vestingMsg(from: string, to: string, amount: string, endTime = 1): AnyMsg {
  const coin = cat(textField(1, 'ubze'), textField(2, amount));
  return {
    typeUrl: '/cosmos.vesting.v1beta1.MsgCreateVestingAccount',
    value: cat(
      textField(1, from),
      textField(2, to),
      bytesField(3, coin),
      varint(4 << 3),
      varint(endTime),
    ),
  };
}
