import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import type { PasswordOutcome, Result } from '../../protocol';
import { Banner, Button, Sheet } from '../../ui';
import { useLockEnv } from '../lock/env';
import { PasswordForm } from '../lock/PasswordForm';

/** A shown phrase hides on its own after this idle time. */
export const REVEAL_IDLE_MS = 60_000;

/**
 * Password prompt, then the 24 words. Asks every time, even when unlocked. The phrase lives in
 * this component's state only: it is dropped when the sheet closes, when the screen unmounts
 * and as soon as the worker pushes any state but "unlocked" (weak lock included).
 */
export function RevealPhrase({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const { events } = useLockEnv();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return events.subscribe((e) => {
      if (e.state !== 'unlocked') onClose();
    });
  }, [events, onClose]);

  useEffect(() => {
    if (phrase === null) return;
    const idle = setTimeout(onClose, REVEAL_IDLE_MS);
    return () => {
      clearTimeout(idle);
    };
  }, [phrase, onClose]);

  const check = async (password: string): Promise<Result<PasswordOutcome>> => {
    const r = await client.call('wallet.revealMnemonic', { password });
    if (r.ok && r.value.status === 'ok') setPhrase(r.value.mnemonic);
    return r;
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
        <PasswordForm
          label={t('settings.reveal.password')}
          submitLabel={t('settings.reveal.submit')}
          check={check}
          onSuccess={() => undefined}
        />
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
