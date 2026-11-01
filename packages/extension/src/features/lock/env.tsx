import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Clock } from '@beepocket/core';
import type { StateEvents } from './events';

export interface LockEnv {
  clock: Clock;
  events: StateEvents;
}

const LockEnvContext = createContext<LockEnv | null>(null);

/** Hands the clock and the state-event source to the lock feature; built at the popup root. */
export function LockEnvProvider(props: LockEnv & { children: ComponentChildren }) {
  const env = { clock: props.clock, events: props.events };
  return <LockEnvContext.Provider value={env}>{props.children}</LockEnvContext.Provider>;
}

export function useLockEnv(): LockEnv {
  const env = useContext(LockEnvContext);
  if (!env) throw new Error('useLockEnv must be used inside a LockEnvProvider');
  return env;
}
