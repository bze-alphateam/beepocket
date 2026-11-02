import { shortAddress } from '@beepocket/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { Contact } from '../../protocol';
import { useClient } from '../../popup/client-context';
import {
  Avatar,
  Banner,
  Button,
  ListRow,
  SearchField,
  SectionLabel,
  Sheet,
  Spinner,
} from '../../ui';
import { ContactForm } from './ContactForm';
import { matches } from './filter';
import { useBook } from './useBook';

/**
 * The one address book sheet, for Send and for Settings.
 *
 * - `pick` (Send's book icon): tapping a contact or one of the wallet's own addresses answers
 *   its address through `onPick`; "New contact" saves one and answers it too ("Save and use").
 * - `manage` (Settings › Address book): tapping a contact opens its edit form (rename, delete);
 *   own addresses are listed but not editable here. Nothing is answered.
 */
export interface AddressBookSheetProps {
  open: boolean;
  /** Backdrop, Escape, and Cancel on a form the sheet was opened on. */
  onClose: () => void;
  mode: 'pick' | 'manage';
  /**
   * `pick`: called with the chosen address (a contact, an own address or a contact just
   * saved). The sheet does not close itself: the caller closes it.
   */
  onPick?: ((address: string) => void) | undefined;
  /** `pick`: the address the form holds now; its row is highlighted. */
  selected?: string | undefined;
  /** Opens straight on the new-contact form with this address filled in (Send's "Save it"). */
  newAddress?: string | undefined;
  /** After a contact was added, renamed or deleted, e.g. to refresh Send's match line. */
  onChanged?: (() => void) | undefined;
}

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; contact: Contact };

/** `W-Book`, `W-Book-Search` and `W-Contact-New` in one sheet. */
export function AddressBookSheet(props: AddressBookSheetProps) {
  const { open, newAddress } = props;
  const [view, setView] = useState<View>({ kind: 'list' });
  // Every time the sheet opens it starts where the caller asked, never where it was left.
  useEffect(() => {
    if (open) setView(newAddress === undefined ? { kind: 'list' } : { kind: 'new' });
  }, [open, newAddress]);

  const title =
    view.kind === 'list'
      ? t('book.title')
      : view.kind === 'new'
        ? t('book.new.title')
        : t('book.edit.title');
  return (
    <Sheet
      open={props.open}
      title={title}
      onClose={props.onClose}
      height={view.kind === 'list' ? 'tall' : 'auto'}
      actions={
        view.kind === 'list' ? (
          <Button
            variant="secondary"
            icon="plus"
            onClick={() => {
              setView({ kind: 'new' });
            }}
          >
            {t('book.add')}
          </Button>
        ) : undefined
      }
    >
      <Body {...props} view={view} setView={setView} />
    </Sheet>
  );
}

function Body(props: AddressBookSheetProps & { view: View; setView: (view: View) => void }) {
  const { view, setView, mode } = props;
  const client = useClient();
  const { book, failed, reload } = useBook();
  const [query, setQuery] = useState('');
  const [deleteFailed, setDeleteFailed] = useState(false);

  if (failed) return <Banner tone="red">{t('book.error.load')}</Banner>;
  if (!book) return <Spinner />;

  const changed = () => {
    reload();
    props.onChanged?.();
  };
  // Cancel goes back to the list, unless the sheet was opened on this form.
  const back = () => {
    if (view.kind === 'new' && props.newAddress !== undefined) props.onClose();
    else setView({ kind: 'list' });
  };

  if (view.kind !== 'list') {
    const editing = view.kind === 'edit' ? view.contact : undefined;
    return (
      <>
        {deleteFailed && <Banner tone="red">{t('book.error.delete')}</Banner>}
        <ContactForm
          key={editing?.address ?? 'new'}
          existing={editing}
          initialAddress={editing ? undefined : props.newAddress}
          contacts={book.contacts}
          submitLabel={mode === 'pick' && !editing ? t('book.saveAndUse') : t('book.save')}
          onDone={(contact) => {
            changed();
            if (mode === 'pick' && !editing) props.onPick?.(contact.address);
            else setView({ kind: 'list' });
          }}
          onCancel={back}
          onRename={(contact) => {
            setView({ kind: 'edit', contact });
          }}
          onDelete={
            editing &&
            (() => {
              setDeleteFailed(false);
              void client.call('book.remove', { address: editing.address }).then((r) => {
                if (!r.ok) {
                  setDeleteFailed(true);
                  return;
                }
                changed();
                setView({ kind: 'list' });
              });
            })
          }
        />
      </>
    );
  }

  const contacts = book.contacts.filter((c) => matches(query, c.name, c.address));
  const own = book.own.filter((o) => matches(query, o.label, o.address));
  const searching = query.trim() !== '';
  const row = (
    key: string,
    name: string,
    address: string,
    onClick?: () => void,
    label?: string,
  ) => (
    <ListRow
      key={key}
      size="option"
      title={name}
      subtitle={shortAddress(address)}
      leading={<Avatar kind="contact" label={name} size={30} />}
      selected={props.selected === address}
      onClick={onClick}
      label={label}
    />
  );
  return (
    <div class="bp-book">
      <SearchField
        label={t('book.search')}
        placeholder={t('book.search.placeholder')}
        value={query}
        onInput={setQuery}
      />
      <div class="bp-book-groups">
        {contacts.length > 0 && (
          <section class="bp-book-group">
            <SectionLabel title={t('book.contacts')} count={contacts.length} />
            {contacts.map((c) =>
              mode === 'pick'
                ? row(
                    c.address,
                    c.name,
                    c.address,
                    () => props.onPick?.(c.address),
                    t('book.pick', { name: c.name }),
                  )
                : row(
                    c.address,
                    c.name,
                    c.address,
                    () => {
                      setView({ kind: 'edit', contact: c });
                    },
                    t('book.edit', { name: c.name }),
                  ),
            )}
          </section>
        )}
        {own.length > 0 && (
          <section class="bp-book-group">
            <SectionLabel title={t('book.own')} count={own.length} />
            {own.map((o) =>
              mode === 'pick'
                ? row(
                    o.address,
                    o.label,
                    o.address,
                    () => props.onPick?.(o.address),
                    t('book.pick', { name: o.label }),
                  )
                : row(o.address, o.label, o.address),
            )}
          </section>
        )}
        {contacts.length === 0 && (
          <p class="bp-book-empty">
            {searching ? t('book.noResults', { query: query.trim() }) : t('book.empty')}
          </p>
        )}
      </div>
    </div>
  );
}
