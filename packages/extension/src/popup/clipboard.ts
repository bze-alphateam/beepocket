import { useEffect, useRef, useState } from 'preact/hooks';

/** The slice of `chrome.permissions` a Paste button needs. */
export interface ClipboardPermissions {
  contains(permissions: { permissions: 'clipboardRead'[] }): Promise<boolean>;
  request(permissions: { permissions: 'clipboardRead'[] }): Promise<boolean>;
}

/** The slice of `navigator.clipboard` a Paste button needs. */
export interface ClipboardSource {
  readText(): Promise<string>;
}

/** The user said no to reading the clipboard, or the browser refused the read. */
export class ClipboardRefusedError extends Error {
  constructor() {
    super('The clipboard could not be read.');
    this.name = 'ClipboardRefusedError';
  }
}

const CLIPBOARD_READ: { permissions: 'clipboardRead'[] } = { permissions: ['clipboardRead'] };

/**
 * Reads the clipboard on a Paste tap. Extension pages may only read it with `clipboardRead`,
 * which the manifest lists as optional: it is asked for on the first tap, from inside that tap's
 * user gesture, so installing the wallet shows no clipboard warning. Rejects with
 * `ClipboardRefusedError` when the permission is declined or the read fails anyway.
 */
export async function readPermittedClipboard(
  permissions: ClipboardPermissions,
  clipboard: ClipboardSource,
): Promise<string> {
  try {
    const held = await permissions.contains(CLIPBOARD_READ);
    if (!held && !(await permissions.request(CLIPBOARD_READ))) throw new ClipboardRefusedError();
    return await clipboard.readText();
  } catch {
    throw new ClipboardRefusedError();
  }
}

/** The browser's: `chrome.permissions` and `navigator.clipboard`, only touched on a tap. */
export function browserClipboardRead(): Promise<string> {
  return readPermittedClipboard(chrome.permissions, navigator.clipboard);
}

/**
 * A Paste button's tap. The text goes to `onText`; a refused read focuses `focusTarget()` so
 * Ctrl+V / ⌘V works right away, and sets `refused` for the screen's hint. Nothing lands after
 * the screen is gone.
 */
export function usePaste(
  read: () => Promise<string>,
  onText: (text: string) => void,
  focusTarget: () => HTMLElement | null | undefined,
): { paste: () => void; refused: boolean; clearRefused: () => void } {
  const [refused, setRefused] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const paste = () => {
    setRefused(false);
    // Read only here, on the user's tap: never on mount or on entering a screen.
    void read().then(
      (text) => {
        if (mounted.current) onText(text);
      },
      () => {
        if (!mounted.current) return;
        setRefused(true);
        focusTarget()?.focus();
      },
    );
  };
  return {
    paste,
    refused,
    clearRefused: () => {
      setRefused(false);
    },
  };
}
