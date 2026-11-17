#!/usr/bin/env node
// Copies the protobuf message code BeePocket needs out of a checkout of @bze/bzejs
// into packages/core/src/proto/. Usage: node scripts/copy-proto.mjs <path-to-bzejs>
// See packages/core/src/proto/README.md.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = [
  'binary.ts',
  'helpers.ts',
  'utf8.ts',
  'varint.ts',
  'google/protobuf/any.ts',
  'google/protobuf/duration.ts',
  'google/protobuf/timestamp.ts',
  'cosmos/base/v1beta1/coin.ts',
  'cosmos/crypto/multisig/v1beta1/multisig.ts',
  'cosmos/crypto/secp256k1/keys.ts',
  'cosmos/tx/signing/v1beta1/signing.ts',
  'cosmos/tx/v1beta1/tx.ts',
  'cosmos/auth/v1beta1/auth.ts',
  'cosmos/bank/v1beta1/authz.ts',
  'cosmos/bank/v1beta1/bank.ts',
  'cosmos/bank/v1beta1/tx.ts',
  'cosmos/authz/v1beta1/authz.ts',
  'cosmos/authz/v1beta1/tx.ts',
  'cosmos/feegrant/v1beta1/feegrant.ts',
  'cosmos/feegrant/v1beta1/tx.ts',
  'cosmos/staking/v1beta1/authz.ts',
  'ibc/applications/transfer/v1/authz.ts',
  'bze/burner/params.ts',
  'bze/burner/tx.ts',
  'bze/tradebin/v2/params.ts',
  'bze/tradebin/tx.ts',
  'bze/rewards/params.ts',
  'bze/rewards/tx.ts',
  'bze/tokenfactory/denom_branding.ts',
  'bze/tokenfactory/tx.ts',
  'bze/cointrunk/params.ts',
  'bze/cointrunk/tx.ts',
  'ibc/core/client/v1/client.ts',
  'ibc/applications/transfer/v1/tx.ts',
  'cosmos/vesting/v1beta1/vesting.ts',
  'cosmos/vesting/v1beta1/tx.ts',
];
// Trimmed on purpose: the full gov v1 files pull in upgrade, distribution, params
// and cointrunk proposal types. Only MsgVote, MsgDeposit and the VoteOption enum are kept.
const GOV_TX = 'cosmos/gov/v1/tx.ts';
const GOV = 'cosmos/gov/v1/gov.ts';
// Trimmed too: the full staking and distribution tx files pull in validator, tendermint and
// pubkey types. Only the delegation messages and the reward-address messages are kept.
const STAKING_TX = 'cosmos/staking/v1beta1/tx.ts';
const DISTRIBUTION_TX = 'cosmos/distribution/v1beta1/tx.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages/core/src/proto');
const src = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('usage: copy-proto.mjs <path-to-bzejs>');
const version = JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')).version;

const header = (path) =>
  `// Copied from @bze/bzejs ${version} (src/${path}); registry stand-in used, see README. Do not edit; re-copy on chain upgrades.\n`;
const read = (path) => readFileSync(join(src, 'src', path), 'utf8');
const write = (path, text) => {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), header(path) + text);
};
const replaceOnce = (text, from, to, path) => {
  if (!text.includes(from)) throw new Error(`${path}: expected to find ${from}`);
  return text.replace(from, to);
};
const lineIndex = (lines, needle, from = 0) => {
  const i = lines.findIndex((l, n) => n >= from && l.includes(needle));
  if (i < 0) throw new Error(`not found: ${needle}`);
  return i;
};

for (const path of FILES) {
  let text = read(path);
  if (path === 'helpers.ts') {
    text = replaceOnce(
      text,
      "export { fromBase64 as bytesFromBase64, toBase64 as base64FromBytes } from '@interchainjs/encoding';",
      "import { base64 } from '@scure/base';\n\nexport const bytesFromBase64 = (b64: string): Uint8Array => base64.decode(b64);\nexport const base64FromBytes = (arr: Uint8Array): string => base64.encode(arr);",
      path,
    );
  }
  if (path === 'cosmos/base/v1beta1/coin.ts') {
    text = replaceOnce(
      text,
      'import { Decimal } from "@interchainjs/math";',
      'import { Decimal } from "../../../decimal";',
      path,
    );
  }
  if (path === 'bze/cointrunk/params.ts') {
    text = replaceOnce(
      text,
      'import { Decimal } from "@interchainjs/math";',
      'import { Decimal } from "../../decimal";',
      path,
    );
  }
  write(path, text);
}

// gov v1: VoteOption enum + helpers.
const gov = read(GOV).split('\n');
const govStart = lineIndex(gov, '/** VoteOption enumerates');
const govEnd = lineIndex(gov, '/** ProposalStatus enumerates');
write(GOV, gov.slice(govStart, govEnd).join('\n') + '\n');

// gov v1: MsgVote, MsgDeposit and their responses.
const tx = read(GOV_TX).split('\n');
const govRange = (from, to) => {
  const start = lineIndex(tx, from);
  return tx.slice(start, lineIndex(tx, to, start));
};
const govDoc = (from, to) => {
  const start = lineIndex(tx, from) - 1;
  return tx.slice(start, lineIndex(tx, to, start) - 1);
};
const govTx = [
  'import { Coin, type CoinAmino, type CoinSDKType } from "../../base/v1beta1/coin";',
  'import { VoteOption, voteOptionFromJSON, voteOptionToJSON } from "./gov";',
  'import { BinaryReader, BinaryWriter } from "../../../binary";',
  'import { GlobalDecoderRegistry } from "../../../registry";',
  'import { isSet } from "../../../helpers";',
  ...govDoc(
    ' * MsgVote defines a message to cast a vote.',
    ' * MsgVoteWeighted defines a message to cast a vote.',
  ),
  ...govDoc(
    ' * MsgDeposit defines a message to submit a deposit',
    ' * MsgUpdateParams is the Msg/UpdateParams request type.',
  ),
  ...govRange('function createBaseMsgVote(): MsgVote {', 'function createBaseMsgVoteWeighted()'),
  ...govRange(
    'function createBaseMsgDeposit(): MsgDeposit {',
    'function createBaseMsgUpdateParams()',
  ),
].join('\n');
write(GOV_TX, govTx + '\n');

// Slices of a generated tx file: for each kept range, the interfaces from one doc comment up to
// another, and the implementations from one createBase function up to another (`null`: to the
// end of the file). Keeps the `//@ts-nocheck` line.
const slice = (path, imports, ...ranges) => {
  const lines = read(path).split('\n');
  if (lines[0] !== '//@ts-nocheck') throw new Error(`${path}: expected //@ts-nocheck first`);
  const ifaces = [];
  const impls = [];
  for (const [[ifaceFrom, ifaceTo], [implFrom, implTo]] of ranges) {
    const iStart = lineIndex(lines, ifaceFrom) - 1;
    // A doc comment starts one line above its first text line; a function starts on its own.
    const iEnd = lineIndex(lines, ifaceTo, iStart) - (ifaceTo.startsWith('function ') ? 0 : 1);
    const mStart = lineIndex(lines, implFrom);
    const mEnd = implTo === null ? lines.length : lineIndex(lines, implTo, mStart);
    ifaces.push(...lines.slice(iStart, iEnd));
    impls.push(...lines.slice(mStart, mEnd));
  }
  write(path, [lines[0], ...imports, ...ifaces, ...impls].join('\n').trimEnd() + '\n');
};

// staking: MsgDelegate, MsgBeginRedelegate, MsgUndelegate, MsgCancelUnbondingDelegation and
// their responses.
slice(
  STAKING_TX,
  [
    'import { Coin, CoinAmino, CoinSDKType } from "../../base/v1beta1/coin";',
    'import { Timestamp } from "../../../google/protobuf/timestamp";',
    'import { BinaryReader, BinaryWriter } from "../../../binary";',
    'import { GlobalDecoderRegistry } from "../../../registry";',
    'import { toTimestamp, fromTimestamp } from "../../../helpers";',
  ],
  [
    [' * MsgDelegate defines a SDK message', ' * MsgUpdateParams is the Msg/UpdateParams'],
    ['function createBaseMsgDelegate(): MsgDelegate {', 'function createBaseMsgUpdateParams()'],
  ],
);

// distribution: MsgSetWithdrawAddress, MsgWithdrawDelegatorReward, MsgFundCommunityPool,
// MsgDepositValidatorRewardsPool and their responses.
slice(
  DISTRIBUTION_TX,
  [
    'import { Coin, CoinAmino, CoinSDKType } from "../../base/v1beta1/coin";',
    'import { BinaryReader, BinaryWriter } from "../../../binary";',
    'import { GlobalDecoderRegistry } from "../../../registry";',
  ],
  [
    [' * MsgSetWithdrawAddress sets', ' * MsgWithdrawValidatorCommission withdraws'],
    [
      'function createBaseMsgSetWithdrawAddress(): MsgSetWithdrawAddress {',
      'function createBaseMsgWithdrawValidatorCommission()',
    ],
  ],
  [
    [' * MsgFundCommunityPool allows an account', ' * MsgUpdateParams is the Msg/UpdateParams'],
    [
      'function createBaseMsgFundCommunityPool(): MsgFundCommunityPool {',
      'function createBaseMsgUpdateParams()',
    ],
  ],
  [
    [
      ' * DepositValidatorRewardsPool defines the request',
      'function createBaseMsgSetWithdrawAddress()',
    ],
    ['function createBaseMsgDepositValidatorRewardsPool(): MsgDepositValidatorRewardsPool {', null],
  ],
);
console.log(`copied from @bze/bzejs ${version}`);
