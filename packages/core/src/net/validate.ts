import { base64ToBytes } from './base64';
import { UnexpectedResponseError } from './errors';

/** Hand-written response validators: each takes the value and its dotted path. */

export function parseJson(text: string, path = '$'): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new UnexpectedResponseError(path, 'body is not valid JSON');
  }
}

export function join(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${String(key)}]`;
  return path === '$' ? key : `${path}.${key}`;
}

export function object(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new UnexpectedResponseError(path, 'expected an object');
  return v as Record<string, unknown>;
}

export function field(o: Record<string, unknown>, key: string, path: string): unknown {
  if (!(key in o)) throw new UnexpectedResponseError(join(path, key), 'missing field');
  return o[key];
}

export function array(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new UnexpectedResponseError(path, 'expected an array');
  return v as unknown[];
}

export function string(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new UnexpectedResponseError(path, 'expected a string');
  return v;
}

export function boolean(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new UnexpectedResponseError(path, 'expected a boolean');
  return v;
}

export function safeInteger(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v))
    throw new UnexpectedResponseError(path, 'expected an integer');
  return v;
}

/** An unsigned integer sent as a decimal string (protobuf JSON for 64-bit and Int values). */
export function uintString(v: unknown, path: string): bigint {
  if (typeof v !== 'string' || !/^\d+$/.test(v))
    throw new UnexpectedResponseError(path, 'expected an unsigned integer string');
  return BigInt(v);
}

/** A signed integer sent as a decimal string. */
export function intString(v: unknown, path: string): bigint {
  if (typeof v !== 'string' || !/^-?\d+$/.test(v))
    throw new UnexpectedResponseError(path, 'expected an integer string');
  return BigInt(v);
}

/** A non-negative decimal string such as a gas price; kept as the string. */
export function decimalString(v: unknown, path: string): string {
  if (typeof v !== 'string' || !/^\d+(\.\d+)?$/.test(v))
    throw new UnexpectedResponseError(path, 'expected a decimal string');
  return v;
}

export function base64(v: unknown, path: string): Uint8Array {
  const bytes = base64ToBytes(string(v, path));
  if (bytes === null) throw new UnexpectedResponseError(path, 'expected base64');
  return bytes;
}

export function nullable<T>(
  v: unknown,
  path: string,
  read: (v: unknown, path: string) => T,
): T | null {
  return v === null ? null : read(v, path);
}

export function arrayOf<T>(
  v: unknown,
  path: string,
  read: (item: unknown, path: string) => T,
): T[] {
  return array(v, path).map((item, i) => read(item, join(path, i)));
}
