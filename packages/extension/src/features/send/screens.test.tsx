import { deriveAccount, type Clock } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, type Method, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import type { SendQuote } from '../../protocol/send';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { LockEnvProvider } from '../lock/env';
import { SendEnvProvider, type SendEnv } from './env';
import { SendFlow, type SendRoute } from './SendFlow';

type TestRoute = SendRoute | { name: 'home.main' };

afterEach(cleanup);

const PHRASE = `${'abandon '.repeat(23)}art`;
const OWN = deriveAccount(PHRASE, 0).address;
const TO = deriveAccount(PHRASE, 7).address;
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

type Handler = (req: Record<string, unknown>) => Result<unknown> | Promise<Result<unknown>>;

/** Timers run only when the test says so: the fee estimate's debounce is driven by hand. */
function manualScheduler() {
  const timers = new Set<() => void>();
  return {
    timers,
    after(_ms: number, fn: () => void) {
      const timer = () => {
        fn();
      };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
    every: () => () => undefined,
    async fire() {
      const due = [...timers];
      timers.clear();
      for (const fn of due) fn();
      await flush();
    },
  };
}

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
  const scheduler = manualScheduler();
  const listeners = new Set<() => void>();
  let scheme: 'dark' | 'light' = 'dark';
  const setProperty = vi.fn();
  const themeTarget = { style: { setProperty }, dataset: {} as { scheme?: string } };
  const writeText = vi.fn(() => Promise.resolve());
  const env: SendEnv = {
    scheduler,
    themeTarget,
    scheme: {
      current: () => scheme,
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
    clipboard: { writeText },
  };
  const { host } = render(
    <ClientProvider client={{ call } as unknown as Client}>
      <LockEnvProvider clock={clock} events={events}>
        <SendEnvProvider env={env}>
          <Router<TestRoute>
            table={{ send: SendFlow, 'home.main': () => <p>HOME</p> }}
            initial={{ name: 'send', denom: 'ubze' }}
          />
        </SendEnvProvider>
      </LockEnvProvider>
    </ClientProvider>,
  );
  const switchScheme = (next: 'dark' | 'light') => {
    scheme = next;
    for (const l of listeners) l();
  };
  return { host, call, scheduler, themeTarget, switchScheme, writeText };
}

const prepares = (call: ReturnType<typeof vi.fn>) =>
  call.mock.calls.filter(([m]) => m === 'send.prepare').map(([, req]) => req as object);
const submits = (call: ReturnType<typeof vi.fn>) =>
  call.mock.calls.filter(([m]) => m === 'send.submit').length;

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
    expect(host.querySelector('.bp-send-match')?.textContent).toBe('Alex· address book');

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
    await press(host, 'Choose Alex');
    expect(field(host, 'To').value).toBe(TO);
    expect(host.querySelector('[role=dialog]')).toBeNull();
  });

  it('Review in the pinned footer submits the form, so Enter in a field reaches Review', async () => {
    const { host } = setup();
    await flush();
    type(field(host, 'To'), TO);
    type(field(host, 'Amount'), '1.5');
    const review = button(host, 'Review');
    const form = host.querySelector('form');
    // Enter submits a form through its submit button: the footer button must belong to it.
    expect(review?.type).toBe('submit');
    expect(review?.form).toBe(form);
    fireEvent(review, 'click');
    await flush();
    expect(host.querySelector('.bp-send-hero')).not.toBeNull();
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

  it('asks for the password in the weak lock and then sends', async () => {
    const submit = vi.fn(() => ok({ txHash: HASH }));
    const { host, call } = setup({ 'send.submit': submit }, true);
    await toReview(host);
    // The board's label line: the lock icon, then the text; the field shows "Password".
    expect(host.querySelector('.bp-lock-form-label [data-icon="lock"]')).not.toBeNull();
    expect(host.querySelector('.bp-lock-form-label')?.textContent).toBe(
      'Enter your password to sign',
    );
    expect(host.querySelector('input[type=password]')?.getAttribute('placeholder')).toBe(
      'Password',
    );
    // Confirm is the password form's own button, disabled until a password is typed.
    const confirm = button(host, 'Confirm and send');
    expect(confirm?.closest('form')?.querySelector('input[type=password]')).not.toBeNull();
    expect(confirm?.disabled).toBe(true);
    fireEvent(confirm, 'click');
    await flush();
    expect(submit).not.toHaveBeenCalled();
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

  it('signs nothing in the weak lock while the password is wrong', async () => {
    const submit = vi.fn(() => ok({ txHash: HASH }));
    const { host, call } = setup(
      {
        'send.submit': submit,
        'wallet.reauth': () => ok({ status: 'wrong-password', retryAt: null }),
      },
      true,
    );
    await toReview(host);
    const password = host.querySelector<HTMLInputElement>('input[type=password]');
    if (!password) throw new Error('no password field');
    type(password, 'nope');
    fireEvent(password.closest('form'), 'submit');
    await flush();
    expect(call).toHaveBeenCalledWith('wallet.reauth', { password: 'nope' });
    expect(submit).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Wrong password');
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

  it('reports a transaction that failed on chain, with its hash and the fee it cost', async () => {
    const { host, writeText } = setup({
      'send.status': () =>
        ok({ status: 'failed', message: 'out of gas', explorerUrl: 'https://scan/txs/x' }),
    });
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('out of gas');
    expect(host.textContent).toContain('The network fee was still charged.');
    expect(host.textContent).toContain('0.002 BZE');
    expect(host.querySelector('a[href="https://scan/txs/x"]')).not.toBeNull();
    await press(host, 'Copy transaction hash');
    expect(writeText).toHaveBeenCalledWith(HASH);
  });

  it('shows no hash or fee for a broadcast the node refused', async () => {
    const { host } = setup({ 'send.submit': () => fail('tx-rejected', 'insufficient fee') });
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('The network fee may still be charged.');
    expect(host.textContent).not.toContain('Tx hash');
  });

  it('never calls a send failed when the chain could not be asked', async () => {
    const { host } = setup({
      'send.submit': () => ok({ txHash: HASH, unconfirmed: true }),
      'send.status': () => fail('network-error', 'down'),
    });
    await toReview(host);
    await press(host, 'Confirm and send');
    expect(host.textContent).toContain('Still pending');
    expect(host.textContent).toContain('We could not confirm this send');
    expect(host.textContent).not.toContain('Send failed');
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

describe('fee on the form', () => {
  const PAGE_FEE = { denom: 'factory/x/page', amount: '5000', symbol: 'PAGE', decimals: 2 };
  const priced = (r: Record<string, unknown>) =>
    ok(r.feeDenom === PAGE_FEE.denom ? quote({ fee: PAGE_FEE }) : quote());

  it('simulates only once From, To and Amount are valid', async () => {
    const { host, call, scheduler } = setup();
    await flush();
    type(field(host, 'To'), 'bze1nope');
    type(field(host, 'Amount'), '1.5');
    await scheduler.fire();
    type(field(host, 'To'), TO);
    type(field(host, 'Amount'), '0');
    await scheduler.fire();
    type(field(host, 'Amount'), '6');
    await scheduler.fire();
    expect(host.textContent).toContain('This address holds less than that.');
    type(field(host, 'Amount'), '1.1234567');
    await scheduler.fire();
    expect(prepares(call)).toEqual([]);
    expect(host.textContent).toContain('—');
  });

  it('is debounced: rapid typing simulates once, with the last values, after the delay', async () => {
    const { host, call, scheduler } = setup();
    await flush();
    type(field(host, 'To'), TO);
    type(field(host, 'Amount'), '1');
    type(field(host, 'Amount'), '1.');
    type(field(host, 'Amount'), '1.5');
    await flush();
    // Nothing goes to the network before the timer fires.
    expect(prepares(call)).toEqual([]);
    expect(scheduler.timers.size).toBe(1);
    await scheduler.fire();
    expect(prepares(call)).toEqual([{ fromIndex: 0, to: TO, denom: 'ubze', amount: '1.5' }]);
    expect(button(host, 'Network fee about 0.002 BZE. Change fee token')).not.toBeNull();
  });

  it('changing the fee token on the form re-prices it and Review shows it read-only', async () => {
    const prepare = vi.fn(priced);
    const { host, call, scheduler } = setup({ 'send.prepare': prepare });
    await flush();
    type(field(host, 'To'), TO);
    type(field(host, 'Amount'), '1.5');
    await scheduler.fire();
    await press(host, 'Network fee about 0.002 BZE. Change fee token');
    const dialog = host.querySelector('[role=dialog]');
    expect(dialog?.querySelector('h2')?.textContent).toBe('Pay network fee with');
    expect(dialog?.textContent).toContain('Selected');
    await press(host, 'PAGE, ≈ 50.00 PAGE');
    await scheduler.fire();
    expect(prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({ feeDenom: 'factory/x/page' }),
    );
    expect(button(host, 'Network fee about 50.00 PAGE. Change fee token')).not.toBeNull();

    await submitForm(host);
    expect(host.querySelector('.bp-send-hero')).not.toBeNull();
    expect(host.textContent).toContain('1.50 BZE + 50.00 PAGE');
    // Review has no fee control: only Confirm, Edit and Back.
    expect(
      [...host.querySelectorAll('button')].map(
        (b) => b.getAttribute('aria-label') ?? b.textContent,
      ),
    ).toEqual(['Back', 'Confirm and send', 'Edit']);
    expect(submits(call)).toBe(0);
  });

  it("Edit and the form's Review are separate buttons, so a tap on Edit never submits", async () => {
    const { host } = setup();
    await toReview(host);
    const editButton = button(host, 'Edit');
    await press(host, 'Edit');
    const review = button(host, 'Review');
    expect(review?.type).toBe('submit');
    // A reused element turns submit during the tap and the browser submits the form.
    expect(review).not.toBe(editButton);
    expect(editButton?.isConnected).toBe(false);
  });

  it('Edit goes back to the form with every value kept, fee token included', async () => {
    const prepare = vi.fn(priced);
    const { host, scheduler } = setup({ 'send.prepare': prepare });
    await flush();
    type(field(host, 'To'), TO);
    type(field(host, 'Amount'), '1.5');
    await scheduler.fire();
    await press(host, 'Network fee about 0.002 BZE. Change fee token');
    await press(host, 'PAGE, ≈ 50.00 PAGE');
    await submitForm(host);
    await press(host, 'Edit');
    expect(field(host, 'To').value).toBe(TO);
    expect(field(host, 'Amount').value).toBe('1.5');
    await scheduler.fire();
    expect(button(host, 'Network fee about 50.00 PAGE. Change fee token')).not.toBeNull();
    await submitForm(host);
    expect(prepare).toHaveBeenLastCalledWith({
      fromIndex: 0,
      to: TO,
      denom: 'ubze',
      amount: '1.5',
      feeDenom: 'factory/x/page',
    });
  });

  it('a late estimate never changes what Review signs', async () => {
    let release: (r: Result<unknown>) => void = () => undefined;
    let n = 0;
    const { host, call, scheduler } = setup({
      'send.prepare': () =>
        ++n === 1
          ? new Promise<Result<unknown>>((r) => {
              release = r;
            })
          : ok(quote()),
    });
    await flush();
    type(field(host, 'To'), TO);
    type(field(host, 'Amount'), '1.5');
    await scheduler.fire();
    await submitForm(host);
    expect(host.textContent).toContain('1.502 BZE');
    release(ok(quote({ fee: { denom: 'ubze', amount: '9000000', symbol: 'BZE', decimals: 6 } })));
    await flush();
    await scheduler.fire();
    expect(host.textContent).toContain('1.502 BZE');
    await press(host, 'Confirm and send');
    expect(call).toHaveBeenCalledWith(
      'send.submit',
      expect.objectContaining({ feeAmount: '2000', amount: '1500000' }),
    );
  });

  it('signs and broadcasts nothing before Confirm on Review', async () => {
    const { host, call, scheduler } = setup({ 'send.prepare': vi.fn(priced) });
    await flush();
    type(field(host, 'To'), TO);
    type(field(host, 'Amount'), '1.5');
    await scheduler.fire();
    await press(host, 'Network fee about 0.002 BZE. Change fee token');
    await press(host, 'PAGE, ≈ 50.00 PAGE');
    await scheduler.fire();
    await press(host, 'Max');
    await scheduler.fire();
    await submitForm(host);
    await press(host, 'Edit');
    await submitForm(host);
    expect(submits(call)).toBe(0);
    await press(host, 'Confirm and send');
    expect(submits(call)).toBe(1);
  });

  it("applies the token's kit and follows the scheme", async () => {
    const { themeTarget, switchScheme } = setup();
    await flush();
    expect(themeTarget.dataset.scheme).toBe('dark');
    expect(themeTarget.style.setProperty).toHaveBeenCalledWith('--bp-primary', expect.any(String));
    switchScheme('light');
    expect(themeTarget.dataset.scheme).toBe('light');
  });
});
