import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { browserClipboardRead } from '../../popup/clipboard';
import type { Scheduler } from '../home/env';

/**
 * What the first-run flow needs from the browser. The clipboard is read only from a user gesture
 * (a Paste button), asking for `clipboardRead` when it is not held (a refusal rejects); the timer
 * debounces the token-code lookup.
 */
export interface OnboardingEnv {
  clipboard: { readText(): Promise<string>; writeText(text: string): Promise<void> };
  scheduler: Pick<Scheduler, 'after'>;
}

export function browserOnboardingEnv(): OnboardingEnv {
  return {
    clipboard: {
      readText: browserClipboardRead,
      writeText: (text) => navigator.clipboard.writeText(text),
    },
    scheduler: {
      after: (ms, fn) => {
        const id = setTimeout(fn, ms);
        return () => {
          clearTimeout(id);
        };
      },
    },
  };
}

const OnboardingEnvContext = createContext<OnboardingEnv | null>(null);

export function OnboardingEnvProvider(props: { env: OnboardingEnv; children: ComponentChildren }) {
  return (
    <OnboardingEnvContext.Provider value={props.env}>
      {props.children}
    </OnboardingEnvContext.Provider>
  );
}

/** The env handed in by a provider, or null when the route has to build the browser's. */
export function useOptionalOnboardingEnv(): OnboardingEnv | null {
  return useContext(OnboardingEnvContext);
}

export function useOnboardingEnv(): OnboardingEnv {
  const env = useContext(OnboardingEnvContext);
  if (!env) throw new Error('useOnboardingEnv must be used inside an OnboardingEnvProvider');
  return env;
}
