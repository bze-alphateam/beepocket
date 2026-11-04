import { installProvider } from './provider';

/** Content script, MAIN world: puts `window.beepocket` on the page. */
installProvider({
  win: window,
  timers: {
    set: (callback, ms) => window.setTimeout(callback, ms),
    clear: (handle) => {
      window.clearTimeout(handle as number);
    },
  },
  randomBytes: (bytes) => {
    crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
  },
});
