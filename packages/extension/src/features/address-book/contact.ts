import { isBzeAddress } from '@beepocket/core';

export const MAX_NAME_LENGTH = 32;

/** Trimmed, format characters removed; null unless 1–32 code points with a visible one. */
export function normalizeName(name: string): string | null {
  const clean = name.replace(/\p{Cf}/gu, '').trim();
  const length = [...clean].length;
  return length >= 1 && length <= MAX_NAME_LENGTH ? clean : null;
}

/** Trimmed and lower-cased (bech32 may arrive all upper case); null when not a BeeZee address. */
export function normalizeAddress(address: string): string | null {
  const clean = address.trim().toLowerCase();
  return isBzeAddress(clean) ? clean : null;
}

/** Case-folded form for comparing names. */
export function nameKey(name: string): string {
  return name.toLowerCase();
}

/** A stored contact is only trusted when both fields pass the same rules as a new one. */
export function validContact(x: unknown): x is { name: string; address: string } {
  if (typeof x !== 'object' || x === null) return false;
  const { name, address } = x as Record<string, unknown>;
  return (
    typeof name === 'string' &&
    typeof address === 'string' &&
    normalizeName(name) === name &&
    normalizeAddress(address) === address
  );
}
