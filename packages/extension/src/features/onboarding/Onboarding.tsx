import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import { homeTarget } from '../lock/targets';
import { AppearanceToggle } from '../../popup/appearance';
import { Layout } from '../../popup/Layout';
import {
  Confirm,
  ImportPhrase,
  PasswordStep,
  Phrase,
  Start,
  Step,
  Tokens,
  Welcome,
  wordsOf,
} from './screens';
import type { OnboardingRoute } from './routes';

type StepName = 'welcome' | 'phrase' | 'confirm' | 'import' | 'password' | 'start' | 'tokens';
type Path = 'create' | 'import';

const FLOWS: Record<Path, StepName[]> = {
  create: ['phrase', 'confirm', 'password', 'start', 'tokens'],
  import: ['import', 'password', 'start', 'tokens'],
};

/**
 * The first-run flow. The recovery phrase lives only in this component's state: it is dropped
 * as soon as the wallet exists, and again when the component unmounts.
 */
function linkStrip(symbol: string | null, host: string | null): string | undefined {
  if (symbol === null)
    return host === null ? undefined : t('onboarding.link.stripNoToken', { host });
  return host === null
    ? t('onboarding.link.stripNoSite', { symbol })
    : t('onboarding.link.strip', { symbol, host });
}

export function Onboarding({ route }: { route: OnboardingRoute }) {
  const client = useClient();
  const { navigate } = useRoute();
  const importFirst = route.name === 'onboarding.import';
  const [step, setStep] = useState<StepName>(importFirst ? 'import' : 'welcome');
  const [path, setPath] = useState<Path>(importFirst ? 'import' : 'create');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseFailed, setPhraseFailed] = useState(false);
  const [importText, setImportText] = useState('');
  const [importRejected, setImportRejected] = useState(false);

  // The token behind a link, for the Welcome strip; the strip falls back to the host alone.
  const [linkSymbol, setLinkSymbol] = useState<string | null>(null);
  useEffect(() => {
    if (route.prefillCode === undefined || route.link === undefined) return;
    let live = true;
    void client.call('tokens.lookup', { code: route.prefillCode }).then((res) => {
      if (live && res.ok) setLinkSymbol(res.value.symbol);
    });
    return () => {
      live = false;
    };
  }, [client, route.prefillCode, route.link]);
  const strip = route.link === undefined ? undefined : linkStrip(linkSymbol, route.link.host);

  const generate = () => {
    setPhrase(null);
    setPhraseFailed(false);
    void client.call('wallet.generateMnemonic', {}).then((res) => {
      if (res.ok) setPhrase(res.value.mnemonic);
      else setPhraseFailed(true);
    });
  };

  const flow = FLOWS[path];
  const index = flow.indexOf(step);
  const back = () => {
    const prev = flow[index - 1];
    if (prev === undefined) {
      // Leaving the first step drops whatever phrase was shown or typed.
      setPhrase(null);
      setImportText('');
    }
    setStep(prev ?? 'welcome');
  };
  // The home screen reads the preferred tokens itself and opens on the first one.
  const home = () => {
    navigate(homeTarget);
  };

  const walletMade = () => {
    setPhrase(null);
    setImportText('');
    setStep('start');
  };

  const addAll = async (denoms: string[]): Promise<boolean> => {
    // A failed attempt may have added some tokens: a retry only adds what is still missing.
    const current = await client.call('tokens.preferred', {});
    if (!current.ok) return false;
    let last = current.value;
    for (const denom of denoms) {
      if (last.some((tok) => tok.denom === denom)) continue;
      const res = await client.call('tokens.add', { denom });
      if (!res.ok) return false;
      last = res.value;
    }
    home();
    return true;
  };

  let body;
  switch (step) {
    case 'welcome':
      body = (
        <Welcome
          strip={strip}
          onCreate={() => {
            setPath('create');
            setStep('phrase');
            generate();
          }}
          onImport={() => {
            setPath('import');
            setStep('import');
          }}
        />
      );
      break;
    case 'phrase':
      body = (
        <Step index={index} total={flow.length} title={t('onboarding.phrase.title')} onBack={back}>
          <Phrase
            phrase={phrase}
            failed={phraseFailed}
            onRetry={generate}
            onContinue={() => {
              setStep('confirm');
            }}
          />
        </Step>
      );
      break;
    case 'confirm':
      body = (
        <Step
          index={index}
          total={flow.length}
          title={t('onboarding.confirm.title')}
          hint={t('onboarding.confirm.hint')}
          onBack={back}
        >
          <Confirm
            phrase={phrase ?? ''}
            onDone={() => {
              setStep('password');
            }}
          />
        </Step>
      );
      break;
    case 'import':
      body = (
        <Step
          index={index}
          total={flow.length}
          title={t('onboarding.import.title')}
          hint={t('onboarding.import.hint')}
          onBack={back}
        >
          <ImportPhrase
            value={importText}
            error={importRejected}
            onInput={(v) => {
              setImportRejected(false);
              setImportText(v);
            }}
            onDone={() => {
              setStep('password');
            }}
          />
        </Step>
      );
      break;
    case 'password':
      body = (
        <Step
          index={index}
          total={flow.length}
          title={t('onboarding.password.title')}
          hint={t('onboarding.password.hint')}
          onBack={back}
        >
          <PasswordStep
            mode={path}
            mnemonic={path === 'create' ? (phrase ?? '') : wordsOf(importText).join(' ')}
            onCreated={walletMade}
            onBadPhrase={() => {
              setImportRejected(true);
              setStep(path === 'import' ? 'import' : 'phrase');
            }}
          />
        </Step>
      );
      break;
    case 'start':
      body = (
        <Step
          index={index}
          total={flow.length}
          title={t('onboarding.start.title')}
          hint={t('onboarding.start.hint')}
        >
          <Start
            prefillCode={route.prefillCode}
            warn={route.link !== undefined && !route.link.known}
            onOpen={(denom) => addAll([denom])}
            onPick={() => {
              setStep('tokens');
            }}
          />
        </Step>
      );
      break;
    case 'tokens':
      body = (
        <Step
          index={index}
          total={flow.length}
          title={t('onboarding.tokens.title')}
          hint={t('onboarding.tokens.hint')}
          onBack={() => {
            setStep('start');
          }}
        >
          <Tokens onFinish={addAll} />
        </Step>
      );
      break;
  }
  return (
    <Layout glow="tall" corner={step === 'welcome' ? <AppearanceToggle /> : undefined}>
      {body}
    </Layout>
  );
}
