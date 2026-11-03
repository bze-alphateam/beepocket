import { useEffect, useState } from 'preact/hooks';
import { useClient } from '../../popup/client-context';
import { useRoute } from '../../popup/router';
import { homeTarget } from '../lock/targets';
import { tokenColor } from '../home/format';
import {
  Confirm,
  IMPORT_CELLS,
  ImportPhrase,
  PasswordStep,
  Phrase,
  phraseOf,
  Start,
  Tokens,
  Welcome,
  type StepFrame,
  type WelcomeLink,
} from './screens';
import type { OnboardingRoute } from './routes';

type StepName = 'welcome' | 'phrase' | 'confirm' | 'import' | 'password' | 'start' | 'tokens';
type Path = 'create' | 'import';

const FLOWS: Record<Path, StepName[]> = {
  create: ['phrase', 'confirm', 'password', 'start', 'tokens'],
  import: ['import', 'password', 'start', 'tokens'],
};

const blankCells = () => Array.from({ length: IMPORT_CELLS }, () => '');

/**
 * The first-run flow. The recovery phrase (made or typed) lives only in this component's state:
 * it is dropped when the flow goes back to Welcome, as soon as the wallet exists, and with the
 * component when it unmounts. Nothing of it is written to storage, the URL or the console.
 */
export function Onboarding({ route }: { route: OnboardingRoute }) {
  const client = useClient();
  const { navigate } = useRoute();
  const importFirst = route.name === 'onboarding.import';
  const [step, setStep] = useState<StepName>(importFirst ? 'import' : 'welcome');
  const [path, setPath] = useState<Path>(importFirst ? 'import' : 'create');
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseFailed, setPhraseFailed] = useState(false);
  const [importCells, setImportCells] = useState<string[]>(blankCells);
  // Import opens on 12 cells, as on the board; the length control switches to 24.
  const [importLength, setImportLength] = useState<12 | 24>(12);
  const [importRejected, setImportRejected] = useState(false);
  // A token code that found a token makes the token step unnecessary.
  const [codeFound, setCodeFound] = useState(false);

  // The token behind a link, for the Welcome card; the card falls back to the host alone.
  const [linkToken, setLinkToken] = useState<{
    symbol: string;
    color: string;
    logo: string | null;
  } | null>(null);
  useEffect(() => {
    if (route.prefillCode === undefined || route.link === undefined) return;
    let live = true;
    void client.call('tokens.lookup', { code: route.prefillCode }).then((res) => {
      if (live && res.ok) {
        const { symbol, logo } = res.value;
        setLinkToken({ symbol, color: tokenColor(res.value), logo });
      }
    });
    return () => {
      live = false;
    };
  }, [client, route.prefillCode, route.link]);
  const link: WelcomeLink | undefined =
    route.link === undefined
      ? undefined
      : {
          symbol: linkToken?.symbol ?? null,
          color: linkToken?.color,
          logo: linkToken?.logo,
          host: route.link.host,
        };

  const generate = () => {
    setPhrase(null);
    setPhraseFailed(false);
    void client.call('wallet.generateMnemonic', {}).then((res) => {
      if (res.ok) setPhrase(res.value.mnemonic);
      else setPhraseFailed(true);
    });
  };

  const flow = FLOWS[path].filter((s) => !(codeFound && s === 'tokens'));
  const index = flow.indexOf(step);
  const forget = () => {
    setPhrase(null);
    setImportCells(blankCells());
    setImportLength(12);
    setImportRejected(false);
  };
  const back = () => {
    const prev = flow[index - 1];
    // Leaving the first step drops whatever phrase was shown or typed.
    if (prev === undefined) forget();
    setStep(prev ?? 'welcome');
  };
  const frame = (withBack = true): StepFrame => ({
    index,
    total: flow.length,
    onBack: withBack ? back : undefined,
  });
  // The home screen reads the preferred tokens itself and opens on the first one.
  const home = () => {
    navigate(homeTarget);
  };

  const walletMade = () => {
    forget();
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

  switch (step) {
    case 'welcome':
      return (
        <Welcome
          link={link}
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
    case 'phrase':
      return (
        <Phrase
          frame={frame()}
          phrase={phrase}
          failed={phraseFailed}
          onRetry={generate}
          onContinue={() => {
            setStep('confirm');
          }}
        />
      );
    case 'confirm':
      return (
        <Confirm
          frame={frame()}
          phrase={phrase ?? ''}
          onDone={() => {
            setStep('password');
          }}
        />
      );
    case 'import':
      return (
        <ImportPhrase
          frame={frame()}
          cells={importCells}
          length={importLength}
          error={importRejected}
          onChange={(cells, length) => {
            setImportRejected(false);
            setImportCells(cells);
            setImportLength(length);
          }}
          onDone={() => {
            setStep('password');
          }}
        />
      );
    case 'password':
      return (
        <PasswordStep
          frame={frame()}
          mode={path}
          mnemonic={path === 'create' ? (phrase ?? '') : phraseOf(importCells, importLength)}
          onCreated={walletMade}
          onBadPhrase={() => {
            setImportRejected(true);
            setStep(path === 'import' ? 'import' : 'phrase');
          }}
        />
      );
    case 'start':
      // No way back: the wallet exists now.
      return (
        <Start
          frame={frame(false)}
          prefillCode={route.prefillCode}
          linkHost={route.link?.host}
          warn={route.link !== undefined && !route.link.known}
          onFound={setCodeFound}
          onOpen={(denom) => addAll([denom])}
          onPick={() => {
            setStep('tokens');
          }}
        />
      );
    case 'tokens':
      return (
        <Tokens
          frame={{
            ...frame(),
            onBack: () => {
              setStep('start');
            },
          }}
          onFinish={addAll}
        />
      );
  }
}
