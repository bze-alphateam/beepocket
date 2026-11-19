import type { BinaryReader } from './proto/binary';
import type { AnyMsg } from './tx';
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
import * as daoMsgs from './proto/bze/dao/tx';
import * as guardianMsgs from './proto/bze/guardian/v1/tx';
import * as stakingMsgs from './proto/cosmos/staking/v1beta1/tx';
import * as distributionMsgs from './proto/cosmos/distribution/v1beta1/tx';
import * as transferMsgs from './proto/ibc/applications/transfer/v1/tx';
import * as vestingMsgs from './proto/cosmos/vesting/v1beta1/tx';
import * as vesting from './proto/cosmos/vesting/v1beta1/vesting';

/**
 * Nested `google.protobuf.Any` levels the wallet reads. Deeper values are left opaque by
 * `decodeAny` and refused by the sign-request checks.
 */
export const MAX_ANY_DEPTH = 8;

export interface Codec {
  typeUrl: string;
  decode(input: Uint8Array | BinaryReader): unknown;
  encode(message: never): { finish(): Uint8Array };
}

const isCodec = (v: unknown): v is Codec =>
  typeof v === 'object' &&
  v !== null &&
  'typeUrl' in v &&
  typeof v.typeUrl === 'string' &&
  v.typeUrl.startsWith('/') &&
  'decode' in v &&
  typeof v.decode === 'function' &&
  'encode' in v &&
  typeof v.encode === 'function';

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
  daoMsgs,
  guardianMsgs,
  stakingMsgs,
  distributionMsgs,
  transferMsgs,
  vestingMsgs,
  vesting,
]) {
  for (const exported of Object.values(mod)) {
    if (isCodec(exported)) codecs.set(exported.typeUrl, exported);
  }
}

/** The codec for a type URL, or undefined for a type the wallet cannot read. */
export function codecFor(typeUrl: string): Codec | undefined {
  return codecs.get(typeUrl);
}

export function typeUrlsWithCodec(): string[] {
  return [...codecs.keys()].sort();
}

export function isAnyLike(v: object): v is AnyMsg {
  return (
    'typeUrl' in v && typeof v.typeUrl === 'string' && 'value' in v && v.value instanceof Uint8Array
  );
}
