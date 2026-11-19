import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { fail, ok, type Method, type RequestView, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import type { SchemeSource } from '../../theme';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { browserHomeEnv, HomeEnvProvider, type HomeEnv } from '../home/env';
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
  ticket: 'k-r1',
  origin: 'https://dex.getbze.com',
  network: 'mainnet',
  addresses: ADDRESSES,
};
const FEE = {
  denom: 'ubze',
  amount: '2000',
  gasLimit: '200000',
  gasUsed: '166666',
  symbol: 'BZE',
  decimals: 6,
};
const SIGN: Extract<RequestView, { status: 'sign' }> = {
  status: 'sign',
  id: 's1',
  ticket: 'k-s1',
  origin: 'https://dex.getbze.com',
  network: 'mainnet',
  signer: { label: 'Main', address: ADDRESSES[0]?.address ?? '' },
  summary: {
    level: 'normal',
    title: 'Send',
    hero: '1 BZE',
    sub: 'to Alex',
    rows: [['Amount', '1 BZE']],
    messages: [
      {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        level: 'normal',
        icon: 'send',
        title: 'Send',
        line: '1 BZE to Alex',
        hero: '1 BZE',
        sub: 'to Alex',
        rows: [['Amount', '1 BZE']],
        danger: null,
        unreadable: false,
      },
    ],
    dangers: [],
    memo: '',
  },
  rawJson: '[{"typeUrl":"/cosmos.bank.v1beta1.MsgSend"}]',
  messageJson: ['{"typeUrl":"/cosmos.bank.v1beta1.MsgSend"}'],
  locked: false,
  fee: FEE,
  options: [FEE],
};
const BZE = {
  denom: 'ubze',
  symbol: 'BZE',
  name: 'BeeZee',
  decimals: 6,
  kind: 'native',
  source: 'builtin',
  branding: null,
  logo: null,
};

type Handler = (req: unknown) => Result<unknown>;

const base: Partial<Record<Method, Handler>> = {
  'tokens.preferred': () => ok([BZE]),
  'home.context': () => ok({ network: 'mainnet', brandThemes: true }),
  'tokens.theme': () => ok(null),
  'tokens.balances': () =>
    ok({
      denom: 'ubze',
      addresses: [{ index: 0, address: ADDRESSES[0]?.address, amount: '2500000' }],
      total: '2500000',
      partial: false,
    }),
};

/**
 * The request window with time and the window's focus driven by hand: `arm()` runs the pending
 * delays, `regain()` tells the window it came back to the front, `poll()` runs the queue poll.
 */
function rig(handlers: Partial<Record<Method, Handler>>) {
  const call = vi.fn((method: Method, req: unknown) => {
    const handler = handlers[method];
    return Promise.resolve(handler ? handler(req) : fail('unexpected', method));
  });
  const delays: { ms: number; fn: () => void; live: boolean }[] = [];
  const listeners = new Set<() => void>();
  const polls: (() => void)[] = [];
  const env = {
    scheduler: {
      every: (_ms: number, fn: () => void) => {
        polls.push(fn);
        return () => undefined;
      },
      after: () => () => undefined,
    },
    arming: {
      after: (ms: number, fn: () => void) => {
        const d = { ms, fn, live: true };
        delays.push(d);
        return () => {
          d.live = false;
        };
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    visibility: { hidden: () => false },
    themeTarget: { style: { setProperty: () => undefined }, dataset: {} },
    scheme: { current: () => 'dark', subscribe: () => () => undefined },
    clipboard: { writeText: () => Promise.resolve() },
  } as unknown as HomeEnv;
  const lockEnv = {
    clock: { now: () => 0, sleep: () => Promise.resolve() },
    events: { subscribe: () => () => undefined },
  };
  const { host } = render(
    <ClientProvider client={{ call } as unknown as Client}>
      <LockEnvProvider {...lockEnv}>
        <HomeEnvProvider env={env}>
          <Router
            table={{ here: () => <RequestScreen close={() => undefined} /> }}
            initial={{ name: 'here' }}
          />
        </HomeEnvProvider>
      </LockEnvProvider>
    </ClientProvider>,
  );
  const answers = () => call.mock.calls.filter(([m]) => m === 'dapp.answer');
  return {
    host,
    call,
    answers,
    delays,
    arm: () =>
      act(() => {
        for (const d of delays.splice(0)) if (d.live) d.fn();
      }),
    regain: () =>
      act(() => {
        for (const l of [...listeners]) l();
      }),
    poll: () =>
      act(() => {
        for (const p of polls) p();
      }),
  };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name);
const submit = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button[type=submit]');

function typePassword(host: HTMLElement): void {
  const input = host.querySelector<HTMLInputElement>('input[type=password]');
  if (!input) throw new Error('no password field');
  input.value = 'pw';
  fireEvent(input, 'input');
}

describe('the answer buttons of the request window', () => {
  it('keeps Connect inactive for half a second, then connects', async () => {
    const t = rig({ ...base, 'dapp.current': () => ok(CONNECT), 'dapp.answer': () => ok({}) });
    await settle();
    expect(button(t.host, 'Connect')?.disabled).toBe(true);
    fireEvent(button(t.host, 'Connect'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(0);
    expect(t.delays.map((d) => d.ms)).toContain(500);

    await t.arm();
    await settle();
    expect(button(t.host, 'Connect')?.disabled).toBe(false);
    fireEvent(button(t.host, 'Connect'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(1);
  });

  it('keeps Approve inactive for half a second, then approves', async () => {
    const t = rig({ ...base, 'dapp.current': () => ok(SIGN), 'dapp.answer': () => ok({}) });
    await settle();
    expect(button(t.host, 'Approve')?.disabled).toBe(true);
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(0);

    await t.arm();
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(1);
  });

  it('leaves Reject and Cancel usable at once', async () => {
    const t = rig({ ...base, 'dapp.current': () => ok(SIGN), 'dapp.answer': () => ok({}) });
    await settle();
    fireEvent(button(t.host, 'Reject'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(1);
    expect(t.answers()[0]?.[1]).toMatchObject({ approve: false });
  });

  it('starts the delay again when the window comes back to the front', async () => {
    const t = rig({ ...base, 'dapp.current': () => ok(SIGN), 'dapp.answer': () => ok({}) });
    await settle();
    await t.arm();
    await settle();
    expect(button(t.host, 'Approve')?.disabled).toBe(false);

    await t.regain();
    // The click that brings the window back lands before any new render.
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(0);
    expect(button(t.host, 'Approve')?.disabled).toBe(true);

    await t.arm();
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(1);
  });

  it('ignores a click whose press began before the button was active', async () => {
    const t = rig({ ...base, 'dapp.current': () => ok(CONNECT), 'dapp.answer': () => ok({}) });
    await settle();
    fireEvent(button(t.host, 'Connect'), 'pointerdown');
    await t.arm();
    await settle();
    fireEvent(button(t.host, 'Connect'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(0);

    // A fresh press after the delay counts.
    fireEvent(button(t.host, 'Connect'), 'pointerdown');
    fireEvent(button(t.host, 'Connect'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(1);
  });

  it('ignores a click whose press began before the window last came back', async () => {
    const t = rig({ ...base, 'dapp.current': () => ok(SIGN), 'dapp.answer': () => ok({}) });
    await settle();
    await t.arm();
    await settle();
    fireEvent(button(t.host, 'Approve'), 'pointerdown');
    await t.regain();
    await t.arm();
    await settle();
    expect(button(t.host, 'Approve')?.disabled).toBe(false);
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(0);
  });

  it('ignores a pointer click it never saw pressed, and takes one it did', async () => {
    const t = rig({ ...base, 'dapp.current': () => ok(SIGN), 'dapp.answer': () => ok({}) });
    await settle();
    await t.arm();
    await settle();
    const pointerClick = () =>
      act(() => {
        button(t.host, 'Approve')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }),
        );
      });
    await pointerClick();
    await settle();
    expect(t.answers()).toHaveLength(0);

    fireEvent(button(t.host, 'Approve'), 'pointerdown');
    await pointerClick();
    await settle();
    expect(t.answers()).toHaveLength(1);
  });

  it('starts the delay again when another request takes the place of the one on screen', async () => {
    const other: RequestView = {
      ...SIGN,
      id: 's2',
      ticket: 'k-s2',
      origin: 'https://other.example',
    };
    const views: RequestView[] = [SIGN, other];
    const t = rig({
      ...base,
      'dapp.current': () => ok(views.length > 1 ? (views.shift() ?? other) : other),
      'dapp.queue': () =>
        ok({ head: other.origin, headId: 's2', headTicket: 'k-s2', count: 1, origins: [] }),
      'dapp.answer': () => ok({}),
    });
    await settle();
    await t.arm();
    await settle();
    expect(button(t.host, 'Approve')?.disabled).toBe(false);

    await t.poll();
    await settle();
    await settle();
    expect(t.host.textContent).toContain('other.example');
    expect(button(t.host, 'Approve')?.disabled).toBe(true);
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(0);

    await t.arm();
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.answers()).toHaveLength(1);
    expect(t.answers()[0]?.[1]).toMatchObject({ ticket: 'k-s2' });
  });

  it('holds "Unlock and approve" in the weak lock until the delay has passed', async () => {
    const t = rig({
      ...base,
      'dapp.current': () => ok({ ...SIGN, locked: true }),
      'wallet.reauth': () => ok({ status: 'ok' }),
      'dapp.answer': () => ok({}),
    });
    await settle();
    typePassword(t.host);
    await settle();
    expect(submit(t.host)?.disabled).toBe(true);
    fireEvent(submit(t.host), 'click');
    await settle();
    expect(t.call.mock.calls.filter(([m]) => m === 'wallet.reauth')).toHaveLength(0);

    await t.arm();
    await settle();
    expect(submit(t.host)?.disabled).toBe(false);
    fireEvent(submit(t.host), 'click');
    await settle();
    await settle();
    expect(t.call.mock.calls.filter(([m]) => m === 'wallet.reauth')).toHaveLength(1);
    expect(t.answers()).toHaveLength(1);
  });

  it('holds "Unlock and connect" again when the window comes back to the front', async () => {
    let asked = 0;
    const t = rig({
      ...base,
      'dapp.current': () => ok(CONNECT),
      'dapp.answer': () => {
        asked += 1;
        return asked === 1 ? fail('needs-password', 'Enter your password.') : ok({});
      },
      'wallet.reauth': () => ok({ status: 'ok' }),
    });
    await settle();
    await t.arm();
    await settle();
    fireEvent(button(t.host, 'Connect'), 'click');
    await settle();
    expect(t.host.textContent).toContain('Unlock and connect');
    typePassword(t.host);
    await settle();
    expect(submit(t.host)?.disabled).toBe(false);

    await t.regain();
    await settle();
    expect(submit(t.host)?.disabled).toBe(true);
    await t.arm();
    await settle();
    fireEvent(submit(t.host), 'click');
    await settle();
    await settle();
    expect(t.answers()).toHaveLength(2);
  });
});

describe('the browser source of the request window', () => {
  const scheme = {} as unknown as SchemeSource;

  it('reports focus and the document becoming visible again, not it being hidden', () => {
    const { arming } = browserHomeEnv(scheme) as unknown as {
      arming: { subscribe(listener: () => void): () => void };
    };
    const heard = vi.fn();
    const off = arming.subscribe(heard);
    window.dispatchEvent(new Event('focus'));
    expect(heard).toHaveBeenCalledTimes(1);

    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(heard).toHaveBeenCalledTimes(1);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(heard).toHaveBeenCalledTimes(2);

    off();
    window.dispatchEvent(new Event('focus'));
    expect(heard).toHaveBeenCalledTimes(2);
    hidden.mockRestore();
  });
});
