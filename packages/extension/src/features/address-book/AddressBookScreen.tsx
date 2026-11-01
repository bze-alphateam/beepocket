import { shortAddress } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { Contact } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Layout } from '../../popup/Layout';
import { useRoute, type RouteBase } from '../../popup/router';
import { Banner, Button, Spinner, TextField } from '../../ui';
import { ContactForm } from './ContactForm';
import { matches } from './filter';
import type { BookRoute } from './routes';
import { useBook } from './useBook';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; contact: Contact };

/** W-Book, W-Book-Search and W-Contact-New in one route. */
export function AddressBookScreen({ route }: { route: BookRoute }) {
  const client = useClient();
  const { navigate } = useRoute<RouteBase>();
  const { book, failed, reload } = useBook();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);

  const header = (
    <>
      {route.back && (
        <Button
          variant="quiet"
          onClick={() => {
            if (route.back) navigate(route.back);
          }}
        >
          {t('book.back')}
        </Button>
      )}
      <h1>{t('book.title')}</h1>
    </>
  );

  if (failed) {
    return (
      <Layout header={header}>
        <Banner tone="red">{t('book.error.load')}</Banner>
      </Layout>
    );
  }
  if (!book) {
    return (
      <Layout header={header}>
        <Spinner />
      </Layout>
    );
  }

  if (mode.kind !== 'list') {
    const editing = mode.kind === 'edit' ? mode.contact : undefined;
    return (
      <Layout header={header}>
        <h2>{editing ? t('book.edit.title') : t('book.new.title')}</h2>
        <ContactForm
          key={editing?.address ?? 'new'}
          existing={editing}
          contacts={book.contacts}
          onDone={() => {
            reload();
            setMode({ kind: 'list' });
          }}
          onCancel={() => {
            setMode({ kind: 'list' });
          }}
          onRename={(contact) => {
            setMode({ kind: 'edit', contact });
          }}
        />
      </Layout>
    );
  }

  const remove = (contact: Contact) => {
    setError(false);
    void client.call('book.remove', { address: contact.address }).then((r) => {
      if (r.ok) reload();
      else setError(true);
    });
  };

  const contacts = book.contacts.filter((c) => matches(query, c.name, c.address));
  const own = book.own.filter((o) => matches(query, o.label, o.address));
  return (
    <Layout header={header}>
      <div class="bp-book">
        <TextField
          label={t('book.search')}
          placeholder={t('book.search.placeholder')}
          value={query}
          onInput={setQuery}
        />
        {error && <Banner tone="red">{t('book.error.generic')}</Banner>}
        <h3 class="bp-book-heading">{t('book.contacts')}</h3>
        {contacts.length === 0 && (
          <p class="bp-book-empty">
            {book.contacts.length === 0 ? t('book.empty') : t('book.noResults')}
          </p>
        )}
        <ul class="bp-book-list">
          {contacts.map((c) => (
            <li key={c.address} class="bp-book-item">
              <div class="bp-book-row">
                <strong>{c.name}</strong>
                <small>{shortAddress(c.address)}</small>
              </div>
              <Button
                variant="quiet"
                label={t('book.edit', { name: c.name })}
                onClick={() => {
                  setMode({ kind: 'edit', contact: c });
                }}
              >
                {t('book.edit.button')}
              </Button>
              <Button
                variant="danger"
                label={t('book.delete', { name: c.name })}
                onClick={() => {
                  remove(c);
                }}
              >
                {t('book.delete.button')}
              </Button>
            </li>
          ))}
        </ul>
        {own.length > 0 && <h3 class="bp-book-heading">{t('book.own')}</h3>}
        <ul class="bp-book-list">
          {own.map((o) => (
            <li key={o.address} class="bp-book-item">
              <div class="bp-book-row">
                <strong>{o.label}</strong>
                <small>{shortAddress(o.address)}</small>
              </div>
            </li>
          ))}
        </ul>
        <Button
          onClick={() => {
            setMode({ kind: 'new' });
          }}
        >
          {t('book.add')}
        </Button>
      </div>
    </Layout>
  );
}
