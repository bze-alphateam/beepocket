import type { ComponentChildren } from 'preact';
import { Avatar } from './Avatar';
import { Icon } from './icons';

export interface SiteCardProps {
  /** The site's origin as the browser reported it, shown in full after the lock. */
  origin: string;
  /** `lg`: the 44 px avatar of a connect request. `sm`: the 32 px one of sign and add-a-token. */
  size?: 'lg' | 'sm' | undefined;
  /** Right column: "Signs with **Main**" or "sent you here". */
  aside?: ComponentChildren;
}

/** The host of an origin, or the origin itself when it does not parse. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname || origin;
  } catch {
    return origin;
  }
}

/**
 * The site a request comes from: a letter avatar, its host and, after a lock, the full origin.
 * Only the browser's origin is shown; nothing the site says about itself.
 */
export function SiteCard({ origin, size = 'sm', aside }: SiteCardProps) {
  const host = hostOf(origin);
  return (
    <div class={`bp-site-card bp-site-card-${size}`}>
      <Avatar label={host} kind="site" size={size === 'lg' ? 44 : 32} />
      <span class="bp-site-card-text">
        <span class="bp-site-card-name">{host}</span>
        <span class="bp-site-card-origin">
          <Icon name="lock" size={size === 'lg' ? 12 : 11} strokeWidth={2.2} />
          <span>{origin}</span>
        </span>
      </span>
      {aside !== undefined && <span class="bp-site-card-aside">{aside}</span>}
    </div>
  );
}
