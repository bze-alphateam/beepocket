import { CosmosWallet, ExtensionWallet, type Wallet } from '@interchain-kit/core';
import { beePocketLogo } from './logo.js';
import type { BeePocketProvider } from './provider.js';

/** The chains BeePocket serves: BeeZee mainnet and testnet. */
const SUPPORTED_CHAIN_IDS: readonly string[] = ['beezee-1', 'bzetestnet-3'];

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
