import { BroadcastMode, type CosmosWallet } from '@interchain-kit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beePocketInfo, beePocketWallet, createBeePocketWallet, type BeePocketKey } from '../src';

const KEY: BeePocketKey = {
  address: 'bze1abc',
  bech32Address: 'bze1abc',
  pubKey: Uint8Array.from([2, 3, 4]),
  name: 'Main',
  algo: 'secp256k1',
  isNanoLedger: false,
};

const SIGN_DOC = {
  bodyBytes: Uint8Array.from([1]),
  authInfoBytes: Uint8Array.from([2]),
  chainId: 'beezee-1',
  accountNumber: 7n,
};

function chain(chainId: string, chainName: string): never {
  return { chainId, chainName, chainType: 'cosmos' } as never;
}

function fakeProvider() {
  return {
    version: '1.0.0',
    connect: vi.fn().mockResolvedValue(KEY),
    getKey: vi.fn().mockResolvedValue(KEY),
    signDirect: vi.fn().mockResolvedValue({ signed: SIGN_DOC, signature: { signature: 'c2ln' } }),
    sendTx: vi.fn().mockResolvedValue(Uint8Array.from([9, 9])),
    on: vi.fn(),
    off: vi.fn(),
  };
}

function install(provider: unknown): void {
  Object.defineProperty(window, 'beepocket', { value: provider, configurable: true });
}

function newWallet() {
  const wallet = createBeePocketWallet();
  wallet.setChainMap([chain('beezee-1', 'beezee'), chain('cosmoshub-4', 'cosmoshub')]);
  return wallet;
}

function cosmos(wallet: ReturnType<typeof newWallet>): CosmosWallet {
  return wallet.getWalletByChainType('cosmos') as CosmosWallet;
}

beforeEach(() => {
  Reflect.deleteProperty(window, 'beepocket');
});

afterEach(() => {
  Reflect.deleteProperty(window, 'beepocket');
});

describe('beePocketInfo', () => {
  it('describes the extension for interchain-kit', () => {
    expect(beePocketInfo).toMatchObject({
      windowKey: 'beepocket',
      cosmosKey: 'beepocket',
      walletIdentifyKey: 'beepocket',
      name: 'beepocket-extension',
      prettyName: 'BeePocket',
      mode: 'extension',
      keystoreChange: 'beepocket_keystorechange',
    });
    expect(beePocketInfo.logo).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(beePocketInfo.downloads).toEqual([
      { device: 'desktop', browser: 'chrome', link: 'https://getbze.com/wallet/add/' },
    ]);
    expect(beePocketWallet.info).toBe(beePocketInfo);
  });
});

describe('init', () => {
  it('fails without the provider', async () => {
    await expect(newWallet().init()).rejects.toThrow('Client not exist');
  });

  it('passes with the provider', async () => {
    install(fakeProvider());
    await expect(newWallet().init()).resolves.toBeUndefined();
  });
});

describe('connect', () => {
  it('refuses another chain without calling the provider', async () => {
    const provider = fakeProvider();
    install(provider);
    const wallet = newWallet();
    await wallet.init();
    await expect(wallet.connect('cosmoshub-4')).rejects.toThrow('BeePocket supports BeeZee only');
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it.each(['beezee-1', 'bzetestnet-3'])('calls the provider for %s', async (chainId) => {
    const provider = fakeProvider();
    install(provider);
    const wallet = newWallet();
    wallet.setChainMap([chain(chainId, 'bze')]);
    await wallet.init();
    await wallet.connect(chainId);
    expect(provider.connect).toHaveBeenCalledExactlyOnceWith(chainId);
  });

  it.each(['locked-timeout', 'wrong-chain'])('surfaces a %s error as itself', async (code) => {
    const provider = fakeProvider();
    const failure = Object.assign(new Error('no'), { code });
    provider.connect.mockRejectedValue(failure);
    install(provider);
    const wallet = newWallet();
    await wallet.init();
    await expect(wallet.connect('beezee-1')).rejects.toBe(failure);
  });

  it('never suggests a chain, whatever the provider failure', async () => {
    const provider = fakeProvider();
    const failure = new Error('something else broke');
    provider.connect.mockRejectedValue(failure);
    const suggest = vi.fn();
    install({ ...provider, experimentalSuggestChain: suggest });
    const wallet = newWallet();
    await wallet.init();
    await expect(wallet.connect('beezee-1')).rejects.toThrow('something else broke');
    await expect(cosmos(wallet).addSuggestChain('beezee-1')).rejects.toThrow(
      'BeePocket supports BeeZee only',
    );
    expect(suggest).not.toHaveBeenCalled();
  });
});

describe('account and signing', () => {
  it('maps the provider key to a wallet account', async () => {
    const provider = fakeProvider();
    install(provider);
    const wallet = newWallet();
    await wallet.init();
    await expect(wallet.getAccount('beezee-1')).resolves.toEqual({
      username: 'Main',
      address: 'bze1abc',
      algo: 'secp256k1',
      pubkey: KEY.pubKey,
      isNanoLedger: false,
    });
    expect(provider.getKey).toHaveBeenCalledWith('beezee-1');
  });

  it('passes signDirect and sendTx through to the provider', async () => {
    const provider = fakeProvider();
    install(provider);
    const wallet = newWallet();
    await wallet.init();
    const signed = await cosmos(wallet).signDirect('beezee-1', 'bze1abc', SIGN_DOC);
    expect(signed.signed).toBe(SIGN_DOC);
    expect(provider.signDirect.mock.calls[0]?.slice(0, 3)).toEqual([
      'beezee-1',
      'bze1abc',
      SIGN_DOC,
    ]);
    const tx = Uint8Array.from([1, 2, 3]);
    await expect(cosmos(wallet).sendTx('beezee-1', tx, BroadcastMode.Sync)).resolves.toEqual(
      Uint8Array.from([9, 9]),
    );
    expect(provider.sendTx).toHaveBeenCalledWith('beezee-1', tx, 'sync');
  });

  it('refuses a signDirect answer for other messages, but accepts a changed fee', async () => {
    const provider = fakeProvider();
    install(provider);
    const wallet = newWallet();
    await wallet.init();
    const feeChanged = { ...SIGN_DOC, authInfoBytes: Uint8Array.from([5, 5]) };
    provider.signDirect.mockResolvedValueOnce({ signed: feeChanged, signature: {} });
    await expect(cosmos(wallet).signDirect('beezee-1', 'bze1abc', SIGN_DOC)).resolves.toMatchObject(
      { signed: feeChanged },
    );
    const swapped = { ...SIGN_DOC, bodyBytes: Uint8Array.from([1, 1]) };
    provider.signDirect.mockResolvedValueOnce({ signed: swapped, signature: {} });
    await expect(cosmos(wallet).signDirect('beezee-1', 'bze1abc', SIGN_DOC)).rejects.toThrow(
      'different transaction body',
    );
  });

  it('refuses amino and arbitrary signing', async () => {
    install(fakeProvider());
    const wallet = newWallet();
    await wallet.init();
    const inner = cosmos(wallet);
    await expect(inner.signAmino('beezee-1', 'bze1abc', {} as never)).rejects.toThrow(
      'Not supported by BeePocket',
    );
    await expect(inner.signArbitrary('beezee-1', 'bze1abc', 'x')).rejects.toThrow(
      'Not supported by BeePocket',
    );
  });

  it('disconnect leaves the connection alone', async () => {
    const provider = fakeProvider();
    install(provider);
    const wallet = newWallet();
    await wallet.init();
    await expect(wallet.disconnect('beezee-1')).resolves.toBeUndefined();
    for (const fn of Object.values(provider)) {
      if (typeof fn === 'function') expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe('a wallet the page cannot reach', () => {
  const unavailable = () =>
    Object.assign(new Error('BeePocket was updated. Reload this page.'), { code: 'unavailable' });

  it.each(['signDirect', 'sendTx'] as const)(
    '%s fails with unavailable and announces an account change, so the refresh disconnects',
    async (method) => {
      const provider = fakeProvider();
      const failure = unavailable();
      provider[method].mockRejectedValue(failure);
      install(provider);
      const wallet = newWallet();
      await wallet.init();
      const changed = vi.fn();
      wallet.events.on('accountChanged', changed);
      const call =
        method === 'signDirect'
          ? cosmos(wallet).signDirect('beezee-1', 'bze1abc', SIGN_DOC)
          : cosmos(wallet).sendTx('beezee-1', Uint8Array.from([1]), BroadcastMode.Sync);
      await expect(call).rejects.toBe(failure);
      expect(changed).toHaveBeenCalledOnce();
    },
  );

  it('announces nothing for other failures, nor when getAccount fails (no refresh loop)', async () => {
    const provider = fakeProvider();
    provider.signDirect.mockRejectedValue(Object.assign(new Error('no'), { code: 'rejected' }));
    provider.getKey.mockRejectedValue(unavailable());
    install(provider);
    const wallet = newWallet();
    await wallet.init();
    const changed = vi.fn();
    wallet.events.on('accountChanged', changed);
    await expect(cosmos(wallet).signDirect('beezee-1', 'bze1abc', SIGN_DOC)).rejects.toThrow('no');
    await expect(wallet.getAccount('beezee-1')).rejects.toMatchObject({ code: 'unavailable' });
    expect(changed).not.toHaveBeenCalled();
  });
});

describe('accountChanged', () => {
  it('is emitted when the extension changes the account', async () => {
    install(fakeProvider());
    const wallet = newWallet();
    await wallet.init();
    const changed = vi.fn();
    wallet.events.on('accountChanged', changed);
    window.dispatchEvent(new Event('beepocket_keystorechange'));
    expect(changed).toHaveBeenCalledOnce();
  });
});
