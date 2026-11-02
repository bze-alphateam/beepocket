import type { ComponentChildren } from 'preact';
import { IconTile } from './Avatar';
import { Icon, type IconName } from './icons';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  /** Second line under the title ("Use each token's brand kit colours"). */
  description?: string | undefined;
  disabled?: boolean | undefined;
}

/** A settings row with a switch (`role="switch"`). */
export function Toggle({ checked, onChange, title, description, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      class="bp-toggle"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span class="bp-toggle-text">
        <span class="bp-toggle-title">{title}</span>
        {description !== undefined && <span class="bp-toggle-desc">{description}</span>}
      </span>
      <span class="bp-switch" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}

export interface CheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ComponentChildren;
  disabled?: boolean | undefined;
}

/** A checkbox with its label ("I've written it down somewhere safe"). */
export function Check({ checked, onChange, children, disabled }: CheckProps) {
  return (
    <button
      type="button"
      role="checkbox"
      class="bp-check"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span class="bp-check-box" aria-hidden="true">
        {checked && <Icon name="check" size={14} strokeWidth={3} />}
      </span>
      <span>{children}</span>
    </button>
  );
}

/** The radio dot of a choice row or card; decorative, the row carries the state. */
export function RadioDot(props: { checked: boolean }) {
  return (
    <span class={props.checked ? 'bp-radio bp-radio-on' : 'bp-radio'} aria-hidden="true">
      <span />
    </span>
  );
}

export interface RadioCardProps {
  checked: boolean;
  onSelect: () => void;
  title: string;
  subtitle?: string | undefined;
  icon: IconName;
  /** Icon tile tone: `soft` accent (the recommended option) or `inset` neutral. */
  iconTone?: 'soft' | 'inset' | undefined;
  /** Shown inside the card while it is picked (the token-code field on Ob-Start). */
  children?: ComponentChildren;
}

/**
 * An option card with an icon, title, subtitle and radio dot (`Ob-Start`). Put the cards in an
 * element with `role="radiogroup"` and an `aria-label`.
 */
export function RadioCard(props: RadioCardProps) {
  const open = props.checked && props.children !== undefined;
  return (
    <div class={props.checked ? 'bp-radio-card bp-radio-card-on' : 'bp-radio-card'}>
      <button
        type="button"
        role="radio"
        class="bp-radio-card-head"
        aria-checked={props.checked}
        onClick={props.onSelect}
      >
        <IconTile icon={props.icon} tone={props.iconTone ?? 'soft'} />
        <span class="bp-radio-card-text">
          <span class="bp-radio-card-title">{props.title}</span>
          {props.subtitle !== undefined && <span class="bp-radio-card-sub">{props.subtitle}</span>}
        </span>
        <RadioDot checked={props.checked} />
      </button>
      {open && <div class="bp-radio-card-body">{props.children}</div>}
    </div>
  );
}
