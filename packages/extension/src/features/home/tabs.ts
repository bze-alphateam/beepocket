import type { ComponentChildren } from 'preact';
import type { ListedToken, TokenBalances, WalletAddress } from '../../protocol';

/** What a tab below the balance gets to render. */
export interface HomeTabContext {
  token: ListedToken;
  /** Every token in the wallet's list, for tabs that show more than the selected one. */
  tokens: ListedToken[];
  /** Null until the first read finished. */
  balances: TokenBalances | null;
  addresses: WalletAddress[];
  /** Reads the balances again now (after a send, say). */
  refresh: () => Promise<void>;
}

export interface HomeTab {
  id: string;
  label: string;
  render(ctx: HomeTabContext): ComponentChildren;
}

const tabs: HomeTab[] = [];

/** The `HomeTabs` slot: stories add their tab; registering an id again replaces that tab. */
export function registerHomeTab(tab: HomeTab): void {
  const at = tabs.findIndex((t) => t.id === tab.id);
  if (at >= 0) tabs[at] = tab;
  else tabs.push(tab);
}

/** Tabs after the built-in Addresses tab, in registration order. */
export function homeTabs(): readonly HomeTab[] {
  return tabs;
}
