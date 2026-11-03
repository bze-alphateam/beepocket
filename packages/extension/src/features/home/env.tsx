import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Scheme, SchemeSource, ThemeTarget } from '../../theme';

/** Timers the home screen uses, injectable so tests drive time by hand. */
export interface Scheduler {
  /** Calls `fn` every `ms` until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
  /** Calls `fn` once after `ms` unless cancelled. */
  after(ms: number, fn: () => void): () => void;
}

/** Everything the home screen needs from the browser, handed in at the composition root. */
export interface HomeEnv {
  scheduler: Scheduler;
  /** Polling pauses while the document is hidden. */
  visibility: { hidden(): boolean };
  themeTarget: ThemeTarget;
  scheme: { current(): Scheme; subscribe(listener: () => void): () => void };
  clipboard: { writeText(text: string): Promise<void> };
}

/** `scheme` is the popup's appearance (setting + OS), so screens never read the OS alone. */
export function browserHomeEnv(scheme: SchemeSource): HomeEnv {
  return {
    scheduler: {
      every: (ms, fn) => {
        const id = setInterval(fn, ms);
        return () => {
          clearInterval(id);
        };
      },
      after: (ms, fn) => {
        const id = setTimeout(fn, ms);
        return () => {
          clearTimeout(id);
        };
      },
    },
    visibility: { hidden: () => document.hidden },
    themeTarget: document.documentElement,
    scheme,
    clipboard: { writeText: (text) => navigator.clipboard.writeText(text) },
  };
}

const HomeEnvContext = createContext<HomeEnv | null>(null);

export function HomeEnvProvider(props: { env: HomeEnv; children: ComponentChildren }) {
  return <HomeEnvContext.Provider value={props.env}>{props.children}</HomeEnvContext.Provider>;
}

export function useHomeEnv(): HomeEnv {
  const env = useContext(HomeEnvContext);
  if (!env) throw new Error('useHomeEnv must be used inside a HomeEnvProvider');
  return env;
}
