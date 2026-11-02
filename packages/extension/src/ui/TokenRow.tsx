import { Avatar } from './Avatar';
import { Icon } from './icons';
import { Swatches } from './Swatches';

export interface TokenRowProps {
  symbol: string;
  name: string;
  /** Avatar colour (`#RRGGBB`). */
  color?: string | undefined;
  /** The kit's colours for the swatches; none for a token without a brand kit. */
  swatches?: readonly string[] | undefined;
  /** The small line: "Brand kit", "No brand kit · default look". */
  caption: string;
  /**
   * - `option`: a picker row that toggles (`role="checkbox"`) with a check box at the end.
   * - `card`: a found token on a card, with a check icon at the end.
   */
  variant?: 'option' | 'card' | undefined;
  /** `option`: picked or not. */
  checked?: boolean | undefined;
  onToggle?: (() => void) | undefined;
}

/** A token with its avatar, symbol · name and kit swatches (`Ob-Tokens`, `Ob-Start-Code`). */
export function TokenRow({ variant = 'option', ...props }: TokenRowProps) {
  const option = variant === 'option';
  const body = (
    <>
      <Avatar label={props.symbol} color={props.color} size={option ? 30 : 32} />
      <span class="bp-token-row-text">
        <span class="bp-token-row-title">
          {props.symbol} <span class="bp-token-row-name">· {props.name}</span>
        </span>
        <span class="bp-token-row-sub">
          {props.swatches !== undefined && <Swatches colors={props.swatches} />}
          {props.caption}
        </span>
      </span>
    </>
  );
  if (!option) {
    return (
      <div class="bp-token-row bp-token-row-card">
        {body}
        <span class="bp-token-row-found">
          <Icon name="check" size={18} strokeWidth={2.4} />
        </span>
      </div>
    );
  }
  const checked = props.checked === true;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      class={checked ? 'bp-token-row bp-token-row-on' : 'bp-token-row'}
      onClick={props.onToggle}
    >
      {body}
      <span class="bp-token-row-box" aria-hidden="true">
        {checked && <Icon name="check" size={14} strokeWidth={3} />}
      </span>
    </button>
  );
}
