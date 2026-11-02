import { Button } from './Button';

export interface CopyButtonProps {
  /** Accessible name ("Copy address Main"). */
  label: string;
  /** Just copied: the icon turns into a green check until the screen clears it. */
  copied?: boolean | undefined;
  onCopy: () => void;
}

/** The copy icon button next to an address; shows a check right after a copy (`W-Copied`). */
export function CopyButton({ label, copied = false, onCopy }: CopyButtonProps) {
  return (
    <Button
      variant="icon"
      icon={copied ? 'check' : 'copy'}
      iconSize={15}
      label={label}
      class={copied ? 'bp-copy bp-copy-done' : 'bp-copy'}
      onClick={onCopy}
    />
  );
}
