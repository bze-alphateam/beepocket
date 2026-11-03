import { RadioDot } from './choices';
import { rovingKeyDown } from './roving';

export interface RadioListOption<V> {
  value: V;
  title: string;
  /** Monospace second line: a short address. */
  subtitle?: string | undefined;
  /** Right column: a balance. */
  amount?: string | undefined;
  /** Dims the right column (an empty balance). */
  muted?: boolean | undefined;
}

export interface RadioListProps<V> {
  /** Accessible name of the group ("Address to connect"). */
  label: string;
  options: readonly RadioListOption<V>[];
  value: V;
  onChange: (value: V) => void;
  disabled?: boolean | undefined;
}

/** One choice out of a list of rows: radio dot, label, short address, balance (`W-Connect`). */
export function RadioList<V>({ label, options, value, onChange, disabled }: RadioListProps<V>) {
  return (
    <div
      class="bp-radio-list"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (disabled === true) return;
        rovingKeyDown(
          e,
          options.map((o) => o.value),
          value,
          onChange,
        );
      }}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={i}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            class={on ? 'bp-radio-row bp-radio-row-on' : 'bp-radio-row'}
            onClick={() => {
              onChange(o.value);
            }}
          >
            <RadioDot checked={on} />
            <span class="bp-radio-row-text">
              <span class="bp-radio-row-title">{o.title}</span>
              {o.subtitle !== undefined && (
                <span class="bp-radio-row-sub bp-mono">{o.subtitle}</span>
              )}
            </span>
            {o.amount !== undefined && (
              <span class={o.muted === true ? 'bp-radio-row-value bp-muted' : 'bp-radio-row-value'}>
                {o.amount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
