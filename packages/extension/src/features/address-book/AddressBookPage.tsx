import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { Button, Sheet } from '../../ui';
import { SETTINGS_PARENT, SettingsPage } from '../settings/SettingsPage';
import { AddressBookBody, type BookView } from './AddressBookSheet';

/**
 * Settings › Address book, a page: the contact list, with "New contact" pinned above the footer.
 * Adding and editing a contact open as a small sheet on top of the page.
 */
export function AddressBookPage() {
  const [view, setView] = useState<BookView>({ kind: 'list' });
  // The list reads the book again when a form changed it.
  const [version, setVersion] = useState(0);
  const props = {
    open: true,
    mode: 'manage' as const,
    onClose: () => {
      setView({ kind: 'list' });
    },
    onChanged: () => {
      setVersion((v) => v + 1);
    },
  };
  return (
    <SettingsPage
      title={t('book.title')}
      parent={SETTINGS_PARENT['settings.book']}
      actions={
        <div class="bp-bottom">
          <Button
            variant="secondary"
            icon="plus"
            onClick={() => {
              setView({ kind: 'new' });
            }}
          >
            {t('book.add')}
          </Button>
        </div>
      }
    >
      <AddressBookBody key={version} {...props} view={{ kind: 'list' }} setView={setView} />
      {view.kind !== 'list' && (
        <Sheet
          open
          title={view.kind === 'new' ? t('book.new.title') : t('book.edit.title')}
          onClose={props.onClose}
        >
          <AddressBookBody {...props} view={view} setView={setView} />
        </Sheet>
      )}
    </SettingsPage>
  );
}
