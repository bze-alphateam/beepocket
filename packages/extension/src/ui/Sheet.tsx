import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet over the popup. While open it owns the keyboard: focus moves into the dialog,
 * Tab stays inside it, Escape closes it, and focus returns to what had it before.
 */
export function Sheet({ open, title, onClose, children }: SheetProps) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement;
    dialog.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!first || !last) {
        e.preventDefault();
        dialog.current.focus();
      } else if (!dialog.current.contains(active) || active === dialog.current) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (before instanceof HTMLElement) before.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div class="bp-sheet-root">
      <div class="bp-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section
        ref={dialog}
        class="bp-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
