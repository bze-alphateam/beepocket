import { useState } from 'preact/hooks';
import { t } from '../../i18n';
import type { PasswordOutcome, Result } from '../../protocol';
import { Button, Field, Icon, type IconName } from '../../ui';
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
  /** The submit button waits for something else (e.g. a tick) and takes this style. */
  hold?: boolean;
  variant?: 'primary' | 'danger';
  /** Unlock's look: 48 px field and button, the label kept for screen readers only. */
  large?: boolean;
  /** An icon before the label; the label line is then drawn with it. */
  labelIcon?: IconName;
  /** Shown in the empty field (Unlock uses the label). */
  placeholder?: string;
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
      setPassword('');
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
      {props.labelIcon !== undefined && (
        <p class="bp-lock-form-label" aria-hidden="true">
          <Icon name={props.labelIcon} size={13} strokeWidth={2.2} />
          {props.label}
        </p>
      )}
      <Field
        label={props.label}
        hideLabel={props.large === true || props.labelIcon !== undefined}
        placeholder={props.placeholder ?? (props.large === true ? props.label : undefined)}
        size={props.large === true ? 'lg' : 'md'}
        type="password"
        value={password}
        onInput={setPassword}
        disabled={blocked || busy}
        autoFocus
        autoComplete="current-password"
        error={error}
      />
      {blocked && (
        <>
          <p class="bp-sr-only" role="status">
            {t('lock.blocked')}
          </p>
          <div class="bp-banner bp-banner-amber" aria-live="off">
            {t('lock.retryIn', { time: formatCountdown(left) })}
          </div>
        </>
      )}
      <Button
        type="submit"
        variant={props.variant ?? 'primary'}
        size={props.large === true ? 'lg' : 'md'}
        disabled={blocked || busy || password === '' || props.hold === true}
      >
        {busy ? t('lock.unlocking') : props.submitLabel}
      </Button>
    </form>
  );
}
