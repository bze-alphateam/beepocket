import type { ComponentChildren } from 'preact';
import { IconTile } from './Avatar';
import { Icon, type IconName } from './icons';
import { rovingKeyDown } from './roving';

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

interface RadioCardProps {
  checked: boolean;
  onSelect: () => void;
  tabIndex: number;
  option: RadioCardOption<string>;
}

/** One option card: icon tile, title, subtitle, radio dot, and its body while picked. */
function RadioCard({ checked, onSelect, tabIndex, option }: RadioCardProps) {
  const open = checked && option.body !== undefined;
  return (
    <div class={checked ? 'bp-radio-card bp-radio-card-on' : 'bp-radio-card'}>
      <button
        type="button"
        role="radio"
        class="bp-radio-card-head"
        aria-checked={checked}
        tabIndex={tabIndex}
        onClick={onSelect}
      >
        <IconTile icon={option.icon} tone={option.iconTone ?? 'soft'} />
        <span class="bp-radio-card-text">
          <span class="bp-radio-card-title">{option.title}</span>
          {option.subtitle !== undefined && (
            <span class="bp-radio-card-sub">{option.subtitle}</span>
          )}
        </span>
        <RadioDot checked={checked} />
      </button>
      {open && <div class="bp-radio-card-body">{option.body}</div>}
    </div>
  );
}

export interface RadioCardOption<V extends string> {
  value: V;
  title: string;
  subtitle?: string | undefined;
  icon: IconName;
  /** Icon tile tone: `soft` accent (the recommended option) or `inset` neutral. */
  iconTone?: 'soft' | 'inset' | undefined;
  /** Shown inside the card while it is picked (the token-code field on Ob-Start). */
  body?: ComponentChildren;
}

export interface RadioCardGroupProps<V extends string> {
  /** Accessible name of the group ("How do you want to start?"). */
  label: string;
  options: readonly RadioCardOption<V>[];
  /** The picked option, or null before the first pick. */
  value: V | null;
  onChange: (value: V) => void;
}

/**
 * Option cards as one radio group (`Ob-Start`): a tap or the arrow keys pick a card, and only the
 * picked card (or the first, before any pick) is in the Tab order.
 */
export function RadioCardGroup<V extends string>(props: RadioCardGroupProps<V>) {
  const { options, value, onChange } = props;
  const focusable = value ?? options[0]?.value;
  return (
    <div
      class="bp-radio-cards"
      role="radiogroup"
      aria-label={props.label}
      onKeyDown={(e) => {
        // Keys typed into a card's body (the token-code field) are the field's own.
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        rovingKeyDown(
          e,
          options.map((o) => o.value),
          value,
          onChange,
        );
      }}
    >
      {options.map((o) => (
        <RadioCard
          key={o.value}
          option={o}
          checked={o.value === value}
          tabIndex={o.value === focusable ? 0 : -1}
          onSelect={() => {
            onChange(o.value);
          }}
        />
      ))}
    </div>
  );
}
