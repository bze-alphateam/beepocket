import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import type { PasswordOutcome, Result } from '../../protocol';
import { Banner, Button, PhraseReveal, WordGrid } from '../../ui';
import { useLockEnv } from '../lock/env';
import { PasswordForm } from '../lock/PasswordForm';
import { useRoute, type RouteBase } from '../../popup/router';
import { useSettingsEnv } from './env';
import { SETTINGS_PARENT, SettingsPage } from './SettingsPage';

/** A shown phrase hides on its own after this idle time. */
export const REVEAL_IDLE_MS = 60_000;

/**
 * Settings › Security › Show recovery phrase, a page. Password prompt, then the 24 words behind the onboarding veil (`Ob-Phrase` without the step
 * header). Asks every time, even when unlocked. The phrase lives in this component's state only:
 * it is dropped when the page is left, when the screen unmounts and as soon as the worker pushes
 * any state but "unlocked" (weak lock included).
 */
export function RevealPhrase() {
  const { navigate } = useRoute<RouteBase>();
  const onClose = () => {
    navigate(SETTINGS_PARENT['settings.reveal']);
  };
  const client = useClient();
  const env = useSettingsEnv();
  const { events } = useLockEnv();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // The parent passes a new `onClose` on every render (Home re-renders on its balance refresh):
  // a ref keeps the timer and the subscription from restarting with it.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    return events.subscribe((e) => {
      if (e.state !== 'unlocked') close.current();
    });
  }, [events]);

  useEffect(() => {
    if (phrase === null) return;
    const idle = setTimeout(() => {
      close.current();
    }, REVEAL_IDLE_MS);
    return () => {
      clearTimeout(idle);
    };
  }, [phrase]);

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
      <SettingsPage title={t('settings.reveal.title')} parent={SETTINGS_PARENT['settings.reveal']}>
        <PasswordForm
          label={t('settings.reveal.password')}
          submitLabel={t('settings.reveal.submit')}
          check={check}
          onSuccess={() => undefined}
        />
      </SettingsPage>
    );
  }
  const words = phrase.split(' ');
  return (
    <SettingsPage
      title={t('settings.reveal.title')}
      parent={SETTINGS_PARENT['settings.reveal']}
      actions={
        <div class="bp-bottom">
          <Button onClick={onClose}>{t('settings.reveal.hide')}</Button>
        </div>
      }
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
    </SettingsPage>
  );
}
