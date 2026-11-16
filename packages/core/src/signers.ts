import { bech32 } from '@scure/base';
import { decodeAny } from './decode';
import { BinaryReader, WireType } from './proto/binary';
import type { AnyMsg } from './tx';
import { BZE_PREFIX } from './vault/keys';

/** Message fields that name an account whose signature the message needs. */
const SIGNER_FIELDS = [
  'creator',
  'fromAddress',
  'voter',
  'granter',
  'authority',
  'proposer',
  'depositor',
  'sender',
  'delegatorAddress',
  'publisher',
  'signer',
] as const;
/**
 * Signers as a plain string field at a fixed number (IBC transfer `sender`, staking and
 * distribution `delegator_address`), for when these types have no decoder. They all decode
 * today, so `SIGNER_FIELDS` finds their signer; this is the fallback if a codec is dropped.
 */
const RAW_SIGNER_FIELD: Record<string, number> = {
  '/ibc.applications.transfer.v1.MsgTransfer': 4,
  '/cosmos.staking.v1beta1.MsgDelegate': 1,
  '/cosmos.staking.v1beta1.MsgUndelegate': 1,
  '/cosmos.staking.v1beta1.MsgBeginRedelegate': 1,
  '/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation': 1,
  '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward': 1,
  '/cosmos.distribution.v1beta1.MsgSetWithdrawAddress': 1,
};
const MSG_EXEC = '/cosmos.authz.v1beta1.MsgExec';
const MSG_MULTI_SEND = '/cosmos.bank.v1beta1.MsgMultiSend';

/** The first length-delimited field `fieldNo` read as text; `''` when it is absent. Throws on bad bytes. */
function readStringField(bytes: Uint8Array, fieldNo: number): string {
  const reader = new BinaryReader(bytes);
  while (reader.pos < reader.len) {
    const [no, wireType] = reader.tag();
    if (no === fieldNo && wireType === WireType.Bytes) return reader.string();
    reader.skipType(wireType);
  }
  return '';
}

/**
 * The accounts a message needs signatures from, or `null` for a type the wallet has no decoder
 * for. A known type whose signer cannot be found yields an empty list and is refused by the
 * caller (fail closed). Throws when the bytes do not decode.
 */
export function signersOf(msg: AnyMsg): string[] | null {
  const decoded = decodeAny(msg);
  if ('unknown' in decoded) {
    const field = RAW_SIGNER_FIELD[msg.typeUrl];
    return field === undefined ? null : [readStringField(msg.value, field)];
  }
  const { value } = decoded;
  const found: string[] = [];
  for (const field of SIGNER_FIELDS) {
    const v = value[field];
    if (v !== undefined) found.push(typeof v === 'string' ? v : '');
  }
  if (msg.typeUrl === MSG_EXEC) {
    const grantee = value.grantee;
    found.push(typeof grantee === 'string' ? grantee : '');
  }
  if (msg.typeUrl === MSG_MULTI_SEND) {
    const inputs = value.inputs;
    if (Array.isArray(inputs)) {
      for (const input of inputs) {
        const address =
          typeof input === 'object' && input !== null && !Array.isArray(input)
            ? input.address
            : undefined;
        found.push(typeof address === 'string' ? address : '');
      }
    }
  }
  return found;
}

/**
 * The 20-byte hash of a `bze1…` address, in lower or upper case; `null` for anything else,
 * including the same bytes under another chain's prefix.
 */
export function bzeAddressHash(address: string): Uint8Array | null {
  try {
    const { prefix, words } = bech32.decode(address as `${string}1${string}`);
    const bytes = bech32.fromWords(words);
    return prefix === BZE_PREFIX && bytes.length === 20 ? bytes : null;
  } catch {
    return null;
  }
}
