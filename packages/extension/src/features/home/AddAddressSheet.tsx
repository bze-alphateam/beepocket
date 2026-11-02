import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { WalletErrorCodes, type WalletAddress } from '../../protocol';
import { useClient } from '../../popup/client-context';
import { Button, Field, Sheet, Spinner } from '../../ui';
import { MAX_LABEL } from './limits';

export interface AddAddressSheetProps {
  /** The address was stored: the screen adds it to its list. */
  onAdded: (address: WalletAddress) => void;
  onClose: () => void;
}

interface Preview {
  index: number;
  address: string;
}

/**
 * `W-AddAddress`: shows the next address before anything is stored, then stores exactly that one
 * with the optional label. If another address was added meanwhile, it shows the new next one.
 */
export function AddAddressSheet(props: AddAddressSheetProps) {
  const client = useClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);
  // The previewed address was taken by another add; the preview now shows the next one.
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const load = async () => {
    const res = await client.call('wallet.previewNext', {});
    if (res.ok) setPreview(res.value);
    else setFailed(true);
  };

  // Once per open sheet: the sheet mounts when it opens.
  useEffect(() => {
    void load();
  }, []);

  const submit = async () => {
    if (preview === null || busyRef.current) return;
    const trimmed = label.trim();
    if (trimmed.length > MAX_LABEL) {
      setError(t('home.add.invalid'));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFailed(false);
    setStale(false);
    const res = await client.call(
      'wallet.deriveNext',
      trimmed === '' ? { index: preview.index } : { index: preview.index, label: trimmed },
    );
    busyRef.current = false;
    setBusy(false);
    if (res.ok) {
      props.onAdded(res.value.address);
      props.onClose();
      return;
    }
    if (res.error.code === WalletErrorCodes.staleIndex) {
      setStale(true);
      setPreview(null);
      void load();
      return;
    }
    setFailed(true);
  };

  return (
    <Sheet open title={t('home.add.title')} onClose={props.onClose}>
      <form
        class="bp-home-sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {preview === null ? (
          !failed && (
            <div class="bp-home-sheet-wait" role="status" aria-label={t('home.add.loading')}>
              <Spinner />
            </div>
          )
        ) : (
          <>
            <p class="bp-home-note">{t('home.add.body', { number: preview.index + 1 })}</p>
            <p class="bp-home-new-address bp-mono">{preview.address}</p>
            <Field
              label={t('home.add.label')}
              value={label}
              placeholder={t('home.add.placeholder')}
              maxLength={MAX_LABEL}
              {...(error === undefined ? {} : { error })}
              onInput={(v) => {
                setLabel(v);
                setError(undefined);
              }}
            />
          </>
        )}
        {stale && (
          <p class="bp-home-note" role="status">
            {t('home.add.stale')}
          </p>
        )}
        {failed && <p role="alert">{t('home.add.failed')}</p>}
        <Button type="submit" disabled={preview === null || busy}>
          {t('home.add.save')}
        </Button>
        <Button variant="secondary" onClick={props.onClose}>
          {t('home.rename.cancel')}
        </Button>
      </form>
    </Sheet>
  );
}
