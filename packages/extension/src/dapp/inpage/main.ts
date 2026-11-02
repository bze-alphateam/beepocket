import { installProvider } from './provider';

/** Content script, MAIN world: puts `window.beepocket` on the page. */
installProvider({
  win: window,
  randomBytes: (bytes) => {
    crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
  },
});
