import { encodeMsgSend, rawJson, summarise, type AnyMsg } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import {
  fail,
  ok,
  type CurrentRequest,
  type Method,
  type RequestView,
  type Result,
} from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { HomeEnvProvider, type HomeEnv, type Scheduler } from '../home/env';
import { LockEnvProvider } from '../lock/env';
import { grantMsg, nothingMsg } from '../../dapp/test-support';
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

function rig(
  handlers: Partial<Record<Method, Handler>>,
  after: Scheduler['after'] = () => () => undefined,
  every: Scheduler['every'] = () => () => undefined,
) {
  const call = vi.fn((method: Method, req: unknown) => {
    const handler = handlers[method];
    return Promise.resolve(handler ? handler(req) : fail('unexpected', method));
  });
  const close = vi.fn();
  const env = {
    scheduler: { every, after },
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
    expect(t.host.textContent).not.toContain('Forgot it');
  });

  it('closes the window when nothing waits', async () => {
    const t = rig({ 'dapp.current': () => ok({ status: 'none' }) });
    await settle();
    expect(t.close).toHaveBeenCalledTimes(1);
  });
});

const SIGN: Extract<RequestView, { status: 'sign' }> = {
  status: 'sign',
  id: 's1',
  origin: 'https://dex.getbze.com',
  network: 'mainnet',
  signer: { label: 'Main', address: ADDRESSES[0]?.address ?? '' },
  summary: {
    level: 'normal',
    title: 'Send',
    hero: 'Send 1 BZE',
    sub: 'to Alex',
    rows: [
      ['To', 'bze1alex', 'mono'],
      ['Amount', '1 BZE'],
    ],
    messages: [],
    dangers: [],
    memo: 'thanks',
  },
  rawJson: '[{"typeUrl":"/cosmos.bank.v1beta1.MsgSend"}]',
  messageJson: ['{"typeUrl":"/cosmos.bank.v1beta1.MsgSend"}'],
  locked: false,
  fee: { denom: 'ubze', amount: '2000', symbol: 'BZE', decimals: 6 },
  options: [
    { denom: 'ubze', amount: '2000', symbol: 'BZE', decimals: 6 },
    { denom: 'uother', amount: '500', symbol: 'OTH', decimals: 6 },
  ],
  gasLimit: '200000',
};

function signRig(view: RequestView, extra: Partial<Record<Method, Handler>> = {}) {
  let first = true;
  return rig({
    ...base,
    'dapp.current': () => {
      const v: RequestView = first ? view : { status: 'none' };
      first = false;
      return ok(v);
    },
    'dapp.answer': () => ok({}),
    ...extra,
  });
}

describe('the sign screen', () => {
  it('shows the site, the signer, the hero, the rows, the memo and the fee', async () => {
    const t = signRig(SIGN);
    await settle();
    const text = t.host.textContent;
    expect(text).toContain('https://dex.getbze.com');
    expect(text).toContain('Main');
    expect(text).toContain('Send 1 BZE');
    expect(text).toContain('bze1alex');
    expect(text).toContain('thanks');
    expect(text).toContain('0.002 BZE');
  });

  it('approves with the fee that is shown', async () => {
    const t = signRig(SIGN);
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      fee: { denom: 'ubze', amount: '2000', gasLimit: '200000' },
    });
    expect(t.close).toHaveBeenCalled();
  });

  it('approves with the fee token picked on the fee sheet', async () => {
    const t = signRig(SIGN);
    await settle();
    fireEvent(
      [...t.host.querySelectorAll('button')].find((b) => b.textContent.includes('▾')),
      'click',
    );
    await settle();
    fireEvent(
      [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('OTH')),
      'click',
    );
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      fee: { denom: 'uother', amount: '500', gasLimit: '200000' },
    });
  });

  it('opens the raw JSON sheet from Message details', async () => {
    const t = signRig(SIGN);
    await settle();
    fireEvent(button(t.host, 'Message details'), 'click');
    await settle();
    expect(document.body.textContent).toContain('/cosmos.bank.v1beta1.MsgSend');
  });

  it('answers Reject with approve false and no fee', async () => {
    const t = signRig(SIGN);
    await settle();
    fireEvent(button(t.host, 'Reject'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', { id: 's1', approve: false });
  });

  it('asks for the password in the weak lock, then approves', async () => {
    const t = signRig({ ...SIGN, locked: true }, { 'wallet.reauth': () => ok({ status: 'ok' }) });
    await settle();
    expect(t.host.textContent).toContain('Unlock and approve');
    expect(button(t.host, 'Approve')).toBeUndefined();
    expect(button(t.host, 'Reject')).toBeDefined();
  });
});

function found<T>(el: T | null): T {
  if (el === null) throw new Error('element not found');
  return el;
}

const ME = ADDRESSES[0]?.address ?? '';
const OTHER = ADDRESSES[1]?.address ?? '';
const sendMsg = (): AnyMsg =>
  encodeMsgSend({
    fromAddress: ME,
    toAddress: OTHER,
    amount: [{ denom: 'ubze', amount: '1000000' }],
  });
const grant = (): AnyMsg => grantMsg(ME, OTHER, '/cosmos.bank.v1beta1.MsgSend');

/** A sign view for the messages, summarised by core exactly as the worker does. */
async function signView(
  messages: AnyMsg[],
  options: { locked?: boolean } = {},
): Promise<Extract<RequestView, { status: 'sign' }>> {
  const summary = await summarise(messages, {
    tokens: {
      resolve: () =>
        Promise.resolve({ ...BZE, kind: 'native' as const, source: 'builtin' as const }),
    },
    markets: { markets: () => Promise.resolve([]), liquidityPools: () => Promise.resolve([]) },
    orders: { marketOrder: () => Promise.resolve(null) },
    addressBook: () => null,
  });
  return {
    ...SIGN,
    summary,
    rawJson: rawJson(messages),
    messageJson: messages.map((m) => rawJson([m])),
    locked: options.locked ?? false,
  };
}

const disabled = (host: HTMLElement, name: string) => button(host, name)?.disabled;
function setTick(host: HTMLElement): void {
  const box = tick(host);
  box.checked = true;
  fireEvent(box, 'change');
}
const tick = (host: HTMLElement) =>
  found(host.querySelector<HTMLInputElement>('input[type=checkbox]'));

describe('the sign screen: risk levels', () => {
  it('shows an unknown message with the amber line and its raw JSON open', async () => {
    const t = signRig(await signView([nothingMsg()]));
    await settle();
    expect(t.host.textContent).toContain(
      "BeePocket can't put this message in plain words. Check the details before approving.",
    );
    expect(t.host.querySelector('.bp-dapp-raw')?.textContent).toContain('/test.v1.MsgNothing');
    expect(button(t.host, 'Approve')?.className).toContain('bp-btn-primary');
    expect(disabled(t.host, 'Approve')).toBe(false);
    expect(t.host.querySelector('input[type=checkbox]')).toBeNull();
  });

  it('keeps a dangerous request disabled until the tick, and approves with trusted', async () => {
    const t = signRig(await signView([grant()]));
    await settle();
    expect(t.host.textContent).toContain('power over your address');
    expect(button(t.host, 'Approve')?.className).toContain('bp-btn-danger');
    expect(disabled(t.host, 'Approve')).toBe(true);
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).not.toHaveBeenCalledWith('dapp.answer', expect.anything());

    expect(t.host.textContent).toContain('I set this up myself and trust this address');
    setTick(t.host);
    await settle();
    expect(disabled(t.host, 'Approve')).toBe(false);
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      fee: { denom: 'ubze', amount: '2000', gasLimit: '200000' },
      trusted: true,
    });
  });

  it('resets the tick when the fee token changes', async () => {
    const t = signRig(await signView([grant()]));
    await settle();
    setTick(t.host);
    await settle();
    expect(disabled(t.host, 'Approve')).toBe(false);
    fireEvent(
      [...t.host.querySelectorAll('button')].find((b) => b.textContent.includes('▾')),
      'click',
    );
    await settle();
    fireEvent(
      [...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('OTH')),
      'click',
    );
    await settle();
    expect(tick(t.host).checked).toBe(false);
    expect(disabled(t.host, 'Approve')).toBe(true);
  });

  it('numbers a normal and an unknown message and says both happen', async () => {
    const t = signRig(await signView([sendMsg(), nothingMsg()]));
    await settle();
    const text = t.host.textContent;
    expect(text).toContain('Signed together: both happen, or neither does');
    expect(text).toContain('1 of 2');
    expect(text).toContain('2 of 2');
    const cards = [...t.host.querySelectorAll('.bp-dapp-card')];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.className).toContain('bp-dapp-card-normal');
    expect(cards[1]?.className).toContain('bp-dapp-card-unknown');
    expect(cards[0]?.querySelector('.bp-dapp-raw')).toBeNull();
    expect(cards[1]?.querySelector('.bp-dapp-raw')?.textContent).toContain('/test.v1.MsgNothing');
    expect([...(cards[0]?.querySelectorAll('dt') ?? [])].map((d) => d.textContent)).toEqual([
      'To',
      'Amount',
    ]);
    expect(cards[0]?.textContent).toContain(OTHER);
    expect(cards[0]?.textContent).toContain('1.00 BZE');
    expect(cards[1]?.querySelectorAll('dt')).toHaveLength(0);
    expect(button(t.host, 'Approve')?.className).toContain('bp-btn-primary');
  });

  it('turns red and needs the tick when one of several messages is dangerous', async () => {
    const t = signRig(await signView([sendMsg(), grant()]));
    await settle();
    expect(t.host.querySelectorAll('.bp-dapp-card-dangerous')).toHaveLength(1);
    expect(button(t.host, 'Approve')?.className).toContain('bp-btn-danger');
    expect(disabled(t.host, 'Approve')).toBe(true);
    setTick(t.host);
    await settle();
    expect(disabled(t.host, 'Approve')).toBe(false);
  });

  it('says all of these for more than two messages', async () => {
    const t = signRig(await signView([sendMsg(), sendMsg(), sendMsg()]));
    await settle();
    expect(t.host.textContent).toContain('Signed together: all of these happen, or none does');
    expect(t.host.textContent).toContain('3 of 3');
  });

  it('asks for the password and the tick in the weak lock', async () => {
    const t = signRig(await signView([grant()], { locked: true }), {
      'wallet.reauth': () => ok({ status: 'ok' }),
    });
    await settle();
    expect(t.host.querySelector('input[type=password]')).not.toBeNull();
    const submit = () => found(t.host.querySelector<HTMLButtonElement>('button[type=submit]'));
    expect(submit().className).toContain('bp-btn-danger');
    const password = found(t.host.querySelector<HTMLInputElement>('input[type=password]'));
    password.value = 'pw';
    fireEvent(password, 'input');
    await settle();
    expect(submit().disabled).toBe(true);
    setTick(t.host);
    await settle();
    expect(submit().disabled).toBe(false);
  });
});

describe('the request queue in the window', () => {
  it('shows "1 of N" while several wait, and "Next request" before the next one', async () => {
    let timer: (() => void) | undefined;
    const views: CurrentRequest[] = [
      { ...CONNECT, count: 2 },
      { ...CONNECT, id: 'r2', count: 1 },
    ];
    const t = rig(
      {
        ...base,
        'dapp.current': () => ok(views.shift() ?? { status: 'none' }),
        'dapp.answer': () => ok({}),
      },
      (_ms, fn) => {
        timer = fn;
        return () => undefined;
      },
    );
    await settle();
    await settle();
    await settle();
    expect(t.host.querySelector('.bp-dapp-pill')?.textContent).toBe('1 of 2');

    fireEvent(button(t.host, 'Cancel'), 'click');
    await settle();
    expect(t.host.textContent).toContain('Next request · 1 waiting');
    expect(button(t.host, 'Connect')).toBeUndefined();

    await act(() => timer?.());
    await settle();
    await settle();
    expect(t.host.querySelector('.bp-dapp-pill')).toBeNull();
    expect(t.host.textContent).toContain('exactly one address');
  });

  it('asks the worker again when the head expires', async () => {
    const refresh: (() => void)[] = [];
    const t = rig(
      { ...base, 'dapp.current': () => ok({ ...CONNECT, count: 1, expiresAt: 5_000 }) },
      (_ms, fn) => {
        refresh.push(fn);
        return () => undefined;
      },
    );
    await settle();
    await settle();
    const before = t.call.mock.calls.filter(([m]) => m === 'dapp.current').length;
    await act(() => refresh.at(-1)?.());
    await settle();
    const after = t.call.mock.calls.filter(([m]) => m === 'dapp.current').length;
    expect(after).toBeGreaterThan(before);
  });

  it('counts requests that arrive while one is on screen, without touching the view', async () => {
    const ticks: (() => void)[] = [];
    let waiting = 1;
    const t = rig(
      {
        ...base,
        'dapp.current': () => ok({ ...CONNECT, count: 1 }),
        'dapp.queue': () => ok({ head: CONNECT.origin, count: waiting, origins: [CONNECT.origin] }),
      },
      undefined,
      (_ms, fn) => {
        ticks.push(fn);
        return () => undefined;
      },
    );
    await settle();
    await settle();
    await settle();
    expect(t.host.querySelector('.bp-dapp-pill')).toBeNull();
    waiting = 2;
    await act(() => {
      for (const f of ticks) f();
    });
    await settle();
    expect(t.host.querySelector('.bp-dapp-pill')?.textContent).toBe('1 of 2');
    expect(t.host.textContent).toContain('exactly one address');
  });

  it('keeps showing a request that stays waiting after a failed answer', async () => {
    const t = rig({
      ...base,
      'dapp.current': () => ok({ ...CONNECT, count: 2 }),
      'dapp.answer': () => fail('internal', 'Try again.'),
    });
    await settle();
    await settle();
    await settle();
    fireEvent(button(t.host, 'Cancel'), 'click');
    await settle();
    await settle();
    expect(t.host.textContent).not.toContain('Next request');
  });
});
