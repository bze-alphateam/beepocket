import type { ComponentChildren } from 'preact';
import { t } from '../i18n';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}

/** Bottom sheet over the popup; a tap on the backdrop or Escape closes it. */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  if (!open) return null;
  return (
    <div
      class="bp-sheet-root"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <button
        type="button"
        class="bp-sheet-backdrop"
        aria-label={t('app.sheet.close')}
        onClick={onClose}
      />
      <section class="bp-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
