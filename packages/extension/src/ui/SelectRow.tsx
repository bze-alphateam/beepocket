import type { ComponentChildren } from 'preact';
import { Icon } from './icons';

export interface SelectRowProps {
  /** Accessible name of the whole row ("From Main, 8,240.10 BZE. Change address"). */
  label: string;
  onClick: () => void;
  /**
   * - `field`: the 12 px-radius box of a form field with a strong hairline (the Send From card).
   * - `quiet`: a 44 px card row with a muted caption on the left (the Network fee row).
   */
  tone?: 'field' | 'quiet' | undefined;
  /** `field`: the bold first line ("Main"). */
  title?: string | undefined;
  /** `field`: the monospace second line (a short address). */
  subtitle?: string | undefined;
  /** `quiet`: the muted text that fills the left ("Network fee"). */
  caption?: string | undefined;
  /** `quiet`: a small accent badge on its own line under the caption ("Custom gas"). */
  badge?: string | undefined;
  /** Before the value: a small `Avatar` (the fee token). */
  valueIcon?: ComponentChildren;
  /** Right, bold, tabular: "8,240.10 BZE", "≈ 0.012 BZE". */
  value?: string | undefined;
  disabled?: boolean | undefined;
}

/**
 * A row that opens a choice sheet: text on the left, a value and a chevron-down on the right
 * (`W-Send` From card and Network fee row).
 */
export function SelectRow({ tone = 'field', ...props }: SelectRowProps) {
  return (
    <button
      type="button"
      class={`bp-select-row bp-select-row-${tone}`}
      aria-label={props.label}
      aria-haspopup="dialog"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.caption !== undefined && (
        <span class="bp-select-row-caption">
          {props.caption}
          {props.badge !== undefined && <span class="bp-select-row-badge">{props.badge}</span>}
        </span>
      )}
      {(props.title !== undefined || props.subtitle !== undefined) && (
        <span class="bp-select-row-text">
          {props.title !== undefined && <span class="bp-select-row-title">{props.title}</span>}
          {props.subtitle !== undefined && (
            <span class="bp-select-row-sub bp-mono">{props.subtitle}</span>
          )}
        </span>
      )}
      {props.valueIcon}
      {props.value !== undefined && <span class="bp-select-row-value">{props.value}</span>}
      <Icon name="chevron-down" size={16} />
    </button>
  );
}
