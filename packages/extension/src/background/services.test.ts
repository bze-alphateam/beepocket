import { NETWORKS, type HttpRequest } from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import type { Platform } from '../platform';
import { createServices, NETWORK_KEY } from './services';

function services(stored?: unknown) {
  const storage = {
    get: () => Promise.resolve(stored),
    set: () => Promise.resolve(),
    remove: () => Promise.resolve(),
  };
  return createServices({
    storage,
    transport: { request: () => Promise.reject(new Error('x')) },
  } as unknown as Platform);
}

describe('createServices', () => {
  it('defaults to mainnet', async () => {
    expect(await services().activeNetwork()).toBe(NETWORKS.mainnet);
  });

  it('uses the stored network id', async () => {
    expect(NETWORK_KEY).toBe('network');
    expect(await services('testnet').activeNetwork()).toBe(NETWORKS.testnet);
  });

  it.each(['devnet', 3, null, 'toString'])('falls back to mainnet for stored %j', async (v) => {
    expect(await services(v).activeNetwork()).toBe(NETWORKS.mainnet);
  });

  it('builds clients for a given network regardless of the stored one', async () => {
    const c = await services('testnet').clients('mainnet');
    expect(c.network.id).toBe('mainnet');
  });

  it('builds clients for the active network', async () => {
    const c = await services('testnet').clients();
    expect(c.network.id).toBe('testnet');
    expect(typeof c.chain.account).toBe('function');
    expect(typeof c.scan.activity).toBe('function');
  });

  it('ties every request of clients built with a signal to it', async () => {
    const seen: HttpRequest[] = [];
    const built = createServices({
      storage: { get: () => Promise.resolve(undefined) },
      transport: {
        request: (req: HttpRequest) => {
          seen.push(req);
          return Promise.reject(new Error('x'));
        },
      },
    } as unknown as Platform);
    const controller = new AbortController();
    const c = await built.clients(undefined, controller.signal);
    await expect(c.chain.account('bze1x')).rejects.toThrow();
    expect(seen[0]?.signal).toBe(controller.signal);
    controller.abort();
    await expect(c.chain.account('bze1x')).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
});
