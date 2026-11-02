/** Where an add-a-token link reached the wallet from. */
export type AddTokenSource = 'link' | 'install';

/** What the add-a-token window shows. */
export type AddTokenView =
  /** Nothing waits: the window falls back to the normal wallet. */
  | { status: 'none' }
  | {
      status: 'link';
      source: AddTokenSource;
      code: string;
      /** The linking site's host for display, or `null` for "a link". Never trusted. */
      host: string | null;
      /** Only a getbze.com host counts; a link that arrived during install is never known. */
      known: boolean;
    };

export interface AddTokenProtocol {
  /** The link that waits for the user. Own pages only. */
  'addtoken.current': { req: Record<string, never>; res: AddTokenView };
  /** The user is done with the link (added, opened or cancelled). */
  'addtoken.clear': { req: Record<string, never>; res: Record<string, never> };
}
