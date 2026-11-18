import { base64 } from '@scure/base';
import { codecFor, isAnyLike, MAX_ANY_DEPTH, typeUrlsWithCodec } from './codecs';
import type { AnyMsg } from './tx';
import { AuthInfo, TxBody } from './proto/cosmos/tx/v1beta1/tx';

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type DecodedAny =
  { typeUrl: string; value: Record<string, Json> } | { typeUrl: string; unknown: true };

/** The type URLs `decodeAny` understands. */
export function knownTypeUrls(): string[] {
  return typeUrlsWithCodec();
}

function toJson(v: unknown, depth: number): Json {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return base64.encode(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (Array.isArray(v)) return v.map((item) => toJson(item, depth));
  if (typeof v === 'object' && v !== null) {
    if (isAnyLike(v)) return decodeAt(v, depth + 1);
    const out: Record<string, Json> = {};
    for (const [k, val] of Object.entries(v)) {
      if (val !== undefined) out[k] = toJson(val, depth);
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
  return decodeAt(msg, 0);
}

function decodeAt(msg: AnyMsg, depth: number): DecodedAny {
  const codec = depth > MAX_ANY_DEPTH ? undefined : codecFor(msg.typeUrl);
  if (!codec) return { typeUrl: msg.typeUrl, unknown: true };
  const value = toJson(codec.decode(msg.value), depth);
  return { typeUrl: msg.typeUrl, value: value as Record<string, Json> };
}

export function decodeTxBody(bytes: Uint8Array): Record<string, Json> {
  return toJson(TxBody.decode(bytes), 0) as Record<string, Json>;
}

export function decodeAuthInfo(bytes: Uint8Array): Record<string, Json> {
  return toJson(AuthInfo.decode(bytes), 0) as Record<string, Json>;
}
