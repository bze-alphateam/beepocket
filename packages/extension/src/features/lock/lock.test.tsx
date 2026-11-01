import type { Clock } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../../popup/client-context';
import { Router, useRoute, type RouteBase } from '../../popup/router';
import {
  lockStateEvent,
  ok,
  type LockStateEvent,
  type Method,
  type PasswordOutcome,
  type Result,
  type WalletState,
} from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { LockEnvProvider } from './env';
import type { StateEvents } from './events';
import { PasswordGate } from './PasswordGate';
import { StateRoot, StateSupervisor } from './StateSupervisor';
import { UnlockScreen } from './UnlockScreen';
import { useActivityPing } from './useActivityPing';
import { useLock } from './useLock';
import { WaitingRequests } from './WaitingRequests';

afterEach(cleanup);

class FakeClock implements Clock {
  t = 1_000_000;
  private waiting: { at: number; wake: () => void }[] = [];
  now(): number {
    return this.t;
  }
  sleep(ms: number): Promise<void> {
    return new Promise((wake) => this.waiting.push({ at: this.t + ms, wake }));
  }
  async advance(ms: number): Promise<void> {
    this.t += ms;
    const due = this.waiting.filter((w) => w.at <= this.t);
    this.waiting = this.waiting.filter((w) => w.at > this.t);
    await act(async () => {
      for (const w of due) w.wake();
      await Promise.resolve();
    });
  }
}

class FakeEvents implements StateEvents {
  private listeners = new Set<(e: LockStateEvent) => void>();
  subscribe(l: (e: LockStateEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  push(state: WalletState): void {
    void act(() => {
      for (const l of this.listeners) l(lockStateEvent(state, null));
    });
  }
}

type Handler = (req: unknown) => Result<unknown>;

function fakeClient(handlers: Partial<Record<Method, Handler>>) {
  const call = vi.fn((method: Method, req: unknown) => {
    const h = handlers[method];
    return Promise.resolve(h ? h(req) : ok({}));
  });
  return { client: { call } as unknown as Client, call };
}

const outcome = (o: PasswordOutcome) => () => ok(o);
const flush = () => act(() => Promise.resolve());

function setup(
  handlers: Partial<Record<Method, Handler>>,
  ui: preact.ComponentChildren,
  clock = new FakeClock(),
  events = new FakeEvents(),
) {
  const { client, call } = fakeClient(handlers);
  const { host } = render(
    <ClientProvider client={client}>
      <LockEnvProvider clock={clock} events={events}>
        {ui}
      </LockEnvProvider>
    </ClientProvider>,
  );
  return { host, call, clock, events };
}

function type(host: HTMLElement, value: string): void {
  const input = host.querySelector('input');
  if (!input) throw new Error('no input');
  input.value = value;
  fireEvent(input, 'input');
}

async function submit(host: HTMLElement): Promise<void> {
  fireEvent(host.querySelector('form'), 'submit');
  await flush();
  await flush();
}

const stateReply =
  (state: WalletState, retryAt: number | null = null) =>
  () =>
    ok({ state, retryAt });

function Probe({ onRoute }: { onRoute: (r: RouteBase) => void }) {
  onRoute(useRoute().route);
  return null;
}

describe('UnlockScreen', () => {
  it('shows an error under the field for a wrong password', async () => {
    const { host } = setup(
      {
        'wallet.state': stateReply('locked'),
        'wallet.unlock': outcome({ status: 'wrong-password', retryAt: null }),
      },
      <UnlockScreen />,
    );
    await flush();
    type(host, 'nope');
    await submit(host);
    expect(host.querySelector('.bp-field-error')?.textContent).toBe('Wrong password.');
    expect(host.querySelector('input')?.value).toBe('');
    expect(host.querySelector('input')?.disabled).toBe(false);
  });

  it('disables the field with a live countdown and re-enables at retryAt', async () => {
    const clock = new FakeClock();
    const retryAt = clock.t + 30_000;
    const { host } = setup(
      {
        'wallet.state': stateReply('locked'),
        'wallet.unlock': outcome({ status: 'wrong-password', retryAt }),
      },
      <UnlockScreen />,
      clock,
    );
    await flush();
    type(host, 'nope');
    await submit(host);
    expect(host.querySelector('input')?.disabled).toBe(true);
    expect(host.querySelector('.bp-banner')?.textContent).toBe('Try again in 0:30');
    expect(host.querySelector('button[type=submit]')?.hasAttribute('disabled')).toBe(true);
    await clock.advance(10_000);
    expect(host.querySelector('.bp-banner')?.textContent).toBe('Try again in 0:20');
    await clock.advance(20_000);
    await flush();
    expect(host.querySelector('.bp-banner')).toBeNull();
    expect(host.querySelector('input')?.disabled).toBe(false);
  });

  it('starts blocked when the service already reports a retryAt', async () => {
    const clock = new FakeClock();
    const { host } = setup(
      { 'wallet.state': stateReply('locked', clock.t + 65_000) },
      <UnlockScreen />,
      clock,
    );
    await flush();
    expect(host.querySelector('.bp-banner')?.textContent).toBe('Try again in 1:05');
    expect(host.querySelector('input')?.disabled).toBe(true);
  });

  it('routes to the wallet on success', async () => {
    let route: RouteBase = { name: 'lock.unlock' };
    const { client, call } = fakeClient({
      'wallet.state': stateReply('locked'),
      'wallet.unlock': outcome({ status: 'ok' }),
    });
    const { host } = render(
      <ClientProvider client={client}>
        <LockEnvProvider clock={new FakeClock()} events={new FakeEvents()}>
          <Router
            table={{ 'lock.unlock': UnlockScreen, 'shell.home': () => null }}
            initial={{ name: 'lock.unlock' }}
          >
            <Probe onRoute={(r) => (route = r)} />
          </Router>
        </LockEnvProvider>
      </ClientProvider>,
    );
    await flush();
    type(host, 'right');
    await submit(host);
    expect(call).toHaveBeenCalledWith('wallet.unlock', { password: 'right' });
    expect(route).toEqual({ name: 'shell.home' });
  });

  it('sends the forgot-password link to onboarding import', async () => {
    let route: RouteBase = { name: 'lock.unlock' };
    const { client } = fakeClient({ 'wallet.state': stateReply('locked') });
    const { host } = render(
      <ClientProvider client={client}>
        <LockEnvProvider clock={new FakeClock()} events={new FakeEvents()}>
          <Router
            table={{ 'lock.unlock': UnlockScreen, 'onboarding.import': () => null }}
            initial={{ name: 'lock.unlock' }}
          >
            <Probe onRoute={(r) => (route = r)} />
          </Router>
        </LockEnvProvider>
      </ClientProvider>,
    );
    await flush();
    fireEvent(host.querySelector('.bp-lock-forgot'), 'click');
    expect(route).toEqual({ name: 'onboarding.import' });
  });
});

describe('PasswordGate', () => {
  it('calls reauth and reports success in place', async () => {
    const onUnlocked = vi.fn();
    const { host, call } = setup(
      { 'wallet.reauth': outcome({ status: 'ok' }) },
      <PasswordGate onUnlocked={onUnlocked} />,
    );
    expect(host.querySelector('button[type=submit]')?.textContent).toBe('Unlock and approve');
    type(host, 'pw');
    await submit(host);
    expect(call).toHaveBeenCalledWith('wallet.reauth', { password: 'pw' });
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('shows the error and does not continue on a wrong password', async () => {
    const onUnlocked = vi.fn();
    const { host } = setup(
      { 'wallet.reauth': outcome({ status: 'wrong-password', retryAt: null }) },
      <PasswordGate onUnlocked={onUnlocked} />,
    );
    type(host, 'pw');
    await submit(host);
    expect(host.querySelector('.bp-field-error')?.textContent).toBe('Wrong password.');
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('shows the throttle countdown without an error line', async () => {
    const clock = new FakeClock();
    const { host } = setup(
      { 'wallet.reauth': outcome({ status: 'throttled', retryAt: clock.t + 5_000 }) },
      <PasswordGate onUnlocked={vi.fn()} />,
      clock,
    );
    type(host, 'pw');
    await submit(host);
    expect(host.querySelector('.bp-banner')?.textContent).toBe('Try again in 0:05');
    expect(host.querySelector('.bp-field-error')).toBeNull();
    expect(host.querySelector('input')?.disabled).toBe(true);
  });

  it('shows a generic error when the service fails', async () => {
    const { host } = setup(
      { 'wallet.reauth': () => ({ ok: false, error: { code: 'transport', message: 'x' } }) },
      <PasswordGate onUnlocked={vi.fn()} />,
    );
    type(host, 'pw');
    await submit(host);
    expect(host.querySelector('.bp-field-error')?.textContent).toBe(
      'Something went wrong. Please try again.',
    );
  });
});

describe('state routing', () => {
  it.each([
    ['uninitialised', 'onboarding.welcome'],
    ['locked', 'lock.unlock'],
    ['unlocked', 'shell.home'],
    ['weakLocked', 'shell.home'],
  ] as const)('%s opens %s', async (state, expected) => {
    let route: RouteBase = { name: 'lock.root' };
    const { client } = fakeClient({ 'wallet.state': stateReply(state) });
    render(
      <ClientProvider client={client}>
        <LockEnvProvider clock={new FakeClock()} events={new FakeEvents()}>
          <Router table={{ 'lock.root': StateRoot }} initial={{ name: 'lock.root' }}>
            <Probe onRoute={(r) => (route = r)} />
          </Router>
        </LockEnvProvider>
      </ClientProvider>,
    );
    await flush();
    expect(route.name).toBe(expected);
  });

  it('switches to the unlock screen when the worker pushes a full lock', async () => {
    let route: RouteBase = { name: 'shell.home' };
    const events = new FakeEvents();
    const { client } = fakeClient({ 'wallet.state': stateReply('unlocked') });
    render(
      <ClientProvider client={client}>
        <LockEnvProvider clock={new FakeClock()} events={events}>
          <Router table={{ 'shell.home': () => null }} initial={{ name: 'shell.home' }}>
            <StateSupervisor />
            <Probe onRoute={(r) => (route = r)} />
          </Router>
        </LockEnvProvider>
      </ClientProvider>,
    );
    await flush();
    events.push('weakLocked');
    expect(route.name).toBe('shell.home');
    events.push('locked');
    expect(route.name).toBe('lock.unlock');
  });
});

describe('useActivityPing', () => {
  function Pinger({ enabled }: { enabled: boolean }) {
    useActivityPing(enabled);
    return null;
  }

  it('touches at most once per 10 seconds on pointerdown and keydown', async () => {
    const { call, clock } = setup({}, <Pinger enabled />);
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new Event('keydown'));
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('wallet.touch', {});
    await clock.advance(9_999);
    document.dispatchEvent(new Event('keydown'));
    expect(call).toHaveBeenCalledTimes(1);
    await clock.advance(1);
    document.dispatchEvent(new Event('pointerdown'));
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('is silent while disabled', () => {
    const { call } = setup({}, <Pinger enabled={false} />);
    document.dispatchEvent(new Event('pointerdown'));
    expect(call).not.toHaveBeenCalled();
  });
});

describe('useLock', () => {
  it('locks and shows the unlock screen', async () => {
    let route: RouteBase = { name: 'shell.home' };
    let lock: () => Promise<void> = () => Promise.resolve();
    function Grab() {
      lock = useLock();
      return null;
    }
    const { client, call } = fakeClient({});
    render(
      <ClientProvider client={client}>
        <Router table={{ 'shell.home': () => null }} initial={{ name: 'shell.home' }}>
          <Grab />
          <Probe onRoute={(r) => (route = r)} />
        </Router>
      </ClientProvider>,
    );
    await act(() => lock());
    expect(call).toHaveBeenCalledWith('wallet.lock', {});
    expect(route.name).toBe('lock.unlock');
  });
});

describe('WaitingRequests', () => {
  it('renders nothing yet', () => {
    expect(render(<WaitingRequests />).host.innerHTML).toBe('');
  });
});
