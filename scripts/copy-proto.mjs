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
];
// Trimmed on purpose: the full gov v1 files pull in upgrade, distribution, params
// and cointrunk proposal types. Only MsgVote and the VoteOption enum are kept.
const GOV_TX = 'cosmos/gov/v1/tx.ts';
const GOV = 'cosmos/gov/v1/gov.ts';
// Trimmed too: the full staking and distribution tx files pull in validator, tendermint and
// pubkey types. Only the delegation messages and the reward withdrawal are kept.
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

// gov v1: MsgVote + MsgVoteResponse.
const tx = read(GOV_TX).split('\n');
const ifaceStart = lineIndex(tx, ' * MsgVote defines a message to cast a vote.') - 1;
const ifaceEnd = lineIndex(tx, ' * MsgVoteWeighted defines a message to cast a vote.') - 1;
const implStart = lineIndex(tx, 'function createBaseMsgVote(): MsgVote {');
const implEnd = lineIndex(tx, 'function createBaseMsgVoteWeighted()');
const govTx = [
  'import { VoteOption, voteOptionFromJSON, voteOptionToJSON } from "./gov";',
  'import { BinaryReader, BinaryWriter } from "../../../binary";',
  'import { isSet } from "../../../helpers";',
  ...tx.slice(ifaceStart, ifaceEnd),
  ...tx.slice(implStart, implEnd),
].join('\n');
write(GOV_TX, govTx + '\n');

// A slice of a generated tx file: the interfaces from one doc comment up to another, and the
// implementations from one createBase function up to another. Keeps the `//@ts-nocheck` line.
const slice = (path, imports, [ifaceFrom, ifaceTo], [implFrom, implTo]) => {
  const lines = read(path).split('\n');
  const iStart = lineIndex(lines, ifaceFrom) - 1;
  const iEnd = lineIndex(lines, ifaceTo, iStart) - 1;
  const mStart = lineIndex(lines, implFrom);
  const mEnd = lineIndex(lines, implTo, mStart);
  if (lines[0] !== '//@ts-nocheck') throw new Error(`${path}: expected //@ts-nocheck first`);
  const body = [lines[0], ...imports, ...lines.slice(iStart, iEnd), ...lines.slice(mStart, mEnd)];
  write(path, body.join('\n') + '\n');
};

// staking: MsgDelegate, MsgBeginRedelegate, MsgUndelegate and their responses.
slice(
  STAKING_TX,
  [
    'import { Coin, CoinAmino, CoinSDKType } from "../../base/v1beta1/coin";',
    'import { Timestamp } from "../../../google/protobuf/timestamp";',
    'import { BinaryReader, BinaryWriter } from "../../../binary";',
    'import { GlobalDecoderRegistry } from "../../../registry";',
    'import { toTimestamp, fromTimestamp } from "../../../helpers";',
  ],
  [' * MsgDelegate defines a SDK message', ' * MsgCancelUnbondingDelegation defines'],
  [
    'function createBaseMsgDelegate(): MsgDelegate {',
    'function createBaseMsgCancelUnbondingDelegation()',
  ],
);

// distribution: MsgWithdrawDelegatorReward and its response.
slice(
  DISTRIBUTION_TX,
  [
    'import { Coin, CoinAmino, CoinSDKType } from "../../base/v1beta1/coin";',
    'import { BinaryReader, BinaryWriter } from "../../../binary";',
    'import { GlobalDecoderRegistry } from "../../../registry";',
  ],
  [' * MsgWithdrawDelegatorReward represents', ' * MsgWithdrawValidatorCommission withdraws'],
  [
    'function createBaseMsgWithdrawDelegatorReward(): MsgWithdrawDelegatorReward {',
    'function createBaseMsgWithdrawValidatorCommission()',
  ],
);
console.log(`copied from @bze/bzejs ${version}`);
