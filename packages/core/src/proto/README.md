# Copied protobuf code

Message encoders/decoders for the transaction types BeePocket builds or inspects, copied from
the generated code of [`@bze/bzejs`](https://github.com/bze-alphateam/bzejs) (branch `main-v2`,
version 3.2.0 = chain v8.2.0). The wallet has no runtime dependency on bzejs, cosmjs or any
other package outside `@noble/*`, `@scure/*` and `preact`. Do not edit these files by hand;
correctness is proven byte-for-byte against `bzed` in `../golden.test.ts`.

ESLint and Prettier ignore this directory (generated code). `tsc` includes it, but the files
that carry the original telescope `//@ts-nocheck` line are not type-checked (the trimmed
`cosmos/gov/v1/` files are; the trimmed staking and distribution files keep the line).

## Files

Each file below is copied byte-for-byte from `src/<same path>` in bzejs with one header line
prepended, except where noted. The copied files still import `GlobalDecoderRegistry` from
`registry.ts` and call it; that import resolves to the hand-written stand-in below.

- `binary.ts`, `utf8.ts`, `varint.ts`
- `helpers.ts` (the base64 re-export from `@interchainjs/encoding` is replaced with `@scure/base`)
- `google/protobuf/any.ts`, `google/protobuf/duration.ts`, `google/protobuf/timestamp.ts`
- `cosmos/base/v1beta1/coin.ts` (the `Decimal` import points at the local `decimal.ts`)
- `cosmos/crypto/multisig/v1beta1/multisig.ts`, `cosmos/crypto/secp256k1/keys.ts`
- `cosmos/tx/signing/v1beta1/signing.ts`, `cosmos/tx/v1beta1/tx.ts`
- `cosmos/auth/v1beta1/auth.ts`
- `cosmos/bank/v1beta1/authz.ts`, `cosmos/bank/v1beta1/bank.ts`, `cosmos/bank/v1beta1/tx.ts`
- `cosmos/authz/v1beta1/authz.ts`, `cosmos/authz/v1beta1/tx.ts`
- `cosmos/feegrant/v1beta1/feegrant.ts`, `cosmos/feegrant/v1beta1/tx.ts`
- `cosmos/staking/v1beta1/authz.ts`, `ibc/applications/transfer/v1/authz.ts`
- `bze/burner/params.ts`, `bze/burner/tx.ts`
- `bze/tradebin/v2/params.ts`, `bze/tradebin/tx.ts`
- `bze/rewards/params.ts`, `bze/rewards/tx.ts`
- `bze/tokenfactory/denom_branding.ts`, `bze/tokenfactory/tx.ts`
- `bze/cointrunk/params.ts` (the `Decimal` import points at the local `decimal.ts`),
  `bze/cointrunk/tx.ts`
- `ibc/core/client/v1/client.ts`, `ibc/applications/transfer/v1/tx.ts`
- `cosmos/gov/v1/tx.ts`: trimmed to `MsgVote` and `MsgVoteResponse` (the full file pulls in
  upgrade, distribution, params and cointrunk proposal types)
- `cosmos/gov/v1/gov.ts`: trimmed to the `VoteOption` enum and its JSON helpers
- `cosmos/staking/v1beta1/tx.ts`: trimmed to `MsgDelegate`, `MsgBeginRedelegate`,
  `MsgUndelegate`, `MsgCancelUnbondingDelegation` and their responses (the full file pulls in
  validator, tendermint and pubkey types); keeps the `//@ts-nocheck` line
- `cosmos/distribution/v1beta1/tx.ts`: trimmed to `MsgSetWithdrawAddress`,
  `MsgWithdrawDelegatorReward` and their responses (the full file pulls in the distribution
  params); keeps the `//@ts-nocheck` line

## Hand-written stand-ins

- `registry.ts` replaces bzejs's `GlobalDecoderRegistry`. The copied files call it to register
  themselves and to wrap/unwrap `Any` fields; here registration is a no-op and nested `Any`
  values stay raw `{ typeUrl, value }` pairs that `decodeAny` resolves on demand.
- `decimal.ts` replaces the `Decimal` of `@interchainjs/math` (used by `DecCoin`/`DecProto`).

## Re-copying after a chain upgrade

1. Check out `bze-alphateam/bzejs` branch `main-v2` at the release matching the chain.
2. `node scripts/copy-proto.mjs <path-to-bzejs>` from the repo root (rewrites the files above
   with the new version in the header lines).
3. Regenerate the fixtures with the matching `bzed`: `scripts/gen-golden.sh`.
4. `pnpm check` must stay green; a changed fixture means the encoding changed, so review why.
