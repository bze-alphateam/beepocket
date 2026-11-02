import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { fail, ok, type Method, type RequestView, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { HomeEnvProvider, type HomeEnv } from '../home/env';
import { LockEnvProvider } from '../lock/env';
import { RequestScreen } from './RequestScreen';

afterEach(cleanup);

const ADDRESSES = [
  { index: 0, label: 'Main', address: 'bze1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' },
  { index: 1, label: 'Savings', address: 'bze1pppppppppppppppppppppppppppppppppppppp' },
];
const CONNECT: RequestView = {
  status: 'connect',
  id: 'r1',
  origin: 'https://dex.getbze.com',
  network: 'mainnet',
  addresses: ADDRESSES,
};
const BZE = {
  denom: 'ubze',
  symbol: 'BZE',
  name: 'BeeZee',
  decimals: 6,
  kind: 'native',
  source: 'builtin',
  branding: null,
};

type Handler = (req: unknown) => Result<unknown>;

function rig(handlers: Partial<Record<Method, Handler>>) {
  const call = vi.fn((method: Method, req: unknown) => {
    const handler = handlers[method];
    return Promise.resolve(handler ? handler(req) : fail('unexpected', method));
  });
  const close = vi.fn();
  const env = {
    scheduler: { every: () => () => undefined, after: () => () => undefined },
    themeTarget: { style: { setProperty: () => undefined }, dataset: {} },
    scheme: { current: () => 'dark', subscribe: () => () => undefined },
    clipboard: { writeText: () => Promise.resolve() },
  } as unknown as HomeEnv;
  const lockEnv = {
    clock: { now: () => 0, sleep: () => Promise.resolve() },
    events: { subscribe: () => () => undefined },
  };
  void act(() => undefined);
  const { host } = render(
    <ClientProvider client={{ call } as unknown as Client}>
      <LockEnvProvider {...lockEnv}>
        <HomeEnvProvider env={env}>
          <Router
            table={{ here: () => <RequestScreen close={close} /> }}
            initial={{ name: 'here' }}
          />
        </HomeEnvProvider>
      </LockEnvProvider>
    </ClientProvider>,
  );
  return { host, call, close };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const base: Partial<Record<Method, Handler>> = {
  'tokens.preferred': () => ok([BZE]),
  'home.context': () => ok({ network: 'mainnet', brandThemes: true }),
  'tokens.theme': () => ok(null),
  'tokens.balances': () =>
    ok({
      denom: 'ubze',
      addresses: [
        { index: 0, address: ADDRESSES[0]?.address, amount: '2500000' },
        { index: 1, address: ADDRESSES[1]?.address, amount: '0' },
      ],
      total: '2500000',
      partial: false,
    }),
};

const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name);

describe('the request window', () => {
  it('shows the site and one address to pick, and answers with the picked index', async () => {
    let views: RequestView[] = [CONNECT];
    const t = rig({
      ...base,
      'dapp.current': () => ok(views.shift() ?? { status: 'none' }),
      'dapp.answer': () => ok({}),
    });
    await settle();
    await settle();
    await settle();
    expect(t.host.textContent).toContain('https://dex.getbze.com');
    expect(t.host.textContent).toContain('exactly one address');
    expect(t.host.textContent).toContain('2.50 BZE');

    const radios = t.host.querySelectorAll('input[type=radio]');
    expect((radios[0] as HTMLInputElement).checked).toBe(true);
    fireEvent(radios[1], 'change');
    fireEvent(button(t.host, 'Connect'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', { id: 'r1', approve: true, index: 1 });
    expect(t.close).toHaveBeenCalledTimes(1);
    views = [];
  });

  it('answers Cancel with approve false', async () => {
    const t = rig({
      ...base,
      'dapp.current': (() => {
        let first = true;
        return () => {
          const view: RequestView = first ? CONNECT : { status: 'none' };
          first = false;
          return ok(view);
        };
      })(),
      'dapp.answer': () => ok({}),
    });
    await settle();
    fireEvent(button(t.host, 'Cancel'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', { id: 'r1', approve: false, index: 0 });
    expect(t.close).toHaveBeenCalled();
  });

  it('asks for the password when the weak lock blocks saving, then connects', async () => {
    const answers: unknown[] = [];
    const t = rig({
      ...base,
      'dapp.current': () => ok(CONNECT),
      'dapp.answer': (req) => {
        answers.push(req);
        return answers.length === 1 ? fail('needs-password', 'Enter your password.') : ok({});
      },
      'wallet.reauth': () => ok({ status: 'ok' }),
    });
    await settle();
    fireEvent(button(t.host, 'Connect'), 'click');
    await settle();
    expect(t.host.textContent).toContain('Unlock and connect');
    expect(button(t.host, 'Cancel')).toBeUndefined();
  });

  it('shows the unlock screen for a fully locked wallet, without the import way out', async () => {
    const t = rig({
      'dapp.current': () => ok({ status: 'locked', origin: 'https://dex.getbze.com' }),
      'wallet.state': () => ok({ state: 'locked', retryAt: null }),
    });
    await settle();
    await settle();
    expect(t.host.textContent).toContain('Welcome back');
    expect(t.host.textContent).toContain('https://dex.getbze.com is waiting');
    expect(t.host.textContent).not.toContain('Forgot your password');
  });

  it('closes the window when nothing waits', async () => {
    const t = rig({ 'dapp.current': () => ok({ status: 'none' }) });
    await settle();
    expect(t.close).toHaveBeenCalledTimes(1);
  });
});
