import {
  ACK_FIELD,
  DappErrorCodes,
  NOT_RESPONDING_MESSAGE,
  PAGE_CHANNEL,
  UPDATED_MESSAGE,
  WALLET_CHANNEL,
} from './wire';

export interface RelayWindow {
  readonly location: { readonly origin: string };
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(
    type: 'message',
    listener: (event: { source: unknown; data: unknown }) => void,
  ): void;
}

export interface RelayRuntime {
  /** Gone (undefined) once the extension was reloaded or updated under this script. */
  readonly id?: string | undefined;
  /** Throws synchronously when this script's extension context is gone. */
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: {
    addListener(listener: (message: unknown, sender: { id?: string | undefined }) => void): void;
  };
}

/**
 * The content script (isolated world). It carries no logic: page messages in, worker answers
 * out. The worker, not this script, decides who the site is (from the browser's `sender`) and
 * validates every field.
 *
 * Every request ends in a message to the page: the worker's ack (then its answer later), its
 * refusal, or `unavailable` when the worker cannot be reached. A script left behind by an
 * extension reload or update has no worker any more: it answers `unavailable` at once.
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
    const unavailable = (message: string): void => {
      toPage({ id, error: { code: DappErrorCodes.unavailable, message } });
    };
    let sent: Promise<unknown>;
    try {
      if (runtime.id === undefined) throw new Error('Extension context invalidated.');
      sent = runtime.sendMessage({ dapp: { id, method, params } });
    } catch {
      unavailable(UPDATED_MESSAGE);
      return;
    }
    sent.then(
      (ack) => {
        // Taken: the page stops its liveness timer; the answer comes later through onMessage.
        if (typeof ack === 'object' && ack !== null && 'accepted' in ack) {
          toPage({ id, [ACK_FIELD]: true });
          return;
        }
        const error =
          typeof ack === 'object' && ack !== null && 'error' in ack
            ? ack.error
            : {
                code: DappErrorCodes.invalidRequest,
                message: 'BeePocket did not accept the request.',
              };
        toPage({ id, error });
      },
      () => {
        unavailable(runtime.id === undefined ? UPDATED_MESSAGE : NOT_RESPONDING_MESSAGE);
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
