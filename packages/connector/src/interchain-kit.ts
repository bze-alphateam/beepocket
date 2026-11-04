import { CosmosWallet, ExtensionWallet, type Wallet } from '@interchain-kit/core';
import { beePocketLogo } from './logo.js';
import type { BeePocketProvider } from './provider.js';

/** The chains BeePocket serves: BeeZee mainnet and testnet. */
const SUPPORTED_CHAIN_IDS: readonly string[] = ['beezee-1', 'bzetestnet-3'];

/** The provider could not reach the wallet: the page must be reloaded. */
function isUnavailable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'unavailable'
  );
}

function sameBytes(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined): boolean {
  if (!a || !b) return false;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** The interchain-kit wallet description of the BeePocket extension. */
export const beePocketInfo: Wallet = {
  windowKey: 'beepocket',
  cosmosKey: 'beepocket',
  walletIdentifyKey: 'beepocket',
  name: 'beepocket-extension',
  prettyName: 'BeePocket',
  mode: 'extension',
  keystoreChange: 'beepocket_keystorechange',
  logo: beePocketLogo,
  downloads: [{ device: 'desktop', browser: 'chrome', link: 'https://getbze.com/wallet/add/' }],
};

/**
 * The cosmos side of the wallet. Unlike the stock `CosmosWallet` it talks to a provider that has
 * no `enable`, serves BeeZee only and never suggests a chain.
 */
export class BeePocketCosmosWallet extends CosmosWallet {
  /** The injected provider, which `init` found on `window`. */
  private get provider(): BeePocketProvider {
    return this.client as BeePocketProvider;
  }

  override async connect(chainId: string): Promise<void> {
    if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
      throw new Error('BeePocket supports BeeZee only');
    }
    await this.provider.connect(chainId);
  }

  /**
   * Signs through the provider and checks the answer. The wallet may change the fee (so
   * `authInfoBytes` differ) but never the messages: a response with other `bodyBytes` is refused.
   */
  override async signDirect(
    ...args: Parameters<CosmosWallet['signDirect']>
  ): ReturnType<CosmosWallet['signDirect']> {
    const response = await this.reachable(super.signDirect(...args));
    if (!sameBytes(response.signed.bodyBytes, args[2].bodyBytes)) {
      throw new Error('BeePocket returned a different transaction body than the one requested');
    }
    return response;
  }

  override sendTx(...args: Parameters<CosmosWallet['sendTx']>): ReturnType<CosmosWallet['sendTx']> {
    return this.reachable(super.sendTx(...args));
  }

  /**
   * A wallet the page cannot reach any more (the extension was updated, or does not answer)
   * fails every call until the page reloads. interchain-kit only shows that once its account
   * refresh fails, so an `unavailable` failure announces an account change: the refresh then
   * fails too and the dapp shows the wallet disconnected, with the reload message. Never done
   * from `getAccount`, which the refresh itself calls.
   */
  private async reachable<T>(call: Promise<T>): Promise<T> {
    try {
      return await call;
    } catch (error) {
      if (isUnavailable(error)) this.events.emit('accountChanged', () => undefined);
      throw error;
    }
  }

  override addSuggestChain(): Promise<void> {
    return Promise.reject(new Error('BeePocket supports BeeZee only'));
  }

  /** Disconnecting is done in the wallet's Settings. */
  override disconnect(): Promise<void> {
    return Promise.resolve();
  }

  override signAmino(): Promise<never> {
    return Promise.reject(new Error('Not supported by BeePocket'));
  }

  override signArbitrary(): Promise<never> {
    return Promise.reject(new Error('Not supported by BeePocket'));
  }
}

/** Builds a BeePocket wallet; `beePocketWallet` is the shared instance most dapps use. */
export function createBeePocketWallet(): ExtensionWallet {
  const wallet = new ExtensionWallet(beePocketInfo);
  wallet.setNetworkWallet('cosmos', new BeePocketCosmosWallet(beePocketInfo));
  return wallet;
}

export const beePocketWallet: ExtensionWallet = createBeePocketWallet();
