export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  /** A small count after the label ("Addresses 4"). */
  count?: number | string | undefined;
}

export interface SegmentedProps<V extends string> {
  options: readonly SegmentedOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Accessible name of the group ("Wallet view", "Appearance"). */
  label: string;
  /**
   * `tabs`: switches views below it (tablist / tab, aria-selected).
   * `radio`: picks a value (radiogroup / radio, aria-checked): 12 / 24 words, Dark / Light / System.
   */
  kind?: 'tabs' | 'radio' | undefined;
  /** Segment height: `sm` 28 px (word count), `md` 30 px (tabs, appearance). */
  size?: 'sm' | 'md' | undefined;
  /** Id prefix for tabs, so a panel can point back with `aria-labelledby={id + '-' + value}`. */
  id?: string | undefined;
}

/** A segmented control. Arrow keys move between segments. */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  kind = 'tabs',
  size = 'md',
  id,
}: SegmentedProps<V>) {
  const tabs = kind === 'tabs';
  const move = (from: number, step: number) => {
    const next = options[(from + step + options.length) % options.length];
    if (next) onChange(next.value);
  };
  return (
    <div
      class={`bp-seg bp-seg-${size}`}
      role={tabs ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={(e) => {
        const at = options.findIndex((o) => o.value === value);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(at, 1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(at, -1);
        else return;
        e.preventDefault();
        const group = e.currentTarget as HTMLElement;
        // After the re-render moved tabindex 0 to the new segment.
        setTimeout(() => {
          group.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
        }, 0);
      }}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            id={id === undefined ? undefined : `${id}-${o.value}`}
            role={tabs ? 'tab' : 'radio'}
            {...(tabs ? { 'aria-selected': on } : { 'aria-checked': on })}
            tabIndex={on ? 0 : -1}
            class={on ? 'bp-seg-on' : undefined}
            onClick={() => {
              onChange(o.value);
            }}
          >
            {o.label}
            {o.count !== undefined && <span class="bp-seg-count">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
