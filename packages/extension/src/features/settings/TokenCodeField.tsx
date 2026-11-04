import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { TokenErrorCodes, type ListedToken } from '../../protocol';
import { usePaste } from '../../popup/clipboard';
import { useClient } from '../../popup/client-context';
import { Button, Field } from '../../ui';
import { useSettingsEnv } from './env';

type CodeError = 'noSuchToken' | 'invalid' | 'failed';

const CODE_ERRORS = {
  noSuchToken: 'onboarding.start.noSuchToken',
  invalid: 'onboarding.start.invalid',
  failed: 'onboarding.start.failed',
} as const;

/** How long typing pauses before the code is looked up (as in onboarding). */
const LOOKUP_DELAY_MS = 400;
/** No denom is longer: a longer code is invalid without asking the worker. */
const MAX_CODE_LENGTH = 128;

/**
 * The token denom entry of Preferred tokens: finds a token the wallet does not hold, the way
 * onboarding's fast track does. A found token goes to `onFound`; anything else stays an inline
 * message under the field.
 */
export function TokenCodeField(props: { onFound: (token: ListedToken) => void }) {
  const client = useClient();
  const env = useSettingsEnv();
  const [code, setCode] = useState('');
  const [error, setError] = useState<CodeError | null>(null);
  // Only the latest lookup may land: an older, slower answer is dropped.
  const seq = useRef(0);
  const form = useRef<HTMLFormElement>(null);
  const cancelTimer = useRef<() => void>(() => undefined);
  const { onFound } = props;
  const lookup = async (value: string) => {
    cancelTimer.current();
    const trimmed = value.trim();
    const mine = ++seq.current;
    setError(null);
    if (trimmed === '') return;
    if (trimmed.length > MAX_CODE_LENGTH) {
      setError('invalid');
      return;
    }
    const res = await client.call('tokens.lookup', { code: trimmed });
    if (mine !== seq.current) return;
    if (res.ok) onFound(res.value);
    else if (res.error.code === TokenErrorCodes.noSuchToken) setError('noSuchToken');
    else if (res.error.code === TokenErrorCodes.invalidCode) setError('invalid');
    else setError('failed');
  };
  // A refused read leaves the field focused for Ctrl+V / ⌘V, which arrives as typing.
  const { paste, refused, clearRefused } = usePaste(
    () => env.clipboard.readText(),
    (text) => {
      const value = text.trim();
      setCode(value);
      void lookup(value);
    },
    () => form.current?.querySelector('input'),
  );
  const typed = (value: string) => {
    clearRefused();
    setCode(value);
    seq.current++;
    setError(null);
    cancelTimer.current();
    cancelTimer.current = env.scheduler.after(LOOKUP_DELAY_MS, () => void lookup(value));
  };
  // Drop a pending lookup on leaving (a clipboard read still running lands nowhere).
  useEffect(
    () => () => {
      cancelTimer.current();
      seq.current++;
    },
    [],
  );
  return (
    <form
      ref={form}
      class="ob-code"
      onSubmit={(e) => {
        e.preventDefault();
        void lookup(code);
      }}
    >
      <Field
        label={t('onboarding.start.codeLabel')}
        hideLabel
        mono
        value={code}
        placeholder={t('onboarding.start.codePlaceholder')}
        error={
          error === null
            ? undefined
            : error === 'noSuchToken'
              ? `${t('onboarding.start.noSuchToken')} ${t('onboarding.start.noSuchTokenHint')}`
              : t(CODE_ERRORS[error])
        }
        hint={refused ? t('app.pasteHint') : t('onboarding.start.codeHint')}
        onInput={typed}
        trailing={
          <Button variant="ghost" label={t('onboarding.start.pasteLabel')} onClick={paste}>
            {t('onboarding.start.paste')}
          </Button>
        }
      />
    </form>
  );
}
