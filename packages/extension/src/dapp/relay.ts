import { PAGE_CHANNEL, WALLET_CHANNEL } from './wire';

export interface RelayWindow {
  readonly location: { readonly origin: string };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(
    type: 'message',
    listener: (event: { source: unknown; data: unknown }) => void,
  ): void;
}

export interface RelayRuntime {
  readonly id?: string | undefined;
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: {
    addListener(listener: (message: unknown, sender: { id?: string | undefined }) => void): void;
  };
}

/**
 * The content script (isolated world). It carries no logic: page messages in, worker answers
 * out. The worker, not this script, decides who the site is (from the browser's `sender`) and
 * validates every field.
 */
export function startRelay(win: RelayWindow, runtime: RelayRuntime): void {
  const toPage = (message: Record<string, unknown>): void => {
    win.postMessage({ ...message, channel: WALLET_CHANNEL }, win.location.origin);
  };

  win.addEventListener('message', (event) => {
    const data = event.data;
    if (event.source !== win || typeof data !== 'object' || data === null) return;
    const { channel, id, method, params } = data as Record<string, unknown>;
    if (channel !== PAGE_CHANNEL) return;
    runtime.sendMessage({ dapp: { id, method, params } }).then(
      (ack) => {
        // The answer comes later through onMessage; only a refusal is answered here.
        if (typeof ack === 'object' && ack !== null && 'accepted' in ack) return;
        const error =
          typeof ack === 'object' && ack !== null && 'error' in ack
            ? ack.error
            : { code: 'invalid-request', message: 'BeePocket did not accept the request.' };
        toPage({ id, error });
      },
      () => {
        toPage({ id, error: { code: 'invalid-request', message: 'BeePocket is not available.' } });
      },
    );
  });

  runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== runtime.id) return;
    if (typeof message !== 'object' || message === null || !('dapp' in message)) return;
    const dapp = message.dapp;
    if (typeof dapp === 'object' && dapp !== null) toPage({ ...(dapp as Record<string, unknown>) });
  });
}
