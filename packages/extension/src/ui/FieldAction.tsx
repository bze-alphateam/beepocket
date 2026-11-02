import { Icon, type IconName } from './icons';

export interface FieldActionProps {
  icon: IconName;
  /** Accessible name ("Open address book"). */
  label: string;
  onClick: () => void;
}

/** A 44 × 44 accent icon button inside a `Field` box, at its end (the To field's book icon). */
export function FieldAction({ icon, label, onClick }: FieldActionProps) {
  return (
    <button type="button" class="bp-field-action" aria-label={label} onClick={onClick}>
      <Icon name={icon} size={20} />
    </button>
  );
}
