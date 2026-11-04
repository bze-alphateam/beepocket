import { base64 } from '@scure/base';
import type { BinaryReader } from './proto/binary';
import type { AnyMsg } from './tx';
import { AuthInfo, TxBody } from './proto/cosmos/tx/v1beta1/tx';
import * as anyMod from './proto/google/protobuf/any';
import * as coin from './proto/cosmos/base/v1beta1/coin';
import * as keys from './proto/cosmos/crypto/secp256k1/keys';
import * as auth from './proto/cosmos/auth/v1beta1/auth';
import * as bankMsgs from './proto/cosmos/bank/v1beta1/tx';
import * as bank from './proto/cosmos/bank/v1beta1/bank';
import * as bankAuthz from './proto/cosmos/bank/v1beta1/authz';
import * as authzMsgs from './proto/cosmos/authz/v1beta1/tx';
import * as authz from './proto/cosmos/authz/v1beta1/authz';
import * as feegrantMsgs from './proto/cosmos/feegrant/v1beta1/tx';
import * as feegrant from './proto/cosmos/feegrant/v1beta1/feegrant';
import * as stakingAuthz from './proto/cosmos/staking/v1beta1/authz';
import * as transferAuthz from './proto/ibc/applications/transfer/v1/authz';
import * as govMsgs from './proto/cosmos/gov/v1/tx';
import * as tradebinMsgs from './proto/bze/tradebin/tx';
import * as burnerMsgs from './proto/bze/burner/tx';
import * as rewardsMsgs from './proto/bze/rewards/tx';
import * as tokenfactoryMsgs from './proto/bze/tokenfactory/tx';
import * as cointrunkMsgs from './proto/bze/cointrunk/tx';
import * as stakingMsgs from './proto/cosmos/staking/v1beta1/tx';
import * as distributionMsgs from './proto/cosmos/distribution/v1beta1/tx';
import * as transferMsgs from './proto/ibc/applications/transfer/v1/tx';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type DecodedAny =
  { typeUrl: string; value: Record<string, Json> } | { typeUrl: string; unknown: true };

interface Codec {
  typeUrl: string;
  decode(input: Uint8Array | BinaryReader): unknown;
}

const isCodec = (v: unknown): v is Codec =>
  typeof v === 'object' &&
  v !== null &&
  'typeUrl' in v &&
  typeof v.typeUrl === 'string' &&
  v.typeUrl.startsWith('/') &&
  'decode' in v &&
  typeof v.decode === 'function';

/** Every copied message type, keyed by type URL. */
const codecs = new Map<string, Codec>();
for (const mod of [
  anyMod,
  coin,
  keys,
  auth,
  bankMsgs,
  bank,
  bankAuthz,
  authzMsgs,
  authz,
  feegrantMsgs,
  feegrant,
  stakingAuthz,
  transferAuthz,
  govMsgs,
  tradebinMsgs,
  burnerMsgs,
  rewardsMsgs,
  tokenfactoryMsgs,
  cointrunkMsgs,
  stakingMsgs,
  distributionMsgs,
  transferMsgs,
]) {
  for (const exported of Object.values(mod)) {
    if (isCodec(exported)) codecs.set(exported.typeUrl, exported);
  }
}

/** The type URLs `decodeAny` understands. */
export function knownTypeUrls(): string[] {
  return [...codecs.keys()].sort();
}

function isAnyLike(v: object): v is AnyMsg {
  return (
    'typeUrl' in v && typeof v.typeUrl === 'string' && 'value' in v && v.value instanceof Uint8Array
  );
}

function toJson(v: unknown): Json {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return base64.encode(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === 'object' && v !== null) {
    if (isAnyLike(v)) return decodeAny(v);
    const out: Record<string, Json> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== undefined) out[k] = toJson(val);
    }
    return out;
  }
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  throw new Error(`cannot convert ${typeof v} to JSON`);
}

/**
 * Decodes a message carried in a transaction. Types outside the copied set come back as
 * `{ typeUrl, unknown: true }`; callers must treat those as opaque. The output is JSON-safe:
 * bigint → decimal string, bytes → base64, nested `Any` values decoded recursively.
 */
export function decodeAny(msg: AnyMsg): DecodedAny {
  const codec = codecs.get(msg.typeUrl);
  if (!codec) return { typeUrl: msg.typeUrl, unknown: true };
  const value = toJson(codec.decode(msg.value));
  return { typeUrl: msg.typeUrl, value: value as Record<string, Json> };
}

export function decodeTxBody(bytes: Uint8Array): Record<string, Json> {
  return toJson(TxBody.decode(bytes)) as Record<string, Json>;
}

export function decodeAuthInfo(bytes: Uint8Array): Record<string, Json> {
  return toJson(AuthInfo.decode(bytes)) as Record<string, Json>;
}
