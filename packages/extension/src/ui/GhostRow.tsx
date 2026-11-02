import { Icon, type IconName } from './icons';

export interface GhostRowProps {
  icon: IconName;
  title: string;
  /** Monospace hint on the right ("MsgMultiSwap", "2 messages"). */
  hint?: string | undefined;
  onClick: () => void;
}

/** A borderless row that opens something: "‹› Message details … MsgMultiSwap ›". */
export function GhostRow({ icon, title, hint, onClick }: GhostRowProps) {
  return (
    <button type="button" class="bp-ghost-row" aria-haspopup="dialog" onClick={onClick}>
      <Icon name={icon} size={14} />
      <span class="bp-ghost-row-title">{title}</span>
      {hint !== undefined && (
        <span class="bp-ghost-row-hint bp-mono" aria-hidden="true">
          {hint}
        </span>
      )}
      <Icon name="chevron-right" size={14} strokeWidth={2.2} />
    </button>
  );
}
