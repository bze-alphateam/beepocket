import { shortAddress } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Sheet, Spinner, TextField, Banner } from '../../ui';
import { matches } from './filter';
import { useBook } from './useBook';

export interface ContactPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen address; the picker does not close itself. */
  onPick: (address: string) => void;
}

/** A sheet to pick a contact or one of the wallet's own addresses; answers the address. */
export function ContactPicker({ open, onClose, onPick }: ContactPickerProps) {
  return (
    <Sheet open={open} title={t('book.picker.title')} onClose={onClose}>
      <PickerBody onPick={onPick} />
    </Sheet>
  );
}

function PickerBody({ onPick }: { onPick: (address: string) => void }) {
  const { book, failed } = useBook();
  const [query, setQuery] = useState('');
  if (failed) return <Banner tone="red">{t('book.error.load')}</Banner>;
  if (!book) return <Spinner />;
  const contacts = book.contacts.filter((c) => matches(query, c.name, c.address));
  const own = book.own.filter((o) => matches(query, o.label, o.address));
  return (
    <div class="bp-book-picker">
      <TextField
        label={t('book.search')}
        placeholder={t('book.search.placeholder')}
        value={query}
        onInput={setQuery}
        autoFocus
      />
      {contacts.length > 0 && <h3 class="bp-book-heading">{t('book.contacts')}</h3>}
      <ul class="bp-book-list">
        {contacts.map((c) => (
          <li key={c.address}>
            <button
              type="button"
              class="bp-book-row"
              onClick={() => {
                onPick(c.address);
              }}
            >
              <strong>{c.name}</strong>
              <small>{shortAddress(c.address)}</small>
            </button>
          </li>
        ))}
      </ul>
      {own.length > 0 && <h3 class="bp-book-heading">{t('book.own')}</h3>}
      <ul class="bp-book-list">
        {own.map((o) => (
          <li key={o.address}>
            <button
              type="button"
              class="bp-book-row"
              onClick={() => {
                onPick(o.address);
              }}
            >
              <strong>{o.label}</strong>
              <small>{shortAddress(o.address)}</small>
            </button>
          </li>
        ))}
      </ul>
      {contacts.length === 0 && own.length === 0 && (
        <p class="bp-book-empty">{query.trim() === '' ? t('book.empty') : t('book.noResults')}</p>
      )}
    </div>
  );
}
