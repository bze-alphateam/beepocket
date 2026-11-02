import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { WalletAddress } from '../../protocol';
import { Button, Field, Sheet } from '../../ui';
import { MAX_LABEL } from './limits';

export interface RenameSheetProps {
  address: WalletAddress;
  onSave: (label: string) => Promise<boolean>;
  onClose: () => void;
}

/** `W-Rename`: the full address, one label field of 1–32 characters, Save and Cancel. */
export function RenameSheet(props: RenameSheetProps) {
  const [label, setLabel] = useState(props.address.label);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > MAX_LABEL) {
      setError(t('home.rename.invalid'));
      return;
    }
    setBusy(true);
    const saved = await props.onSave(trimmed);
    setBusy(false);
    if (saved) props.onClose();
    else setError(t('home.rename.failed'));
  };

  return (
    <Sheet open title={t('home.rename.title')} onClose={props.onClose}>
      <form
        class="bp-home-sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p class="bp-home-full-address bp-mono">{props.address.address}</p>
        <Field
          label={t('home.rename.label')}
          value={label}
          hint={t('home.rename.hint')}
          {...(error === undefined ? {} : { error })}
          autoFocus
          onInput={(v) => {
            setLabel(v);
            setError(undefined);
          }}
        />
        <Button type="submit" disabled={busy}>
          {t('home.rename.save')}
        </Button>
        <Button variant="secondary" onClick={props.onClose}>
          {t('home.rename.cancel')}
        </Button>
      </form>
    </Sheet>
  );
}
