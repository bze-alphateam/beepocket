/** The Cosmos denom shape; the same check runs in the content script and in the worker. */
const DENOM = /^[a-zA-Z][a-zA-Z0-9/:._-]{2,127}$/;

export const LINK_ORIGIN = 'https://getbze.com';
export const LINK_PATH = '/wallet/add/';
export const LINK_PATTERN = `${LINK_ORIGIN}${LINK_PATH}*`;

/** A token code as the link carries it, or `null` when missing or not a denom. */
export function validCode(value: unknown): string | null {
  return typeof value === 'string' && DENOM.test(value) ? value : null;
}

/** The `https:` origin of a URL, or `null` when it is not one. */
export function httpsOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Only getbze.com and its subdomains are known sites. The referrer is the linking page's word,
 * so this decides how loudly the wallet warns, never what it trusts.
 */
export function isKnownSite(referrer: string): boolean {
  const origin = httpsOrigin(referrer);
  if (origin === null) return false;
  const host = new URL(origin).hostname;
  return host === 'getbze.com' || host.endsWith('.getbze.com');
}

export function hostOf(referrer: string): string | null {
  const origin = httpsOrigin(referrer);
  return origin === null ? null : new URL(origin).host;
}
