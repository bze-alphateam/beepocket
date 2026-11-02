import { Button } from './Button';

export interface StarButtonProps {
  /** Starred: a filled star in the kit accent; otherwise an outline star. */
  on: boolean;
  /** Accessible name, saying what a tap does ("Add VDL to preferred") or why it can't. */
  label: string;
  disabled?: boolean | undefined;
  onToggle: () => void;
}

/** The 44 × 44 star toggle of the token switcher. */
export function StarButton({ on, label, disabled, onToggle }: StarButtonProps) {
  return (
    <Button
      variant="icon"
      icon={on ? 'star-filled' : 'star'}
      iconSize={18}
      label={label}
      pressed={on}
      disabled={disabled}
      class={on ? 'bp-star bp-star-on' : 'bp-star'}
      onClick={onToggle}
    />
  );
}
