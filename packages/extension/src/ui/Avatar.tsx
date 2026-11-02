import { isHexColor } from '../theme';
import { Icon, type IconName } from './icons';

export interface AvatarProps {
  /** Symbol, name or origin; the first letter is shown. */
  label: string;
  /**
   * - `token`: a disc in the token's colour (the default).
   * - `contact`: a disc in the kit's soft accent, for address-book entries.
   * - `site`: a rounded square in the site's colour, for dapps.
   */
  kind?: 'token' | 'contact' | 'site' | undefined;
  /** `#RRGGBB` from chain or site data; anything else falls back to the kit primary. */
  color?: string | undefined;
  /** A logo image URL (token logos come later); the letter shows when absent. */
  src?: string | undefined;
  /** Diameter in px: 32 by default (18 fee dot, 26 send header, 30 lists, 40 sites). */
  size?: number | undefined;
}

/** A letter disc for a token, a contact or a site. Always decorative: the row names it. */
export function Avatar({ label, kind = 'token', color, src, size = 32 }: AvatarProps) {
  const style: Record<string, string> = {
    width: `${String(size)}px`,
    height: `${String(size)}px`,
    'font-size': `${String(Math.round(size * 0.4))}px`,
  };
  if (kind !== 'contact') style.background = isHexColor(color) ? color : 'var(--bp-primary)';
  return (
    <span class={`bp-avatar bp-avatar-${kind}`} style={style} aria-hidden="true">
      {src === undefined ? (label.trim()[0] ?? '?').toUpperCase() : <img src={src} alt="" />}
    </span>
  );
}

export interface IconTileProps {
  icon: IconName;
  /** `soft`: kit accent (Ob-Start code card). `inset`: neutral (manual card, empty activity). */
  tone?: 'soft' | 'inset' | 'ok' | 'bad' | undefined;
  /** Square size in px: 36 by default (44 and 52 for empty states). */
  size?: number | undefined;
  iconSize?: number | undefined;
}

/** A rounded square holding an icon: activity kinds, option cards, empty states. */
export function IconTile({ icon, tone = 'soft', size = 36, iconSize }: IconTileProps) {
  return (
    <span
      class={`bp-icon-tile bp-icon-tile-${tone}`}
      style={{
        width: `${String(size)}px`,
        height: `${String(size)}px`,
        'border-radius': `${String(size >= 52 ? 16 : size >= 44 ? 12 : 10)}px`,
      }}
      aria-hidden="true"
    >
      <Icon name={icon} size={iconSize ?? Math.round(size / 2)} />
    </span>
  );
}
