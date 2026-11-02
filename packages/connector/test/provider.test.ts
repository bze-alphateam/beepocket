import { describe, expect, it, vi } from 'vitest';
import { getBeePocket, type BeePocketProvider, type ProviderHost } from '../src';

const PROVIDER = { version: '1.0.0' } as BeePocketProvider;

function fakeHost(initial?: BeePocketProvider): ProviderHost & { fire(): void } {
  const listeners = new Set<() => void>();
  const host: ProviderHost & { fire(): void } = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    fire: () => {
      for (const listener of [...listeners]) listener();
    },
  };
  if (initial) host.beepocket = initial;
  return host;
}

describe('getBeePocket', () => {
  it('resolves at once when the provider exists', async () => {
    await expect(getBeePocket(1000, fakeHost(PROVIDER))).resolves.toBe(PROVIDER);
  });

  it('resolves when the extension announces itself', async () => {
    const host = fakeHost();
    const found = getBeePocket(1000, host);
    host.beepocket = PROVIDER;
    host.fire();
    await expect(found).resolves.toBe(PROVIDER);
  });

  it('resolves undefined after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const found = getBeePocket(500, fakeHost());
      await vi.advanceTimersByTimeAsync(500);
      await expect(found).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
