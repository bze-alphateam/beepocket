import { isBzeAddress } from '@beepocket/core';
import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import { BookErrorCodes, type Contact } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Banner, Button, TextField } from '../../ui';

export interface ContactFormProps {
  /** Present when editing: the address is fixed and only the name changes. */
  existing?: Contact | undefined;
  onDone: () => void;
  onCancel: () => void;
  /** The address is saved under another name: offer to rename that one. */
  onRename: (contact: Contact) => void;
  /** Contacts, to name the existing one on a duplicate. */
  contacts: Contact[];
}

/** W-Contact-New: paste an address, name it, validated inline. */
export function ContactForm({ existing, onDone, onCancel, onRename, contacts }: ContactFormProps) {
  const client = useClient();
  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.address ?? '');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOk = name.trim().length >= 1 && name.trim().length <= 32;
  const addressOk = isBzeAddress(address.trim());
  const nameError = touched && !nameOk ? t('book.error.name') : undefined;
  const addressError =
    existing || !(touched || address !== '') || addressOk ? undefined : t('book.error.address');

  const duplicate =
    serverError?.code === BookErrorCodes.duplicate
      ? contacts.find((c) => c.address === address.trim())
      : undefined;

  const submit = (e: Event) => {
    e.preventDefault();
    setTouched(true);
    if (!nameOk || !addressOk || busy) return;
    setBusy(true);
    setServerError(null);
    const payload = { name, address };
    void client.call(existing ? 'book.update' : 'book.add', payload).then((r) => {
      setBusy(false);
      if (r.ok) onDone();
      else setServerError(r.error);
    });
  };

  return (
    <form class="bp-book-form" onSubmit={submit} noValidate>
      <TextField
        label={t('book.field.name')}
        value={name}
        onInput={setName}
        {...(nameError === undefined ? {} : { error: nameError })}
        autoFocus
      />
      <TextField
        label={t('book.field.address')}
        placeholder={t('book.field.address.placeholder')}
        value={address}
        onInput={setAddress}
        disabled={existing !== undefined}
        {...(addressError === undefined ? {} : { error: addressError })}
      />
      {serverError && !duplicate && (
        <Banner tone="red">
          {serverError.code === BookErrorCodes.ownAddress
            ? t('book.error.own')
            : t('book.error.generic')}
        </Banner>
      )}
      {duplicate && (
        <Banner tone="amber">
          {t('book.error.duplicate', { name: duplicate.name })}{' '}
          <Button
            variant="quiet"
            onClick={() => {
              onRename(duplicate);
            }}
          >
            {t('book.rename', { name: duplicate.name })}
          </Button>
        </Banner>
      )}
      <div class="bp-book-actions">
        <Button variant="quiet" onClick={onCancel}>
          {t('book.cancel')}
        </Button>
        <Button type="submit" disabled={busy}>
          {t('book.save')}
        </Button>
      </div>
    </form>
  );
}
