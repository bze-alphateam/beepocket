import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../i18n';
import { Button } from './Button';

export interface SheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  /** Next to the title, muted ("Connected sites 3"). */
  count?: number | string | undefined;
  /** The sticky bottom stack: primary over secondary. The body scrolls above it. */
  actions?: ComponentChildren;
  /** `auto` fits the content; `tall` takes the full height a sheet may have (lists, search). */
  height?: 'auto' | 'tall' | undefined;
  /** A second step of the sheet: a back arrow before the title goes to the first. */
  onBack?: (() => void) | undefined;
}

// The open sheets. One opened inside another (a DropdownSheet in a sheet) takes the keyboard.
const openSheets = new Set<HTMLElement>();

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet over the popup: backdrop, title row with a close (×) button, scrolling body, sticky
 * actions.
 * While open it owns the keyboard: focus moves into the dialog, Tab stays inside it, Escape
 * closes it, and focus returns to what had it before. A sheet opened inside another one takes
 * the keyboard until it closes. The × and the backdrop close it too.
 */
export function Sheet(props: SheetProps) {
  const { open, title, onClose, children } = props;
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const self = dialog.current;
    if (!open || !self) return;
    const before = document.activeElement;
    openSheets.add(self);
    self.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if ([...openSheets].some((o) => o !== self && self.contains(o))) return;
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
      openSheets.delete(self);
      if (before instanceof HTMLElement) before.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div class="bp-sheet-root">
      <div class="bp-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <section
        ref={dialog}
        class={props.height === 'tall' ? 'bp-sheet bp-sheet-tall' : 'bp-sheet'}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <div class="bp-sheet-head">
          {props.onBack !== undefined && (
            <Button
              variant="icon"
              icon="arrow-left"
              iconSize={20}
              class="bp-sheet-back"
              label={t('app.sheet.back')}
              onClick={props.onBack}
            />
          )}
          <h2>{title}</h2>
          {props.count !== undefined && <span class="bp-sheet-count">{props.count}</span>}
          <Button
            variant="icon"
            icon="x"
            iconSize={18}
            label={t('app.sheet.close')}
            onClick={onClose}
          />
        </div>
        <div class="bp-sheet-body">{children}</div>
        {props.actions !== undefined && <div class="bp-sheet-actions">{props.actions}</div>}
      </section>
    </div>
  );
}
