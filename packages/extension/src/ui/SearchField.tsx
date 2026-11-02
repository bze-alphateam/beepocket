import { useMemo } from 'preact/hooks';
import { Icon } from './icons';

export interface SearchFieldProps {
  /** Accessible name; the box shows the placeholder instead of a visible label. */
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string | undefined;
  autoFocus?: boolean | undefined;
}

let nextId = 0;

/** The 44 px search box of list sheets: a search icon, then the input (`W-Switcher`, `W-Book`). */
export function SearchField(props: SearchFieldProps) {
  const id = useMemo(() => `bp-search-${String(nextId++)}`, []);
  return (
    <div class="bp-search">
      <label for={id} class="bp-sr-only">
        {props.label}
      </label>
      <Icon name="search" size={16} />
      <input
        id={id}
        type="search"
        value={props.value}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        autoComplete="off"
        spellcheck={false}
        onInput={(e) => {
          props.onInput(e.currentTarget.value);
        }}
      />
    </div>
  );
}
