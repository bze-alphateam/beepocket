import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { HomeEnv } from '../home/env';

/**
 * What the send flow needs from the browser, handed in at the route: the timer behind the
 * fee estimate's debounce, the theme target and scheme for the token's kit, the clipboard.
 */
export type SendEnv = Pick<HomeEnv, 'scheduler' | 'themeTarget' | 'scheme' | 'clipboard'>;

const SendEnvContext = createContext<SendEnv | null>(null);

export function SendEnvProvider(props: { env: SendEnv; children: ComponentChildren }) {
  return <SendEnvContext.Provider value={props.env}>{props.children}</SendEnvContext.Provider>;
}

export function useSendEnv(): SendEnv {
  const env = useContext(SendEnvContext);
  if (!env) throw new Error('useSendEnv must be used inside a SendEnvProvider');
  return env;
}
