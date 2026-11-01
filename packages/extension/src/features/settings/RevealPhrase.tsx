import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { Banner, Button, Sheet, TextField } from '../../ui';

/**
 * Password prompt, then the 24 words. Asks every time, even when unlocked. The phrase lives in
 * this component's state only and is dropped when the sheet closes or the screen unmounts.
 */
/** Shown phrases hide on their own after this idle time, and as soon as the wallet is no longer unlocked. */
export const REVEAL_IDLE_MS = 60_000;
export const REVEAL_POLL_MS = 2_000;

export function RevealPhrase({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const [password, setPassword] = useState('');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Only an unlocked wallet may show the phrase: a weak or full lock closes the sheet.
  useEffect(() => {
    if (phrase === null) return;
    const idle = setTimeout(onClose, REVEAL_IDLE_MS);
    const poll = setInterval(() => {
      void client.call('wallet.state', {}).then((r) => {
        if (!r.ok || r.value.state !== 'unlocked') onClose();
      });
    }, REVEAL_POLL_MS);
    return () => {
      clearTimeout(idle);
      clearInterval(poll);
    };
  }, [client, phrase, onClose]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await client.call('wallet.revealMnemonic', { password });
    setBusy(false);
    setPassword('');
    if (!r.ok) {
      setError(t('settings.reveal.failed'));
    } else if (r.value.status === 'ok') {
      setPhrase(r.value.mnemonic);
    } else if (r.value.status === 'throttled') {
      const seconds = Math.max(1, Math.ceil((r.value.retryAt - Date.now()) / 1000));
      setError(t('settings.reveal.throttled', { seconds }));
    } else {
      setError(t('settings.reveal.wrong'));
    }
  };

  const copy = async () => {
    if (phrase === null) return;
    try {
      await navigator.clipboard.writeText(phrase);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Sheet open title={t('settings.reveal.title')} onClose={onClose}>
      {phrase === null ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField
            label={t('settings.reveal.password')}
            type="password"
            value={password}
            onInput={setPassword}
            {...(error === null ? {} : { error })}
            disabled={busy}
            autoFocus
          />
          <Button type="submit" disabled={busy || password === ''}>
            {t('settings.reveal.submit')}
          </Button>
        </form>
      ) : (
        <div>
          <Banner tone="amber">{t('settings.reveal.warning')}</Banner>
          <ol class="bp-phrase">
            {phrase.split(' ').map((word, i) => (
              <li key={i}>{word}</li>
            ))}
          </ol>
          <Button
            variant="quiet"
            onClick={() => {
              void copy();
            }}
          >
            {copied ? t('settings.reveal.copied') : t('settings.reveal.copy')}
          </Button>
          <Button onClick={onClose}>{t('settings.reveal.hide')}</Button>
        </div>
      )}
    </Sheet>
  );
}
