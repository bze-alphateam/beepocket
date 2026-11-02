import { useState } from 'preact/hooks';
import { t } from '../i18n';
import { Icon } from './icons';
import { Sheet } from './Sheet';

export interface DropdownOption<V extends string> {
  value: V;
  label: string;
  /** Second line, monospace (an address). */
  sub?: string | undefined;
}

export interface DropdownSheetProps<V extends string> {
  /** Sheet title and the group's accessible name ("Filter by address"). */
  title: string;
  options: readonly DropdownOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the trigger; defaults to "<title>, now <current label>". */
  label?: string | undefined;
}

/**
 * The kit's replacement for a native `<select>`: a chip (current label + chevron) that opens a
 * sheet with a single-choice list. Picking an option closes the sheet.
 */
export function DropdownSheet<V extends string>(props: DropdownSheetProps<V>) {
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value);
  const currentLabel = current?.label ?? '';
  return (
    <>
      <button
        type="button"
        class="bp-dropdown"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={props.label ?? t('app.dropdown', { title: props.title, value: currentLabel })}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span class="bp-dropdown-label">{currentLabel}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      <Sheet
        open={open}
        title={props.title}
        onClose={() => {
          setOpen(false);
        }}
      >
        <div class="bp-choice-list" role="radiogroup" aria-label={props.title}>
          {props.options.map((o) => {
            const on = o.value === props.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={on}
                class={on ? 'bp-choice bp-choice-on' : 'bp-choice'}
                onClick={() => {
                  props.onChange(o.value);
                  setOpen(false);
                }}
              >
                <span class="bp-choice-text">
                  <span class="bp-choice-label">{o.label}</span>
                  {o.sub !== undefined && <span class="bp-choice-sub bp-mono">{o.sub}</span>}
                </span>
                {on && <Icon name="check" size={18} strokeWidth={2.4} />}
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
