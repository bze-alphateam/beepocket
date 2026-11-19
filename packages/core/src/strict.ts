import { codecFor, isAnyLike, MAX_ANY_DEPTH } from './codecs';
import { TxBody } from './proto/cosmos/tx/v1beta1/tx';
import type { AnyMsg } from './tx';

/**
 * Integer fields the chain reads as `math.Int`, by message type; it may read forms other than
 * plain decimals differently. A path step that is an array applies to each item. `Coin` amounts are
 * checked wherever they appear, so they are not listed. Prices are base-10 decimals and are
 * not integer fields.
 */
const INTEGER_FIELDS: Readonly<Record<string, readonly string[]>> = {
  '/bze.tradebin.MsgCreateOrder': ['amount'],
  '/bze.tradebin.MsgFillOrders': ['orders.amount'],
  '/bze.tradebin.MsgCreateLiquidityPool': ['initialBase', 'initialQuote'],
  '/bze.tradebin.MsgAddLiquidity': ['baseAmount', 'quoteAmount', 'minLpTokens'],
  '/bze.tradebin.MsgRemoveLiquidity': ['lpTokens', 'minBase', 'minQuote'],
  '/bze.rewards.MsgCreateStakingReward': ['prizeAmount', 'minStake'],
  '/bze.rewards.MsgCreateTradingReward': ['prizeAmount'],
  '/bze.rewards.MsgJoinStaking': ['amount'],
  '/bze.rewards.MsgDistributeStakingRewards': ['amount'],
  '/bze.rewards.MsgJoinDenomReward': ['amount'],
  '/bze.rewards.MsgCreateDenomRewardSchedule': ['dailyAmount'],
  '/bze.rewards.MsgDistributeDenomRewards': ['amount'],
  '/bze.burner.MsgStartRaffle': ['pot', 'duration', 'chances', 'ticketPrice'],
  '/bze.guardian.v1.MsgTightenRateLimit': ['maxPercentSend', 'maxPercentRecv'],
};

/** A whole number in plain decimal: no sign, no prefix, no separators, no leading zero. */
const PLAIN_UINT = /^(0|[1-9][0-9]*)$/;

/** Empty means absent, which the message summary reports on its own. */
const plainInteger = (raw: string): boolean => raw === '' || PLAIN_UINT.test(raw);

/** Nested sub-messages compared field by field before giving up. */
const MAX_FIELD_DEPTH = 32;

interface WireField {
  no: number;
  wireType: number;
  /** The whole field: tag, length (if any) and value. */
  raw: Uint8Array;
  /** Length-delimited only: the value without its tag and length. */
  payload: Uint8Array | null;
  /** The tag and the length are written in the fewest bytes. */
  minimal: boolean;
}

/** Reads a varint at `pos`: its value (exact up to 2^53) and where it ends; null when bad. */
function readVarint(buf: Uint8Array, pos: number): { value: number; end: number } | null {
  let value = 0;
  let scale = 1;
  for (let i = pos; i < buf.length && i < pos + 10; i += 1) {
    const byte = buf[i] ?? 0;
    value += (byte & 0x7f) * scale;
    scale *= 128;
    if ((byte & 0x80) === 0) return { value, end: i + 1 };
  }
  return null;
}

/** A varint is as short as it can be when it is one byte or its last byte is not zero. */
const shortest = (buf: Uint8Array, start: number, end: number): boolean =>
  end - start === 1 || buf[end - 1] !== 0;

/** The top-level fields of a protobuf message, in order; null when the bytes are not one. */
function wireFields(buf: Uint8Array): WireField[] | null {
  const fields: WireField[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const start = pos;
    const tag = readVarint(buf, pos);
    if (!tag || tag.value > 0xffffffff) return null;
    const no = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (no === 0) return null;
    let minimal = shortest(buf, start, tag.end);
    pos = tag.end;
    let payload: Uint8Array | null = null;
    if (wireType === 0) {
      const v = readVarint(buf, pos);
      if (!v) return null;
      pos = v.end;
    } else if (wireType === 1 || wireType === 5) {
      pos += wireType === 1 ? 8 : 4;
    } else if (wireType === 2) {
      const len = readVarint(buf, pos);
      if (!len) return null;
      minimal &&= shortest(buf, pos, len.end);
      pos = len.end + len.value;
      if (pos > buf.length) return null;
      payload = buf.subarray(len.end, pos);
    } else {
      return null;
    }
    if (pos > buf.length) return null;
    fields.push({ no, wireType, raw: buf.subarray(start, pos), payload, minimal });
  }
  return fields;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Whether `input` is the wallet's own encoding (`reencoded`) of what it decoded, field for
 * field. The one difference allowed: a sub-message the input leaves out, which the decoder
 * fills in with its empty default (the chain reads the missing field the same way).
 * Everything else (a field sent twice, a field the wallet does not know, a number or length
 * written in more bytes than needed, fields out of order) does not match.
 */
function sameEncoding(input: Uint8Array, reencoded: Uint8Array, depth = 0): boolean {
  if (sameBytes(input, reencoded)) return true;
  if (depth >= MAX_FIELD_DEPTH) return false;
  const ours = wireFields(input);
  const theirs = wireFields(reencoded);
  if (!ours || !theirs) return false;
  const present = new Set(ours.map((f) => f.no));
  const expected = theirs.filter((f) => present.has(f.no));
  if (expected.length !== ours.length) return false;
  return ours.every((a, i) => {
    const b = expected[i];
    if (!b) return false;
    if (sameBytes(a.raw, b.raw)) return true;
    return (
      a.no === b.no &&
      a.wireType === 2 &&
      b.wireType === 2 &&
      a.minimal &&
      a.payload !== null &&
      b.payload !== null &&
      sameEncoding(a.payload, b.payload, depth + 1)
    );
  });
}

/** The values at `path` (dot-separated keys; arrays apply the rest of the path to each item). */
function valuesAt(value: unknown, path: readonly string[]): unknown[] {
  if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, path));
  const [key, ...rest] = path;
  if (key === undefined) return [value];
  if (typeof value !== 'object' || value === null) return [];
  return valuesAt((value as Record<string, unknown>)[key], rest);
}

const isCoinLike = (v: object): v is { denom: string; amount: string } =>
  Object.keys(v).length === 2 &&
  'denom' in v &&
  typeof v.denom === 'string' &&
  'amount' in v &&
  typeof v.amount === 'string';

/**
 * Why one message (and every message nested in it) is refused, or null. `depth` counts
 * nested `Any` levels. Types without a codec stay opaque: they are summarised as unknown.
 */
function messageProblem(msg: AnyMsg, depth: number): string | null {
  if (depth > MAX_ANY_DEPTH) return 'A message is nested too deeply';
  const codec = codecFor(msg.typeUrl);
  if (!codec) return null;
  let decoded: unknown;
  let reencoded: Uint8Array;
  try {
    decoded = codec.decode(msg.value);
    reencoded = codec.encode(decoded as never).finish();
  } catch {
    return 'A message in the transaction cannot be read';
  }
  if (!sameEncoding(msg.value, reencoded))
    return 'A message in the transaction is not encoded the standard way';
  for (const path of INTEGER_FIELDS[msg.typeUrl] ?? []) {
    for (const v of valuesAt(decoded, path.split('.'))) {
      if (typeof v === 'string' && !plainInteger(v))
        return 'An amount in the transaction is not a plain whole number';
    }
  }
  return nestedProblem(decoded, depth);
}

/** Checks the coins and nested messages inside a decoded message. */
function nestedProblem(value: unknown, depth: number): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if (value instanceof Uint8Array || value instanceof Date) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const problem = nestedProblem(item, depth);
      if (problem) return problem;
    }
    return null;
  }
  if (isAnyLike(value)) return messageProblem(value, depth + 1);
  if (isCoinLike(value) && !plainInteger(value.amount))
    return 'An amount in the transaction is not a plain whole number';
  for (const v of Object.values(value)) {
    const problem = nestedProblem(v, depth);
    if (problem) return problem;
  }
  return null;
}

/**
 * Why a sign request's body is refused under the strict encoding rules, or null when it
 * passes. The body and every message the wallet can read must be exactly the bytes the
 * wallet's own encoders would write for what it shows; integer amounts must be plain
 * decimals; text must be valid UTF-8; nested messages go at most `MAX_ANY_DEPTH` deep. A
 * request that passes means the same thing to the wallet and to the chain.
 *
 * This is the single place these rules are applied.
 */
export function strictEncodingProblem(bodyBytes: Uint8Array, messages: AnyMsg[]): string | null {
  let reencoded: Uint8Array;
  try {
    reencoded = TxBody.encode(TxBody.decode(bodyBytes)).finish();
  } catch {
    return 'The transaction body cannot be read';
  }
  if (!sameEncoding(bodyBytes, reencoded))
    return 'The transaction body is not encoded the standard way';
  for (const msg of messages) {
    const problem = messageProblem(msg, 0);
    if (problem) return problem;
  }
  return null;
}
