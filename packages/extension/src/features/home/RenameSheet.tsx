import { useState } from 'preact/hooks';
import { t, type StringKey } from '../../i18n';
import { MAX_LABEL } from './limits';
import { Button, Sheet, TextField } from '../../ui';

export interface RenameSheetProps {
  open: boolean;
  title: string;
  /** Shown above the field (the new address in the add flow). */
  intro?: string;
  initial: string;
  saveLabel: StringKey;
  onSave: (label: string) => Promise<boolean>;
  onClose: () => void;
}

/** `W-Rename` and `W-AddAddress`: one label field, 1–32 characters. */
export function RenameSheet(props: RenameSheetProps) {
  const [label, setLabel] = useState(props.initial);
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
    <Sheet open={props.open} title={props.title} onClose={props.onClose}>
      {props.intro !== undefined && <p class="bp-home-note">{props.intro}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField
          label={t('home.rename.label')}
          value={label}
          {...(error === undefined ? {} : { error })}
          autoFocus
          onInput={(v) => {
            setLabel(v);
            setError(undefined);
          }}
        />
        <Button type="submit" disabled={busy}>
          {t(props.saveLabel)}
        </Button>
      </form>
    </Sheet>
  );
}
