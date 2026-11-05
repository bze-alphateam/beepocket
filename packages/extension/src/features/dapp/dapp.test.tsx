import { encodeMsgSend, rawJson, summarise, type AnyMsg } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../i18n';
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
  logo: null,
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
    visibility: { hidden: () => false },
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
/** The Details row of the sign screen (the whole request), not a message row. */
const detailsRow = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === en['dapp.sign.details']);
const closeButton = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>(
    `[role=dialog] button[aria-label="${en['app.sheet.close']}"]`,
  );
/** The open Details sheet, docked in the footer. */
const detailsSheet = (host: HTMLElement) =>
  host.querySelector('.bp-footer .bp-sheet-docked [role=dialog]');
const feeRow = (host: HTMLElement) =>
  [...host.querySelectorAll('button')].find((b) =>
    b.getAttribute('aria-label')?.startsWith('Network fee'),
  );

describe('the request window', () => {
  it('moves on when the request on screen leaves the queue (its page gave up)', async () => {
    const other = { ...CONNECT, id: 'r2', origin: 'https://other.example' };
    const views: RequestView[] = [CONNECT, other];
    const polls: (() => void)[] = [];
    const t = rig(
      {
        ...base,
        'dapp.current': () => ok(views.length > 1 ? (views.shift() ?? other) : other),
        'dapp.queue': () =>
          ok({ head: other.origin, headId: 'r2', count: 1, origins: [other.origin] }),
      },
      undefined,
      (_ms, fn) => {
        polls.push(fn);
        return () => undefined;
      },
    );
    await settle();
    expect(t.host.textContent).toContain('dex.getbze.com');
    await act(() => {
      for (const poll of polls) poll();
    });
    await settle();
    await settle();
    expect(t.host.textContent).toContain('other.example');
    expect(t.host.textContent).not.toContain('dex.getbze.com');
    expect(t.close).not.toHaveBeenCalled();
  });

  it('stays on the request on screen while it is still the head', async () => {
    const polls: (() => void)[] = [];
    const t = rig(
      {
        ...base,
        'dapp.current': () => ok(CONNECT),
        'dapp.queue': () =>
          ok({ head: CONNECT.origin, headId: 'r1', count: 2, origins: [CONNECT.origin] }),
      },
      undefined,
      (_ms, fn) => {
        polls.push(fn);
        return () => undefined;
      },
    );
    await settle();
    const current = t.call.mock.calls.filter(([m]) => m === 'dapp.current').length;
    await act(() => {
      for (const poll of polls) poll();
    });
    await settle();
    expect(t.call.mock.calls.filter(([m]) => m === 'dapp.current')).toHaveLength(current);
  });

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
    expect(t.host.textContent).toContain(en['dapp.connect.sees']);
    expect(t.host.textContent).toContain('2.50 BZE');

    const radios = t.host.querySelectorAll('[role=radio]');
    expect(radios[0]?.getAttribute('aria-checked')).toBe('true');
    fireEvent(radios[1], 'click');
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
    hero: '1 BZE',
    sub: 'to Alex',
    rows: [
      ['To', 'bze1alex', 'mono'],
      ['Amount', '1 BZE'],
    ],
    messages: [
      {
        typeUrl: '/cosmos.bank.v1beta1.MsgSend',
        level: 'normal',
        icon: 'send',
        title: 'Send',
        line: '1 BZE to Alex',
        hero: '1 BZE',
        sub: 'to Alex',
        rows: [
          ['To', 'bze1alex', 'mono'],
          ['Amount', '1 BZE'],
        ],
        danger: null,
      },
    ],
    dangers: [],
    memo: 'thanks',
  },
  rawJson: '[{"typeUrl":"/cosmos.bank.v1beta1.MsgSend"}]',
  messageJson: ['{"typeUrl":"/cosmos.bank.v1beta1.MsgSend"}'],
  locked: false,
  fee: {
    denom: 'ubze',
    amount: '2000',
    gasLimit: '200000',
    gasUsed: '166666',
    symbol: 'BZE',
    decimals: 6,
  },
  options: [
    {
      denom: 'ubze',
      amount: '2000',
      gasLimit: '200000',
      gasUsed: '166666',
      symbol: 'BZE',
      decimals: 6,
    },
    {
      denom: 'uother',
      amount: '500',
      gasLimit: '300000',
      gasUsed: '250000',
      symbol: 'OTH',
      decimals: 6,
    },
  ],
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
  it('shows the domain, the signer, the hero and the fee, and keeps rows and memo in Details', async () => {
    const t = signRig(SIGN);
    await settle();
    const text = t.host.textContent;
    expect(t.host.querySelector('.bp-sign-domain')?.textContent).toBe('dex.getbze.com');
    expect(text).toContain('Main');
    expect(t.host.querySelector('.bp-sign-big')?.textContent).toBe('1 BZE');
    expect(text).toContain('to Alex');
    expect(text).toContain('0.002 BZE');
    expect(text).not.toContain('bze1alex');
    expect(text).not.toContain('thanks');
    fireEvent(detailsRow(t.host), 'click');
    await settle();
    const sheet = detailsSheet(t.host);
    expect(sheet?.textContent).toContain('bze1alex');
    expect(sheet?.textContent).toContain('thanks');
    expect(sheet?.textContent).toContain('/cosmos.bank.v1beta1.MsgSend');
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
    fireEvent(feeRow(t.host), 'click');
    await settle();
    fireEvent(
      [...document.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.startsWith('OTH'),
      ),
      'click',
    );
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      // The picked token's own gas limit, not the default fee's.
      fee: { denom: 'uother', amount: '500', gasLimit: '300000' },
    });
  });

  it('approves with the Advanced gas limit and price, and shows them as rows', async () => {
    const PRICING = {
      native: true,
      nativePrice: { num: '1', den: '100' },
      rate: { num: '1', den: '100' },
    };
    const own = { ...SIGN.fee, balance: '100000000', pricing: PRICING };
    const t = signRig({ ...SIGN, fee: own, options: [own] });
    await settle();
    fireEvent(feeRow(t.host), 'click');
    await settle();
    fireEvent(
      [...document.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.startsWith('Advanced'),
      ),
      'click',
    );
    await settle();
    const label = [...document.querySelectorAll('label')].find(
      (l) => l.textContent === 'Gas limit',
    );
    const input = document.querySelector<HTMLInputElement>(`#${label?.getAttribute('for') ?? ''}`);
    if (!input) throw new Error('no gas limit field');
    input.value = '300000';
    fireEvent(input, 'input');
    fireEvent(
      [...document.querySelectorAll('.bp-gas-prices button')].find((b) => b.textContent === '×3'),
      'click',
    );
    fireEvent(button(document.body, 'Done'), 'click');
    await settle();
    const text = t.host.textContent;
    expect(text).toContain('Custom gas');
    expect(text).toContain('300,000 · custom');
    expect(text).toContain('0.03 ubze/gas · ×3');
    // 300,000 gas x 0.03 = 9,000 ubze.
    expect(text).toContain('0.009 BZE');
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      fee: {
        denom: 'ubze',
        amount: '9000',
        gasLimit: '300000',
        override: { gasLimit: '300000', gasPrice: 3 },
      },
    });
  });

  it("keeps a site's gas limit under a new gas price, with no below-estimate warning", async () => {
    const PRICING = {
      native: true,
      nativePrice: { num: '1', den: '100' },
      rate: { num: '1', den: '100' },
    };
    // 195,000 is under the wallet's 200,000 estimate, above the 166,666 simulated.
    const site = {
      ...SIGN.fee,
      amount: '2500',
      gasLimit: '195000',
      balance: '100000000',
      pricing: PRICING,
      setBy: 'https://dex.getbze.com',
    };
    const own = { ...SIGN.fee, balance: '100000000', pricing: PRICING };
    const t = signRig({ ...SIGN, fee: site, options: [site, own] });
    await settle();
    const openSheet = async () => {
      fireEvent(feeRow(t.host), 'click');
      await settle();
      fireEvent(
        [...document.querySelectorAll('button')].find((b) =>
          b.getAttribute('aria-label')?.startsWith('Advanced'),
        ),
        'click',
      );
      await settle();
    };
    const price = (text: string) =>
      [...document.querySelectorAll('.bp-gas-prices button')].find((b) => b.textContent === text);
    await openSheet();
    fireEvent(price('×2'), 'click');
    fireEvent(button(document.body, 'Done'), 'click');
    await settle();
    expect(t.host.textContent).not.toContain('below the estimate');
    // Only the price is custom: no gas limit row, the price row is there.
    expect(t.host.textContent).not.toContain('195,000 · custom');
    expect(t.host.textContent).toContain('0.02 ubze/gas · ×2');
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      // The site's limit at 0.02 ubze per gas.
      fee: {
        denom: 'ubze',
        amount: '3900',
        gasLimit: '195000',
        override: { gasLimit: '195000', gasPrice: 2 },
      },
    });
  });

  it("signs the site's own fee again after the price goes back to the minimum", async () => {
    const PRICING = {
      native: true,
      nativePrice: { num: '1', den: '100' },
      rate: { num: '1', den: '100' },
    };
    const site = {
      ...SIGN.fee,
      amount: '2500',
      gasLimit: '195000',
      balance: '100000000',
      pricing: PRICING,
      setBy: 'https://dex.getbze.com',
    };
    const other = {
      denom: 'uother',
      amount: '500',
      gasLimit: '300000',
      gasUsed: '250000',
      symbol: 'OTH',
      decimals: 6,
      balance: '100000000',
    };
    const t = signRig({ ...SIGN, fee: site, options: [site, other] });
    await settle();
    const advanced = async () => {
      fireEvent(feeRow(t.host), 'click');
      await settle();
      fireEvent(
        [...document.querySelectorAll('button')].find((b) =>
          b.getAttribute('aria-label')?.startsWith('Advanced'),
        ),
        'click',
      );
      await settle();
    };
    const price = (text: string) =>
      [...document.querySelectorAll('.bp-gas-prices button')].find((b) => b.textContent === text);
    await advanced();
    fireEvent(price('×2'), 'click');
    fireEvent(button(document.body, 'Done'), 'click');
    await settle();
    await advanced();
    fireEvent(price('Minimum'), 'click');
    fireEvent(button(document.body, 'Done'), 'click');
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    // Exactly the site's 2,500, not 195,000 x 0.01 recomputed.
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      fee: { denom: 'ubze', amount: '2500', gasLimit: '195000' },
    });
  });

  it('drops the Advanced settings when another fee token is picked', async () => {
    const PRICING = {
      native: true,
      nativePrice: { num: '1', den: '100' },
      rate: { num: '1', den: '100' },
    };
    const site = {
      ...SIGN.fee,
      amount: '2500',
      gasLimit: '195000',
      balance: '100000000',
      pricing: PRICING,
      setBy: 'https://dex.getbze.com',
    };
    const t = signRig({
      ...SIGN,
      fee: site,
      options: [
        site,
        {
          denom: 'uother',
          amount: '500',
          gasLimit: '300000',
          gasUsed: '250000',
          symbol: 'OTH',
          decimals: 6,
        },
      ],
    });
    await settle();
    fireEvent(feeRow(t.host), 'click');
    await settle();
    fireEvent(
      [...document.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.startsWith('Advanced'),
      ),
      'click',
    );
    await settle();
    fireEvent(
      [...document.querySelectorAll('.bp-gas-prices button')].find((b) => b.textContent === '×2'),
      'click',
    );
    fireEvent(button(document.body, 'Done'), 'click');
    await settle();
    fireEvent(feeRow(t.host), 'click');
    await settle();
    fireEvent(
      [...document.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.startsWith('OTH'),
      ),
      'click',
    );
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', {
      id: 's1',
      approve: true,
      fee: { denom: 'uother', amount: '500', gasLimit: '300000' },
    });
  });

  it('keeps Reject and Approve usable while Details is open, and closes it', async () => {
    const t = signRig(SIGN);
    await settle();
    expect(detailsSheet(t.host)).toBeNull();
    fireEvent(detailsRow(t.host), 'click');
    await settle();
    expect(detailsSheet(t.host)?.querySelector('pre')?.textContent).toContain(
      '/cosmos.bank.v1beta1.MsgSend',
    );
    // The sheet sits in the footer, above the buttons: they are still there and enabled.
    expect(disabled(t.host, 'Approve')).toBe(false);
    expect(disabled(t.host, 'Reject')).toBe(false);
    fireEvent(closeButton(t.host), 'click');
    await settle();
    expect(detailsSheet(t.host)).toBeNull();
    fireEvent(detailsRow(t.host), 'click');
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('dapp.answer', expect.objectContaining({ approve: true }));
  });

  it('shows a huge raw message cut until Show all', async () => {
    const huge = `{"typeUrl":"/x.v1.MsgBig","value":"${'A'.repeat(30_000)}"}`;
    const t = signRig({ ...SIGN, messageJson: [huge], rawJson: `[${huge}]` });
    await settle();
    fireEvent(detailsRow(t.host), 'click');
    await settle();
    const pre = () => detailsSheet(t.host)?.querySelector('pre')?.textContent ?? '';
    expect(pre().length).toBe(20_001);
    expect(pre().endsWith('…')).toBe(true);
    const showAll = button(t.host, 'Show all (30 KB)');
    expect(showAll).toBeDefined();
    fireEvent(showAll, 'click');
    await settle();
    expect(pre()).toBe(huge);
    expect(button(t.host, 'Show all (30 KB)')).toBeUndefined();
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
    // One message each, as the worker sends it: the object, not a one-item array.
    messageJson: messages.map((m) =>
      JSON.stringify((JSON.parse(rawJson([m])) as unknown[])[0], null, 2),
    ),
    locked: options.locked ?? false,
  };
}

const disabled = (host: HTMLElement, name: string) => button(host, name)?.disabled;
function setTick(host: HTMLElement): void {
  fireEvent(tick(host), 'click');
}
/** The trust tick: the kit `Check`, a `role="checkbox"` button inside the red risk box. */
const tick = (host: HTMLElement) =>
  found(host.querySelector<HTMLButtonElement>('[role=alert] [role=checkbox]'));
const ticked = (host: HTMLElement) => tick(host).getAttribute('aria-checked') === 'true';

describe('the sign screen: risk levels', () => {
  it('shows an unknown message by name with one amber line, and its raw message in Details', async () => {
    const t = signRig(await signView([nothingMsg()]));
    await settle();
    expect(t.host.querySelector('.bp-sign-big')?.textContent).toBe('MsgNothing');
    expect(t.host.querySelector('[role=note]')?.textContent).toBe(en['dapp.sign.unknown']);
    expect(t.host.querySelector('[role=alert]')).toBeNull();
    expect(t.host.querySelector('pre')).toBeNull();
    fireEvent(detailsRow(t.host), 'click');
    await settle();
    const sheet = detailsSheet(t.host);
    expect(sheet?.querySelector('dd.bp-mono')?.textContent).toBe('/test.v1.MsgNothing');
    expect(sheet?.querySelector('pre')?.textContent).toContain('/test.v1.MsgNothing');
    // Four bytes the wallet has no decoder for: said on the screen and in Details.
    expect(t.host.querySelector('.bp-sign-hero')?.textContent).toContain('Not decoded · 4 bytes');
    expect([...(sheet?.querySelectorAll('dd') ?? [])].map((d) => d.textContent)).toContain(
      'Not decoded · 4 bytes',
    );
    expect(button(t.host, 'Approve')?.className).toContain('bp-btn-primary');
    expect(disabled(t.host, 'Approve')).toBe(false);
    expect(t.host.querySelector('[role=checkbox]')).toBeNull();
  });

  it('keeps a dangerous request disabled until the tick, and approves with trusted', async () => {
    const t = signRig(await signView([grant()]));
    await settle();
    expect(t.host.querySelectorAll('[role=alert]')).toHaveLength(1);
    expect(t.host.querySelector('[role=alert]')?.textContent).toContain('power over your address');
    const view = await signView([grant()]);
    const danger = view.summary.dangers[0];
    expect(danger?.text.length).toBeGreaterThan(0);
    // The risk sentence itself, not only the title, is in the red box.
    expect(t.host.querySelector('[role=alert]')?.textContent).toContain(danger?.text);
    expect(ticked(t.host)).toBe(false);
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
    fireEvent(feeRow(t.host), 'click');
    await settle();
    fireEvent(
      [...document.querySelectorAll('button')].find((b) =>
        b.getAttribute('aria-label')?.startsWith('OTH'),
      ),
      'click',
    );
    await settle();
    expect(ticked(t.host)).toBe(false);
    expect(disabled(t.host, 'Approve')).toBe(true);
  });

  it('drops the tick when another dangerous request replaces the one on screen', async () => {
    const a = await signView([grant()]);
    const b = { ...(await signView([grant()])), id: 's2' };
    const views: RequestView[] = [a, b];
    const polls: (() => void)[] = [];
    const t = rig(
      {
        ...base,
        'dapp.current': () => ok(views.length > 1 ? (views.shift() ?? b) : b),
        // Nothing waits behind it, so the poll asks the worker for the head again.
        'dapp.queue': () => ok({ head: null, count: 0, origins: [] }),
        'dapp.answer': () => ok({}),
      },
      undefined,
      (_ms, fn) => {
        polls.push(fn);
        return () => undefined;
      },
    );
    await settle();
    await settle();
    setTick(t.host);
    await settle();
    expect(disabled(t.host, 'Approve')).toBe(false);

    await act(() => {
      for (const poll of polls) poll();
    });
    await settle();
    await settle();
    expect(ticked(t.host)).toBe(false);
    expect(disabled(t.host, 'Approve')).toBe(true);
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).not.toHaveBeenCalledWith(
      'dapp.answer',
      expect.objectContaining({ trusted: true }),
    );
  });

  it('lists a normal and an unknown message one line each, and opens the details of each', async () => {
    const t = signRig(await signView([sendMsg(), nothingMsg()]));
    await settle();
    expect(t.host.querySelector('.bp-sign-big')?.textContent).toBe('2 actions');
    expect(t.host.textContent).toContain(en['dapp.sign.together.two']);
    const rows = [...t.host.querySelectorAll<HTMLButtonElement>('ol .bp-sign-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.className).toContain('bp-sign-row-normal');
    expect(rows[1]?.className).toContain('bp-sign-row-unknown');
    expect(rows[1]?.textContent).toContain('MsgNothing');
    expect(rows[1]?.textContent).toContain(en['dapp.sign.unknownShort']);
    expect(rows[1]?.textContent).toContain('Not decoded · 4 bytes');
    expect(rows[0]?.textContent).not.toContain('Not decoded');
    // One line each: no rows and no raw message on the screen itself.
    expect(t.host.querySelector('dt')).toBeNull();
    expect(t.host.querySelector('pre')).toBeNull();

    fireEvent(rows[0], 'click');
    await settle();
    let sheet = detailsSheet(t.host);
    expect([...(sheet?.querySelectorAll('dt') ?? [])].map((d) => d.textContent)).toEqual([
      'Type',
      'To',
      'Amount',
    ]);
    expect(sheet?.textContent).toContain(OTHER);
    expect(sheet?.textContent).toContain('1.00 BZE');
    fireEvent(closeButton(t.host), 'click');
    await settle();

    fireEvent(rows[1], 'click');
    await settle();
    sheet = detailsSheet(t.host);
    expect(sheet?.querySelector('dd.bp-mono')?.textContent).toBe('/test.v1.MsgNothing');
    expect(sheet?.querySelector('pre')?.textContent).toContain('/test.v1.MsgNothing');
    expect(sheet?.querySelector('pre')?.textContent).not.toContain('/cosmos.bank.v1beta1.MsgSend');
    expect(button(t.host, 'Approve')?.className).toContain('bp-btn-primary');
  });

  it('turns red and needs the tick when one of several messages is dangerous', async () => {
    const t = signRig(await signView([sendMsg(), grant()]));
    await settle();
    expect(t.host.querySelectorAll('.bp-sign-row-dangerous')).toHaveLength(1);
    expect(t.host.querySelectorAll('.bp-sign-row-normal')).toHaveLength(1);
    // One red box and one tick for the whole request; the riskiest message sets Approve's style.
    expect(t.host.querySelectorAll('[role=alert]')).toHaveLength(1);
    expect(t.host.querySelectorAll('[role=checkbox]')).toHaveLength(1);
    expect(button(t.host, 'Approve')?.className).toContain('bp-btn-danger');
    expect(disabled(t.host, 'Approve')).toBe(true);
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.call).not.toHaveBeenCalledWith('dapp.answer', expect.anything());
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

  it('says all of these for more than two messages', async () => {
    const t = signRig(await signView([sendMsg(), sendMsg(), sendMsg()]));
    await settle();
    expect(t.host.textContent).toContain(en['dapp.sign.together.many']);
    expect(t.host.querySelector('.bp-sign-big')?.textContent).toBe('3 actions');
    expect(t.host.querySelectorAll('ol .bp-sign-row')).toHaveLength(3);
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
    const badge = t.host.querySelector('.bp-dapp-header-badge');
    expect(badge?.textContent).toBe('1 of 2');
    expect(badge?.getAttribute('aria-label')).toBe('Request 1 of 2');

    fireEvent(button(t.host, 'Cancel'), 'click');
    await settle();
    expect(t.host.querySelector('[role=status]')?.textContent).toBe('Next request · 1 waiting');
    expect(t.host.querySelector('h1')?.textContent).toBe(en['dapp.done.rejected']);
    expect(button(t.host, 'Connect')).toBeUndefined();

    await act(() => timer?.());
    await settle();
    await settle();
    expect(t.host.querySelector('.bp-dapp-header-badge')).toBeNull();
    expect(t.host.textContent).toContain(en['dapp.connect.sees']);
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
    expect(t.host.querySelector('.bp-dapp-header-badge')).toBeNull();
    waiting = 2;
    await act(() => {
      for (const f of ticks) f();
    });
    await settle();
    const badge = t.host.querySelector('.bp-dapp-header-badge');
    expect(badge?.textContent).toBe('1 of 2');
    expect(badge?.getAttribute('aria-label')).toBe('Request 1 of 2');
    expect(t.host.textContent).toContain(en['dapp.connect.sees']);
  });

  it('says what was approved, from where and the fee, before the next request', async () => {
    const views: CurrentRequest[] = [
      { ...SIGN, count: 2 },
      { ...CONNECT, id: 'r2', count: 1 },
    ];
    const t = rig({
      ...base,
      'dapp.current': () => ok(views.shift() ?? { status: 'none' }),
      'dapp.answer': () => ok({}),
    });
    await settle();
    await settle();
    fireEvent(button(t.host, 'Approve'), 'click');
    await settle();
    expect(t.host.querySelector('h1')?.textContent).toBe(en['dapp.done.approved']);
    expect(t.host.textContent).toContain('dex.getbze.com');
    const rows = [...t.host.querySelectorAll('.bp-detail')].map((r) => r.textContent);
    expect(rows).toEqual(['FromMain', 'Network fee0.002 BZE']);
    expect(t.host.querySelector('[role=status]')?.textContent).toBe('Next request · 1 waiting');
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
