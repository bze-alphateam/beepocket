import { isBzeAddress } from '@beepocket/core';

export interface ProfileAddress {
  index: number;
  label: string;
  /** Public, cached so a weak-locked wallet can list addresses without the recovery phrase. */
  address: string;
}

export interface Profile {
  v: 1;
  addresses: ProfileAddress[];
  /** Owned by the address book story. */
  addressBook: unknown[];
  /** Owned by the token story. */
  preferredTokens: { mainnet: string[]; testnet: string[] };
  /** Reserved for connected sites; nothing is built on it here. */
  sites: { mainnet: Record<string, unknown>; testnet: Record<string, unknown> };
  settings: ProfileSettings;
}

export interface ProfileSettings {
  brandThemes: boolean;
  weakLockMinutes: number;
  fullLockMinutes: number;
}

export const DEFAULT_SETTINGS: ProfileSettings = {
  brandThemes: true,
  weakLockMinutes: 15,
  fullLockMinutes: 60,
};

export const MAX_LOCK_MINUTES = 7 * 24 * 60;
export const MAX_LABEL_LENGTH = 32;

export function defaultLabel(index: number): string {
  return index === 0 ? 'Main' : `Address ${String(index + 1)}`;
}

export function newProfile(addresses: ProfileAddress[]): Profile {
  return {
    v: 1,
    addresses,
    addressBook: [],
    preferredTokens: { mainnet: [], testnet: [] },
    sites: { mainnet: {}, testnet: {} },
    settings: { ...DEFAULT_SETTINGS },
  };
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isLockMinutes(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_LOCK_MINUTES;
}

/** Settings rules shared by loading and saving: whole minutes, full lock not before weak lock. */
export function validSettings(s: unknown): s is ProfileSettings {
  return (
    isObject(s) &&
    typeof s.brandThemes === 'boolean' &&
    isLockMinutes(s.weakLockMinutes) &&
    isLockMinutes(s.fullLockMinutes) &&
    s.fullLockMinutes >= s.weakLockMinutes
  );
}

function stringList(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((t) => typeof t === 'string');
}

function validAddresses(x: unknown): x is ProfileAddress[] {
  if (!Array.isArray(x) || x.length === 0) return false;
  const seen = new Set<number>();
  for (const a of x as unknown[]) {
    if (!isObject(a)) return false;
    const { index, label, address } = a;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || seen.has(index)) {
      return false;
    }
    if (typeof label !== 'string' || label.length < 1 || label.length > MAX_LABEL_LENGTH) {
      return false;
    }
    if (typeof address !== 'string' || !isBzeAddress(address)) return false;
    seen.add(index);
  }
  return true;
}

/** Decrypted data is still untrusted: any other version or shape is rejected, never trusted. */
export function validProfile(p: unknown): p is Profile {
  if (!isObject(p) || p.v !== 1) return false;
  const tokens = p.preferredTokens;
  const sites = p.sites;
  return (
    validAddresses(p.addresses) &&
    Array.isArray(p.addressBook) &&
    isObject(tokens) &&
    stringList(tokens.mainnet) &&
    stringList(tokens.testnet) &&
    isObject(sites) &&
    isObject(sites.mainnet) &&
    isObject(sites.testnet) &&
    validSettings(p.settings)
  );
}
