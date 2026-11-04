import { describe, expect, it, vi } from 'vitest';
import { HandlerRegistry } from '../background/registry';
import { ok } from '../protocol';
import { registerDappPopupHandlers } from './popup-handlers';
import type { DappService } from './service';

function rig() {
  const answer = vi.fn(() => Promise.resolve(ok({})));
  const registry = new HandlerRegistry();
  registerDappPopupHandlers(registry, { answer } as unknown as DappService);
  const call = (payload: unknown) => registry.dispatch({ method: 'dapp.answer', payload });
  return { answer, call };
}

const fee = { denom: 'ubze', amount: '6000', gasLimit: '300000' };

describe('dapp.answer', () => {
  it('passes a reviewed fee with Advanced settings through to the service', async () => {
    const t = rig();
    const override = { gasLimit: '300000', gasPrice: 2 };
    expect(
      await t.call({ id: 's1', approve: true, fee: { ...fee, override, extra: 'dropped' } }),
    ).toMatchObject({ ok: true });
    expect(t.answer).toHaveBeenCalledWith('s1', { approve: true, fee: { ...fee, override } });
  });

  it('passes a reviewed fee without settings through as before', async () => {
    const t = rig();
    await t.call({ id: 's1', approve: true, fee });
    expect(t.answer).toHaveBeenCalledWith('s1', { approve: true, fee });
  });

  it('refuses malformed settings before the service sees them', async () => {
    const t = rig();
    for (const override of [
      { gasLimit: '300000', gasPrice: 4 },
      { gasLimit: '300000', gasPrice: 1.5 },
      { gasLimit: '300000', gasPrice: '2' },
      { gasLimit: '0', gasPrice: 1 },
      { gasLimit: '012', gasPrice: 1 },
      { gasLimit: 300000, gasPrice: 1 },
      { gasPrice: 1 },
      null,
    ]) {
      expect(await t.call({ id: 's1', approve: true, fee: { ...fee, override } })).toMatchObject({
        ok: false,
        error: { code: 'bad_request' },
      });
    }
    expect(t.answer).not.toHaveBeenCalled();
  });
});
