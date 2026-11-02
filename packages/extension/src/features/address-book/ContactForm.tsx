import { useState } from 'preact/hooks';
import { t, type StringKey } from '../../i18n';
import { BookErrorCodes, type Contact } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Banner, Button, Field } from '../../ui';
import { normalizeAddress, normalizeName } from './contact';

function errorKey(code: string): StringKey {
  switch (code) {
    case BookErrorCodes.ownAddress:
      return 'book.error.own';
    case BookErrorCodes.duplicateName:
      return 'book.error.duplicateName';
    case BookErrorCodes.invalidName:
      return 'book.error.name';
    case BookErrorCodes.invalidAddress:
      return 'book.error.address';
    default:
      return 'book.error.generic';
  }
}

export interface ContactFormProps {
  /** Present when editing: the address is fixed and only the name changes. */
  existing?: Contact | undefined;
  /** A new contact's address, filled in (Send's "Save it"). */
  initialAddress?: string | undefined;
  /** The primary button: "Save" or "Save and use". */
  submitLabel: string;
  /** Saved; answers the contact as stored. */
  onDone: (contact: Contact) => void;
  onCancel: () => void;
  /** The address is saved under another name: offer to rename that one. */
  onRename: (contact: Contact) => void;
  /** Editing only: shows "Delete contact" under Cancel. */
  onDelete?: (() => void) | undefined;
  /** Contacts, to name the existing one on a duplicate. */
  contacts: Contact[];
}

/** `W-Contact-New`: name and address, validated inline. Also the edit form. */
export function ContactForm(props: ContactFormProps) {
  const { existing, contacts } = props;
  const client = useClient();
  const [name, setName] = useState(existing?.name ?? '');
  const [address, setAddress] = useState(existing?.address ?? props.initialAddress ?? '');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<{ code: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const nameOk = normalizeName(name) !== null;
  const addressOk = normalizeAddress(address) !== null;
  const nameError = touched && !nameOk ? t('book.error.name') : undefined;
  const addressError =
    existing || !(touched || address !== '') || addressOk ? undefined : t('book.error.address');

  const duplicate =
    serverError?.code === BookErrorCodes.duplicate
      ? contacts.find((c) => c.address === normalizeAddress(address))
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
      if (!r.ok) {
        setServerError(r.error);
        return;
      }
      const saved = normalizeAddress(address) ?? address;
      props.onDone(
        r.value.contacts.find((c) => c.address === saved) ?? { name: name.trim(), address: saved },
      );
    });
  };

  return (
    <form class="bp-book-form" onSubmit={submit} noValidate>
      <Field
        label={t('book.field.name')}
        placeholder={t('book.field.name.placeholder')}
        value={name}
        onInput={setName}
        maxLength={32}
        error={nameError}
        autoFocus
      />
      <Field
        label={t('book.field.address')}
        placeholder={t('book.field.address.placeholder')}
        value={address}
        onInput={setAddress}
        mono
        disabled={existing !== undefined}
        error={addressError}
        hint={t('book.field.address.hint')}
      />
      {serverError && !duplicate && <Banner tone="red">{t(errorKey(serverError.code))}</Banner>}
      {duplicate && (
        <Banner tone="amber">
          {t('book.error.duplicate', { name: duplicate.name })}{' '}
          <Button
            variant="ghost"
            onClick={() => {
              props.onRename(duplicate);
            }}
          >
            {t('book.rename', { name: duplicate.name })}
          </Button>
        </Banner>
      )}
      <div class="bp-book-actions">
        <Button type="submit" disabled={busy}>
          {props.submitLabel}
        </Button>
        <Button variant="secondary" onClick={props.onCancel}>
          {t('book.cancel')}
        </Button>
        {props.onDelete && (
          <Button variant="ghost" tone="muted" icon="x" onClick={props.onDelete}>
            {t('book.delete.button')}
          </Button>
        )}
      </div>
    </form>
  );
}
