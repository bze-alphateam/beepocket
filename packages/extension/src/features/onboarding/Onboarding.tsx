import { useEffect, useState } from 'preact/hooks';
import { t } from '../../i18n';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
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
export function Onboarding({ route }: { route: OnboardingRoute }) {
  const client = useClient();
  const { navigate } = useRoute<{ name: 'home'; denom?: string } | OnboardingRoute>();
  const [step, setStep] = useState<StepName>('welcome');
  const [path, setPath] = useState<Path>('create');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseFailed, setPhraseFailed] = useState(false);
  const [importText, setImportText] = useState('');
  const [importRejected, setImportRejected] = useState(false);

  useEffect(
    () => () => {
      setPhrase(null);
      setImportText('');
    },
    [],
  );

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
    setStep(prev ?? 'welcome');
  };
  const home = (denom?: string) => {
    navigate(denom === undefined ? { name: 'home' } : { name: 'home', denom });
  };

  const walletMade = () => {
    setPhrase(null);
    setImportText('');
    setStep('start');
  };

  const addAll = async (denoms: string[]): Promise<boolean> => {
    let last: { denom: string }[] = [];
    for (const denom of denoms) {
      const res = await client.call('tokens.add', { denom });
      if (!res.ok) return false;
      last = res.value;
    }
    home(last[0]?.denom);
    return true;
  };

  let body;
  switch (step) {
    case 'welcome':
      body = (
        <Welcome
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
          onBack={() => undefined}
        >
          <Start
            prefillCode={route.prefillCode}
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
  return <Layout>{body}</Layout>;
}
