import { isBzeAddress } from '@beepocket/core';

export interface ProfileAddress {
  index: number;
  label: string;
  /** Public, cached so a weak-locked wallet can list addresses without the recovery phrase. */
  address: string;
  /**
   * Base64 of the 33-byte compressed secp256k1 public key. Public like the address; it lets a
   * dapp's `getKey` answer in weak lock. Profiles from before dapps lack it until the next unlock.
   */
  pubKey?: string;
}

/** A site (an origin) connected on one network: the one address it may see. */
export interface ConnectedSite {
  address: string;
  /** Epoch ms. */
  connectedAt: number;
}

export type SitesByOrigin = Record<string, ConnectedSite>;

export interface Profile {
  v: 1;
  addresses: ProfileAddress[];
  /** Owned by the address book story. */
  addressBook: unknown[];
  /** Owned by the token story. */
  preferredTokens: { mainnet: string[]; testnet: string[] };
  /** Connected sites per network, keyed by origin. */
  sites: { mainnet: SitesByOrigin; testnet: SitesByOrigin };
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

/** Standard base64 of exactly 33 bytes. */
export function validPubKey(x: unknown): x is string {
  if (typeof x !== 'string' || !/^[A-Za-z0-9+/]{44}$/.test(x)) return false;
  try {
    return atob(x).length === 33;
  } catch {
    return false;
  }
}

/** An origin is its own canonical form: `new URL(origin).origin === origin`. */
export function isCanonicalOrigin(x: string): boolean {
  try {
    return new URL(x).origin === x;
  } catch {
    return false;
  }
}

function validSites(x: unknown, addresses: ProfileAddress[]): x is SitesByOrigin {
  if (!isObject(x)) return false;
  const owned = new Set(addresses.map((a) => a.address));
  return Object.entries(x).every(
    ([origin, site]) =>
      isCanonicalOrigin(origin) &&
      isObject(site) &&
      typeof site.address === 'string' &&
      owned.has(site.address) &&
      typeof site.connectedAt === 'number' &&
      Number.isFinite(site.connectedAt),
  );
}

/**
 * Drops connected-site entries that are not valid (not canonical origin, unknown address,
 * wrong shape). A bad site entry is never fatal for the profile; everything else is untouched.
 */
export function dropInvalidSites(p: unknown): unknown {
  if (!isObject(p) || !isObject(p.sites) || !Array.isArray(p.addresses)) return p;
  const addresses = p.addresses.filter(isObject) as unknown as ProfileAddress[];
  const clean = (x: unknown): SitesByOrigin => {
    if (!isObject(x)) return {};
    return Object.fromEntries(
      Object.entries(x).filter(([origin, site]) => validSites({ [origin]: site }, addresses)),
    ) as SitesByOrigin;
  };
  return { ...p, sites: { mainnet: clean(p.sites.mainnet), testnet: clean(p.sites.testnet) } };
}

function validAddresses(x: unknown): x is ProfileAddress[] {
  if (!Array.isArray(x) || x.length === 0) return false;
  const seen = new Set<number>();
  for (const a of x as unknown[]) {
    if (!isObject(a)) return false;
    const { index, label, address, pubKey } = a;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || seen.has(index)) {
      return false;
    }
    if (typeof label !== 'string' || label.length < 1 || label.length > MAX_LABEL_LENGTH) {
      return false;
    }
    if (typeof address !== 'string' || !isBzeAddress(address)) return false;
    if (pubKey !== undefined && !validPubKey(pubKey)) return false;
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
    validSites(sites.mainnet, p.addresses) &&
    validSites(sites.testnet, p.addresses) &&
    validSettings(p.settings)
  );
}
