import type { Clock } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, type Method, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import type { SendQuote } from '../../protocol/send';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { LockEnvProvider } from '../lock/env';
import { sendRoutes } from './routes';
import type { SendRoute } from './SendFlow';

type TestRoute = SendRoute | { name: 'home.main' };

afterEach(cleanup);

const OWN = 'bze1own00000000000000000000000000000000000000';
const TO = 'bze1to0000000000000000000000000000000000000000';
const HASH = 'AB'.repeat(32);

const clock: Clock = { now: () => 1_000_000, sleep: () => Promise.resolve() };
const events = { subscribe: () => () => undefined };

const quote = (over: Partial<SendQuote> = {}): SendQuote => ({
  from: { index: 0, address: OWN },
  to: TO,
  token: { denom: 'ubze', symbol: 'BZE', decimals: 6 },
  amount: '1500000',
  balance: '5000000',
  gasLimit: '200000',
  fee: { denom: 'ubze', amount: '2000', symbol: 'BZE', decimals: 6 },
  options: [
    { denom: 'ubze', amount: '2000', symbol: 'BZE', decimals: 6 },
    { denom: 'factory/x/page', amount: '5000', symbol: 'PAGE', decimals: 2 },
  ],
  ...over,
});

type Handler = (req: Record<string, unknown>) => Result<unknown>;

function setup(handlers: Partial<Record<Method, Handler>> = {}, weak = false) {
  const defaults: Partial<Record<Method, Handler>> = {
    'tokens.lookup': () =>
      ok({
        denom: 'ubze',
        symbol: 'BZE',
        name: 'BeeZee',
        decimals: 6,
        kind: 'native',
        source: 'builtin',
        branding: null,
      }),
    'tokens.balances': () =>
      ok({
        denom: 'ubze',
        addresses: [{ index: 0, address: OWN, amount: '5000000' }],
        total: '5000000',
        partial: false,
      }),
    'wallet.addresses': () => ok({ addresses: [{ index: 0, label: 'Main', address: OWN }] }),
    'wallet.state': () => ok({ state: weak ? 'weakLocked' : 'unlocked', retryAt: null }),
    'book.match': (r) =>
      ok(r.input === TO ? { kind: 'contact', name: 'Alex' } : { kind: 'unknown' }),
    'book.list': () => ok({ contacts: [{ name: 'Alex', address: TO }], own: [] }),
    'send.prepare': () => ok(quote()),
    'send.submit': () => ok({ txHash: HASH }),
    'send.status': () =>
      ok({ status: 'confirmed', height: '10', gasUsed: '1', explorerUrl: 'https://scan/txs/x' }),
    'wallet.reauth': () => ok({ status: 'ok' }),
  };
  const table = { ...defaults, ...handlers };
  const call = vi.fn((method: Method, req: unknown) => {
    const h = table[method];
    return Promise.resolve(h ? h(req as Record<string, unknown>) : ok({}));
  });
  const { host } = render(
    <ClientProvider client={{ call } as unknown as Client}>
      <LockEnvProvider clock={clock} events={events}>
        <Router<TestRoute>
          table={{ ...sendRoutes, 'home.main': () => <p>HOME</p> }}
          initial={{ name: 'send', denom: 'ubze' }}
        />
      </LockEnvProvider>
    </ClientProvider>,
  );
  return { host, call };
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0)));
};
const field = (host: HTMLElement, label: string): HTMLInputElement => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === label);
  const input = l && host.querySelector<HTMLInputElement>(`#${l.getAttribute('for') ?? ''}`);
  if (!input) throw new Error(`no field ${label}`);
  return input;
};
const type = (el: HTMLInputElement, value: string) => {
  el.value = value;
  fireEvent(el, 'input');
};
const button = (host: HTMLElement, text: string): HTMLButtonElement | null =>
  [...host.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent).trim() === text,
  ) ?? null;
const press = async (host: HTMLElement, text: string) => {
  fireEvent(button(host, text), 'click');
  await flush();
};
const submitForm = async (host: HTMLElement) => {
  fireEvent(host.querySelector('form'), 'submit');
  await flush();
};

async function toReview(host: HTMLElement) {
  await flush();
  type(field(host, 'To'), TO);
  type(field(host, 'Amount'), '1.5');
  await flush();
  await submitForm(host);
}

describe('send form', () => {
  it('shows the token, the sender and what is available', async () => {
    const { host } = setup();
    await flush();
    expect(host.textContent).toContain('Send BZE');
    expect(host.textContent).toContain('Main');
    expect(host.textContent).toContain('Available 5.00 BZE');
  });

  it('shows the book match line and offers Save it for an unknown valid address', async () => {
    const { host, call } = setup({
      'book.match': (r) =>
        ok(r.input === TO ? { kind: 'contact', name: 'Alex' } : { kind: 'unknown' }),
    });
    await flush();
    type(field(host, 'To'), TO);
    await flush();
    expect(host.querySelector('.bp-send-match')?.textContent).toBe('Alex · Contact');

    // An address that is valid but unknown offers "Save it".
    const unknown = 'bze1' + 'q'.repeat(38);
    type(field(host, 'To'), unknown);
    await flush();
    expect(call).toHaveBeenCalledWith('book.match', { input: unknown });
  });

  it('fills the recipient from the address book picker', async () => {
    const { host } = setup();
    await flush();
    await press(host, 'Open address book');
    fireEvent(host.querySelector('.bp-book-row'), 'click');
    await flush();
    expect(field(host, 'To').value).toBe(TO);
    expect(host.querySelector('[role=dialog]')).toBeNull();
  });

  it('puts the whole balance in the amount with Max and sends max to prepare', async () => {
    const { host, call } = setup();
    await flush();
    type(field(host, 'To'), TO);
    await press(host, 'Max');
    expect(field(host, 'Amount').value).toBe('5');
    await submitForm(host);
    expect(call).toHaveBeenCalledWith(
      'send.prepare',
      expect.objectContaining({ max: true, amount: '5', denom: 'ubze', fromIndex: 0, to: TO }),
    );
  });

  it('shows the reason a send cannot be prepared', async () => {
    const { host } = setup({
      'send.prepare': () => fail('cannot-pay-fee', 'x'),
    });
    await toReview(host);
    expect(host.textContent).toContain("This address can't pay the network fee.");
    expect(host.querySelector('.bp-send-hero')).toBeNull();
  });
});

describe('review', () => {
  it('shows what will be signed: amount, parties, fee and total', async () => {
    const { host } = setup();
    await toReview(host);
    expect(host.querySelector('.bp-send-hero')?.textContent).toContain('1.50');
    expect(host.textContent).toContain('Alex');
    expect(host.textContent).toContain(TO);
    expect(host.textContent).toContain('1.502');
    expect(host.textContent).toContain("A sent transaction can't be undone");
  });

  it('changing the fee token on the fee sheet prices the send again', async () => {
    const prepare = vi.fn((r: Record<string, unknown>) =>
      ok(
        r.feeDenom === 'factory/x/page'
          ? quote({
              fee: { denom: 'factory/x/page', amount: '5000', symbol: 'PAGE', decimals: 2 },
            })
          : quote(),
      ),
    );
    const { host } = setup({ 'send.prepare': prepare });
    await toReview(host);
    await press(host, 'Network fee 0.002 BZE. Change fee token');
    const dialog = host.querySelector('[role=dialog]');
    expect(dialog?.textContent).toContain('PAGE');
    const page = [...(dialog?.querySelectorAll('button') ?? [])].find((b) =>
      b.textContent.includes('PAGE'),
    );
    fireEvent(page, 'click');
    await flush();
    expect(prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({ feeDenom: 'factory/x/page' }),
    );
    expect(host.textContent).toContain('1.50 BZE + 50.00 PAGE');
  });

  it('asks for the password in the weak lock and then sends', async () => {
    const submit = vi.fn(() => ok({ txHash: HASH }));
    const { host, call } = setup({ 'send.submit': submit }, true);
    await toReview(host);
    expect(button(host, 'Confirm and send')).toBeNull();
    const password = host.querySelector<HTMLInputElement>('input[type=password]');
    if (!password) throw new Error('no password field');
    type(password, 'pw');
    fireEvent(password.closest('form'), 'submit');
    await flush();
    await flush();
    expect(call).toHaveBeenCalledWith('wallet.reauth', { password: 'pw' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Sent');
  });

  it('shows the new fee when the worker says the review changed', async () => {
    let calls = 0;
    const { host } = setup({
      'send.submit': () => fail('review-changed', 'changed'),
      'send.prepare': () =>
        ok(
          ++calls === 1
            ? quote()
            : quote({ fee: { denom: 'ubze', amount: '3000', symbol: 'BZE', decimals: 6 } }),
        ),
    });
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('The network fee changed');
    expect(host.textContent).toContain('0.003 BZE');
  });
});

describe('result', () => {
  it('shows success and Done goes home with fresh balances', async () => {
    const { host, call } = setup();
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('Sent');
    expect(host.querySelector('a[href="https://scan/txs/x"]')).not.toBeNull();
    expect(call).toHaveBeenCalledWith('tokens.balances', { denom: 'ubze', refresh: true });
    await press(host, 'Done');
    expect(host.textContent).toBe('HOME');
  });

  it("shows the node's message on failure and Try again goes back to a fresh review", async () => {
    const prepare = vi.fn(() => ok(quote()));
    const { host } = setup({
      'send.submit': () => fail('tx-rejected', 'insufficient fee; got: 1ubze required: 2ubze'),
      'send.prepare': prepare,
    });
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('Send failed');
    expect(host.textContent).toContain('insufficient fee; got: 1ubze required: 2ubze');
    await press(host, 'Try again');
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(host.querySelector('.bp-send-hero')).not.toBeNull();
  });

  it('reports a transaction that failed on chain', async () => {
    const { host } = setup({
      'send.status': () =>
        ok({ status: 'failed', message: 'out of gas', explorerUrl: 'https://scan/txs/x' }),
    });
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('out of gas');
  });

  it('says still pending when the chain has not confirmed in time', async () => {
    const { host } = setup({
      'send.status': () => ok({ status: 'pending', explorerUrl: 'https://scan/txs/x' }),
    });
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('Still pending');
    expect(host.querySelector('a[href="https://scan/txs/x"]')).not.toBeNull();
  });
});
