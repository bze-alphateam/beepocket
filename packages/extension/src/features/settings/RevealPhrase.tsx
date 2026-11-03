import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import type { PasswordOutcome, Result } from '../../protocol';
import { Banner, Button, PhraseReveal, Sheet, WordGrid } from '../../ui';
import { useLockEnv } from '../lock/env';
import { PasswordForm } from '../lock/PasswordForm';
import { useSettingsEnv } from './env';

/** A shown phrase hides on its own after this idle time. */
export const REVEAL_IDLE_MS = 60_000;

/**
 * Password prompt, then the 24 words behind the onboarding veil (`Ob-Phrase` without the step
 * header). Asks every time, even when unlocked. The phrase lives in this component's state only:
 * it is dropped when the sheet closes, when the screen unmounts and as soon as the worker pushes
 * any state but "unlocked" (weak lock included).
 */
export function RevealPhrase({ onClose }: { onClose: () => void }) {
  const client = useClient();
  const env = useSettingsEnv();
  const { events } = useLockEnv();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
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

  const copy = () => {
    if (phrase === null) return;
    // A failed copy changes nothing on screen.
    void env.clipboard.writeText(phrase).then(
      () => {
        setCopied(true);
      },
      () => undefined,
    );
  };

  if (phrase === null) {
    return (
      <Sheet open title={t('settings.reveal.title')} onClose={onClose}>
        <PasswordForm
          label={t('settings.reveal.password')}
          submitLabel={t('settings.reveal.submit')}
          check={check}
          onSuccess={() => undefined}
        />
      </Sheet>
    );
  }
  const words = phrase.split(' ');
  return (
    <Sheet
      open
      title={t('settings.reveal.title')}
      onClose={onClose}
      height="tall"
      actions={<Button onClick={onClose}>{t('settings.reveal.hide')}</Button>}
    >
      <div class="bp-settings-reveal">
        <Banner tone="amber">{t('settings.reveal.warning')}</Banner>
        <PhraseReveal
          count={words.length}
          revealed={revealed}
          onReveal={() => {
            setRevealed(true);
          }}
          revealLabel={t('settings.reveal.veil')}
          privacyLabel={t('settings.reveal.privacy')}
        >
          <WordGrid words={words} />
        </PhraseReveal>
        {revealed && (
          <Button variant="chip" icon={copied ? 'check' : 'copy'} class="ob-copy" onClick={copy}>
            {copied ? t('settings.reveal.copied') : t('settings.reveal.copy')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
