import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../background/registry';
import { registerHomeHandlers } from './handlers';

function run(profile: { ok: boolean; brandThemes?: boolean }) {
  const registry = new HandlerRegistry();
  registerHomeHandlers(registry, {
    services: { clients: () => Promise.resolve({ network: { id: 'testnet' } }) },
    wallet: {
      getProfile: () =>
        Promise.resolve(
          profile.ok
            ? { ok: true, value: { settings: { brandThemes: profile.brandThemes } } }
            : { ok: false, error: { code: 'wallet_locked', message: '' } },
        ),
    },
  } as never);
  return registry.dispatch({ method: 'home.context', payload: {} });
}

describe('home.context', () => {
  it('answers the network and the brand-themes setting', async () => {
    expect(await run({ ok: true, brandThemes: false })).toEqual({
      ok: true,
      value: { network: 'testnet', brandThemes: false },
    });
  });

  it('defaults to brand themes on while locked', async () => {
    expect(await run({ ok: false })).toEqual({
      ok: true,
      value: { network: 'testnet', brandThemes: true },
    });
  });
});
