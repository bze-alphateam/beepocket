import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { PasswordOutcome, Result } from '../../protocol';
import { Banner, Button, TextField } from '../../ui';
import { formatCountdown, useCountdown } from './countdown';
import { useLockEnv } from './env';

export interface PasswordFormProps {
  label: string;
  submitLabel: string;
  /** A rejected password comes back as data; only transport/validation failures are errors. */
  check: (password: string) => Promise<Result<PasswordOutcome>>;
  onSuccess: () => void;
  /** Epoch ms the service is already blocking until (e.g. from `wallet.state`). */
  retryAt?: number | null;
}

/** Password field + submit with the wrong-password error and the throttle countdown. */
export function PasswordForm(props: PasswordFormProps) {
  const { clock } = useLockEnv();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(props.retryAt ?? null);
  const left = useCountdown(clock, retryAt, () => {
    setRetryAt(null);
  });
  const blocked = left > 0;

  const submit = async () => {
    if (busy || blocked || password === '') return;
    setBusy(true);
    setError(undefined);
    const res = await props.check(password);
    setBusy(false);
    if (!res.ok) {
      setError(t('app.error.generic'));
      return;
    }
    const outcome = res.value;
    if (outcome.status === 'ok') {
      setPassword('');
      props.onSuccess();
      return;
    }
    setPassword('');
    setRetryAt(outcome.retryAt);
    setError(outcome.status === 'wrong-password' ? t('lock.wrongPassword') : undefined);
  };

  return (
    <form
      class="bp-lock-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <TextField
        label={props.label}
        type="password"
        value={password}
        onInput={setPassword}
        disabled={blocked || busy}
        autoFocus
        {...(error === undefined ? {} : { error })}
      />
      {blocked && (
        <Banner tone="amber">{t('lock.retryIn', { time: formatCountdown(left) })}</Banner>
      )}
      <Button type="submit" disabled={blocked || busy || password === ''}>
        {busy ? t('lock.unlocking') : props.submitLabel}
      </Button>
    </form>
  );
}
