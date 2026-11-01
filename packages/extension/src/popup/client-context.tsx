import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import type { Client } from '../protocol/client';

const ClientContext = createContext<Client | null>(null);

/** Hands the worker `Client` to the UI; components never build their own. */
export function ClientProvider(props: { client: Client; children: ComponentChildren }) {
  return <ClientContext.Provider value={props.client}>{props.children}</ClientContext.Provider>;
}

export function useClient(): Client {
  const client = useContext(ClientContext);
  if (!client) throw new Error('useClient must be used inside a ClientProvider');
  return client;
}
