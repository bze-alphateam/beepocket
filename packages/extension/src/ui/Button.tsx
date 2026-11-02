import type { ComponentChildren } from 'preact';
import { Icon, type IconName } from './icons';

export interface ButtonProps {
  /**
   * - `primary`: kit gradient with glow, full width. `secondary`: outline, full width.
   * - `ghost`: text with an optional icon ("View on Explorer", "Show 1 empty address").
   * - `chip`: small inline button (MAX, Paste). `icon`: 44 × 44 icon-only button (needs `label`).
   * - `quiet` / `danger`: the pre-canvas styles, kept until every screen has moved.
   */
  variant?: 'primary' | 'secondary' | 'ghost' | 'chip' | 'icon' | 'quiet' | 'danger' | undefined;
  /** Primary and secondary height: `md` 44 px (flow screens), `lg` 48 px (Welcome, Unlock). */
  size?: 'md' | 'lg' | undefined;
  /** Ghost text colour: `accent` (default), `muted` or `link` (Explorer links). */
  tone?: 'accent' | 'muted' | 'link' | undefined;
  /** Leading icon; for `icon` buttons the only content. */
  icon?: IconName | undefined;
  /** Icon size in px (default 20 for `icon`, 16 otherwise). */
  iconSize?: number | undefined;
  /** Trailing icon, e.g. `chevron-down` or `external-link`. */
  trailingIcon?: IconName | undefined;
  /** `icon` variant: the round + disc of the Addresses tab instead of a bare icon. */
  round?: boolean | undefined;
  /** Renders a link opened in a new tab instead of a button. */
  href?: string | undefined;
  type?: 'button' | 'submit' | undefined;
  disabled?: boolean | undefined;
  /** Accessible name; required for icon-only buttons. */
  label?: string | undefined;
  pressed?: boolean | undefined;
  expanded?: boolean | undefined;
  onClick?: (() => void) | undefined;
  /** An extra class for a screen hook (tests, layout); never for restyling the kit. */
  class?: string | undefined;
  children?: ComponentChildren | undefined;
}

/** Every button of the kit. */
export function Button({
  variant = 'primary',
  size = 'md',
  tone,
  icon,
  iconSize,
  trailingIcon,
  round = false,
  href,
  type = 'button',
  disabled = false,
  label,
  pressed,
  expanded,
  onClick,
  class: extra,
  children,
}: ButtonProps) {
  const classes = ['bp-btn', `bp-btn-${variant}`];
  if (size === 'lg') classes.push('bp-btn-lg');
  if (variant === 'ghost') classes.push(`bp-tone-${tone ?? 'accent'}`);
  if (round) classes.push('bp-btn-round');
  if (extra !== undefined) classes.push(extra);
  const iconPx = iconSize ?? (variant === 'icon' ? 20 : 16);
  const body = (
    <>
      {icon !== undefined &&
        (round ? (
          <span class="bp-btn-disc">
            <Icon name={icon} size={iconPx} />
          </span>
        ) : (
          <Icon name={icon} size={iconPx} />
        ))}
      {children}
      {trailingIcon !== undefined && <Icon name={trailingIcon} size={iconPx === 16 ? 12 : 14} />}
    </>
  );
  if (href !== undefined) {
    return (
      <a class={classes.join(' ')} href={href} target="_blank" rel="noopener noreferrer">
        {body}
      </a>
    );
  }
  return (
    <button
      type={type}
      class={classes.join(' ')}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      onClick={onClick}
    >
      {body}
    </button>
  );
}
