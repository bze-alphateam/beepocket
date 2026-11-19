#!/usr/bin/env bash
# Regenerates the golden transaction fixtures in packages/core/test/fixtures/golden/ with the
# real `bzed` binary (needs `bzed` on PATH; the bank sends were made with v8.2.0 and are unchanged
# with v8.3.0, the BZE module messages in golden-msgs/ were made with v8.3.0-rc1). Everything runs
# offline against a throwaway keyring holding the public test mnemonic ("abandon" x23 + "art").
# Never use a real key here. Re-running must produce identical files.
set -euo pipefail

BZED=${BZED:-bzed}
CHAIN_ID=beezee-1
ACCOUNT_NUMBER=7
SEQUENCE=3
GAS=200000
# A fee in another token pays for its swap to ubze: the wallet signs 1.5x the native limit.
FOREIGN_GAS=300000
ADDR1=bze1vtad8680vhdfqvxx0f2yaxa6agdylelm92sm6p
FACTORY=factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl

fixtures="$(cd "$(dirname "$0")/.." && pwd)/packages/core/test/fixtures"
out="$fixtures/golden"
home=$(mktemp -d)
work=$(mktemp -d)
trap 'rm -rf "$home" "$work"' EXIT
mkdir -p "$out" "$fixtures/golden-msgs"

mnemonic="$(printf 'abandon %.0s' $(seq 23))art"
keyring=(--keyring-backend test --home "$home")
echo "$mnemonic" | "$BZED" keys add signer --recover "${keyring[@]}" >/dev/null 2>&1
pubkey=$("$BZED" keys show signer "${keyring[@]}" --output json | jq -r '.pubkey | fromjson | .key')
addr0=$("$BZED" keys show signer -a "${keyring[@]}")

# unsigned <file> <fees> <note> <send-args...>: one bank send, unsigned, to <file>.
# The gas limit is $GAS unless the caller sets `gas`.
unsigned() {
  local file=$1 fees=$2 note=$3
  shift 3
  "$BZED" tx bank send signer "$@" --generate-only --chain-id "$CHAIN_ID" --gas "${gas:-$GAS}" \
    --fees "$fees" --note "$note" "${keyring[@]}" >"$file"
}

# finish <name> <description> <unsigned-file>: sign, encode, write the fixture to $out.
# Bank sends keep their messages in the wallet's MsgSend shape; with `raw_messages` set, the
# messages are written as bzed prints them (the module messages in golden-msgs/).
finish() {
  local name=$1 description=$2 file=$3
  "$BZED" tx sign "$file" --from signer --offline --sign-mode direct \
    --account-number "$ACCOUNT_NUMBER" --sequence "$SEQUENCE" --chain-id "$CHAIN_ID" \
    "${keyring[@]}" >"$work/signed.json"
  local raw
  raw=$("$BZED" tx encode "$work/signed.json" "${keyring[@]}")
  # Split the TxRaw (body, auth info, signature) without any of our own code.
  local parts
  parts=$(node -e '
    const raw = Buffer.from(process.argv[1], "base64");
    let i = 0;
    const varint = () => { let v = 0, s = 0, b; do { b = raw[i++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
    const fields = {};
    while (i < raw.length) {
      const tag = varint();
      const len = varint();
      fields[tag >> 3] = raw.subarray(i, i + len).toString("base64");
      i += len;
    }
    console.log(JSON.stringify({ body: fields[1], authInfo: fields[2], signature: fields[3] }));
  ' "$raw")
  jq -S -n \
    --arg name "$name" --arg description "$description" \
    --arg chainId "$CHAIN_ID" --arg accountNumber "$ACCOUNT_NUMBER" --arg sequence "$SEQUENCE" \
    --arg pubKey "$pubkey" --arg signer "$addr0" --arg raw "$raw" \
    --slurpfile tx "$work/signed.json" --argjson parts "$parts" \
    --arg raw_messages "${raw_messages:-}" '
    {
      name: $name,
      description: $description,
      signerIndex: 0,
      signer: $signer,
      pubKey: $pubKey,
      chainId: $chainId,
      accountNumber: $accountNumber,
      sequence: $sequence,
      gasLimit: $tx[0].auth_info.fee.gas_limit,
      fee: $tx[0].auth_info.fee.amount,
      memo: $tx[0].body.memo,
      messages: (if $raw_messages == "" then [$tx[0].body.messages[] | {
        typeUrl: ."@type", fromAddress: .from_address, toAddress: .to_address, amount: .amount }]
        else $tx[0].body.messages end),
      bodyBytes: $parts.body,
      authInfoBytes: $parts.authInfo,
      signature: $parts.signature,
      txRaw: $raw
    }' >"$out/$name.json"
  echo "wrote $name.json"
}

unsigned "$work/a.json" 2000ubze "" "$ADDR1" 1000000ubze
finish send-ubze "bank send of 1,000,000 ubze, no memo, fee in ubze" "$work/a.json"

unsigned "$work/b.json" 2000ubze "thanks for lunch" "$ADDR1" 1000000ubze
finish send-ubze-memo "bank send of 1,000,000 ubze with a memo" "$work/b.json"

unsigned "$work/c.json" 2000ubze "" "$ADDR1" 250000"$FACTORY"
finish send-factory-denom "bank send of a factory denom" "$work/c.json"

gas=$FOREIGN_GAS unsigned "$work/d.json" 7858"$FACTORY" "" "$ADDR1" 1000000ubze
finish fee-non-native "bank send with the fee paid in a factory denom" "$work/d.json"

unsigned "$work/e1.json" 2000ubze "" "$ADDR1" 1000000ubze
unsigned "$work/e2.json" 2000ubze "" "$ADDR1" 250000"$FACTORY"
jq -c '.body.messages += input.body.messages' "$work/e1.json" "$work/e2.json" >"$work/e.json"
finish two-messages "two bank sends in one transaction (ubze and a factory denom)" "$work/e.json"

# module <name> <description> <message-json>: one module message signed by the test key. bzed has
# no offline builder for every message, so the message replaces the one of an unsigned send.
module() {
  local name=$1 description=$2 msg=$3
  unsigned "$work/m.json" 2000ubze "" "$ADDR1" 1ubze
  jq -c --argjson msg "$msg" '.body.messages = [$msg]' "$work/m.json" >"$work/m2.json"
  out="$fixtures/golden-msgs" raw_messages=1 finish "$name" "$description" "$work/m2.json"
}

module dao-vote "a DAO vote: yes on proposal 4" "$(jq -nc --arg v "$addr0" \
  '{"@type": "/bze.dao.MsgVote", voter: $v, proposal_id: "4", option: "YES"}')"

module dao-submit-proposal "a DAO proposal that sends 5,000,000 ubze from the DAO" "$(jq -nc \
  --arg p "$addr0" --arg dao "$ADDR1" '{
    "@type": "/bze.dao.MsgSubmitProposal", proposer: $p, dao_id: "2", title: "Fund the meetup",
    summary: "Pay the venue", expedited: false,
    msgs: [{"@type": "/cosmos.bank.v1beta1.MsgSend", from_address: $dao, to_address: $p,
      amount: [{denom: "ubze", amount: "5000000"}]}]}')"

module set-denom-config "token fees for a factory denom: 1% transfer fee, 0.5 gas surcharge" "$(jq -nc \
  --arg c "$addr0" --arg d "$FACTORY" --arg pool "$ADDR1" '{
    "@type": "/bze.tokenfactory.MsgSetDenomConfig", creator: $c, denom: $d, community_pool: $pool,
    transfer_fee: "0.010000000000000000", gas_surcharge: "0.500000000000000000"}')"
