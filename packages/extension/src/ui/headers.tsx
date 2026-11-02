import type { ComponentChildren } from 'preact';
import { t } from '../i18n';
import { Avatar } from './Avatar';
import { Button } from './Button';
import { Icon } from './icons';

export interface ScreenHeaderProps {
  title: string;
  onBack: () => void;
  /** Accessible name of ←; "Back" by default ("Back to settings" on Connected sites). */
  backLabel?: string | undefined;
  /** Right slot: a count, a token avatar, an icon button. */
  right?: ComponentChildren;
}

/** The 56 px header of a flow screen: ← (44 × 44), the title, an optional right slot. */
export function ScreenHeader({ title, onBack, backLabel, right }: ScreenHeaderProps) {
  return (
    <header class="bp-screen-header">
      <Button
        variant="icon"
        icon="arrow-left"
        label={backLabel ?? t('app.back')}
        onClick={onBack}
      />
      <h1 class="bp-screen-title">{title}</h1>
      {right}
    </header>
  );
}

export interface OnboardingHeaderProps {
  /** Zero-based index of the current step. */
  step: number;
  total: number;
  onBack?: (() => void) | undefined;
  /** The appearance button (`AppearanceToggle size={18}`) or any trailing control. */
  trailing?: ComponentChildren;
}

/** The first-run step header: ←, progress segments, "n of N" and the appearance button. */
export function OnboardingHeader({ step, total, onBack, trailing }: OnboardingHeaderProps) {
  const n = { step: step + 1, total };
  return (
    <header class="bp-ob-header">
      {onBack ? (
        <Button variant="icon" icon="arrow-left" label={t('app.back')} onClick={onBack} />
      ) : (
        <span class="bp-ob-header-gap" />
      )}
      <div class="bp-progress" role="img" aria-label={t('app.progress', n)}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} class={i <= step ? 'bp-progress-on' : undefined} />
        ))}
      </div>
      <span class="bp-progress-short" aria-hidden="true">
        {t('app.progressShort', n)}
      </span>
      {trailing}
    </header>
  );
}

export interface HomeHeaderProps {
  /** Left: a `TokenPill` (several tokens) or a `TokenTitle` (one token). */
  token: ComponentChildren;
  /** Right: the appearance button and the settings button. */
  actions: ComponentChildren;
}

/** The 64 px Home header. */
export function HomeHeader({ token, actions }: HomeHeaderProps) {
  return (
    <header class="bp-home-header">
      {token}
      <div class="bp-home-header-actions">{actions}</div>
    </header>
  );
}

export interface TokenPillProps {
  symbol: string;
  /** Token dot colour (`#RRGGBB`); invalid values fall back to the kit primary. */
  color?: string | undefined;
  /** Accessible name, e.g. "Switch token, current BZE". */
  label: string;
  onClick: () => void;
}

/** The token switcher trigger: avatar, symbol, chevron, in a pill. */
export function TokenPill({ symbol, color, label, onClick }: TokenPillProps) {
  return (
    <button type="button" class="bp-token-pill" aria-label={label} onClick={onClick}>
      <Avatar label={symbol} color={color} />
      <span class="bp-token-pill-sym">{symbol}</span>
      <Icon name="chevron-down" size={16} />
    </button>
  );
}

/** A single-token wallet's header title: avatar, symbol and "<name> wallet". */
export function TokenTitle(props: { symbol: string; caption: string; color?: string | undefined }) {
  return (
    <div class="bp-token-title">
      <Avatar label={props.symbol} color={props.color} />
      <span>
        <span class="bp-token-title-sym">{props.symbol}</span>
        <span class="bp-token-title-cap">{props.caption}</span>
      </span>
    </div>
  );
}

/** The settings (sliders) icon button of the Home header. */
export function SettingsButton(props: { onClick: () => void }) {
  return <Button variant="icon" icon="sliders" label={t('app.settings')} onClick={props.onClick} />;
}
