import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import {
  fail,
  lockStateEvent,
  ok,
  TokenErrorCodes,
  WalletErrorCodes,
  type LockStateEvent,
  type Method,
  type Result,
  type WalletState,
} from '../../protocol';
import type { Client } from '../../protocol/client';
import { AppearanceProvider } from '../../popup/appearance';
import { ClientProvider } from '../../popup/client-context';
import { Router, type RouteTable } from '../../popup/router';
import { AppearanceState, type Appearance, type SchemeQuery } from '../../theme';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { LockEnvProvider } from '../lock/env';
import type { StateEvents } from '../lock/events';
import { SettingsEnvProvider, type SettingsEnv } from './env';
import { NetworkPill } from './NetworkPill';
import { settingsRoutes } from './routes';
import { SettingsSheet } from './SettingsSheet';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const PHRASE = `${'abandon '.repeat(23)}art`;

const token = (denom: string, symbol: string) => ({
  denom,
  symbol,
  name: symbol,
  decimals: 6,
  kind: 'native',
  source: 'chain',
  branding: null,
});
const BZE = token('ubze', 'BZE');
const PAGE = token('factory/bze1x/upage', 'PAGE');
const GOLD_LOGO = 'https://raw.githubusercontent.com/x/gold.png';
const GOLD = { ...token('factory/bze1x/ugold', 'GOLD'), logo: GOLD_LOGO };
const CATALOG = new Map([BZE, PAGE, GOLD].map((x) => [x.denom, x]));

class FakeClient implements Client {
  calls: { method: string; request: unknown }[] = [];
  settings = { brandThemes: true, weakLockMinutes: 15, fullLockMinutes: 60 };
  network = 'mainnet';
  preferred: Record<string, string[]> = { mainnet: ['ubze', PAGE.denom], testnet: ['ubze'] };
  walletState = 'unlocked';
  sites = [{ origin: 'https://dex.getbze.com' }, { origin: 'https://app.cointrunk.io' }];
  contacts = [{ name: 'Alex', address: 'bze1alex' }];
  reveal: Result<unknown> = ok({ status: 'ok', mnemonic: PHRASE });
  failAdd = false;
  search: Result<unknown> = ok({ tokens: [BZE, PAGE], partial: false });
  lookup: (code: string) => Promise<Result<unknown>> = (code) =>
    Promise.resolve(
      CATALOG.has(code) ? ok(CATALOG.get(code)) : fail(TokenErrorCodes.noSuchToken, 'none'),
    );
  call(method: Method, request: unknown): Promise<Result<never>> {
    this.calls.push({ method, request });
    if (method === 'tokens.lookup') {
      return this.lookup((request as { code: string }).code) as Promise<Result<never>>;
    }
    const tokens = () => (this.preferred[this.network] ?? []).map((d) => CATALOG.get(d) ?? PAGE);
    const reply = (): Result<unknown> => {
      switch (method) {
        case 'settings.get':
          return ok(this.settings);
        case 'settings.set': {
          const next = { ...this.settings, ...(request as object) };
          if (next.fullLockMinutes < next.weakLockMinutes) {
            return fail(WalletErrorCodes.invalidSettings, 'bad');
          }
          this.settings = next;
          return ok(next);
        }
        case 'network.get':
          return ok({ id: this.network });
        case 'network.set':
          this.network = (request as { id: string }).id;
          return ok({ id: this.network });
        case 'tokens.preferred':
          return ok(tokens());
        case 'tokens.search':
          return this.search;
        case 'tokens.add': {
          if (this.failAdd) return fail('unexpected', 'no');
          const { denom } = request as { denom: string };
          this.preferred[this.network] = [...(this.preferred[this.network] ?? []), denom];
          return ok(tokens());
        }
        case 'tokens.remove': {
          const { denom } = request as { denom: string };
          this.preferred[this.network] = (this.preferred[this.network] ?? []).filter(
            (d) => d !== denom,
          );
          return ok(tokens());
        }
        case 'book.list':
          return ok({ contacts: this.contacts, own: [] });
        case 'sites.list':
          return ok({ network: this.network, sites: this.sites, addresses: [] });
        case 'wallet.state':
          return ok({ state: this.walletState, retryAt: null });
        case 'wallet.revealMnemonic':
          return this.reveal;
        case 'wallet.lock':
          this.walletState = 'locked';
          return ok({});
        default:
          return fail('unexpected', method);
      }
    };
    return Promise.resolve(reply() as Result<never>);
  }
  saw(method: string): unknown[] {
    return this.calls.filter((c) => c.method === method).map((c) => c.request);
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

class FakeQuery implements SchemeQuery {
  constructor(public matches: boolean) {}
  addEventListener(): void {
    return undefined;
  }
}

const events = new FakeEvents();
const clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
};

/** Timers that fire only when the test says so. */
class FakeScheduler {
  pending: { ms: number; fn: () => void }[] = [];
  after(ms: number, fn: () => void): () => void {
    const entry = { ms, fn };
    this.pending.push(entry);
    return () => {
      this.pending = this.pending.filter((p) => p !== entry);
    };
  }
  run(): void {
    const due = this.pending;
    this.pending = [];
    for (const p of due) p.fn();
  }
}

/** Lets the fake client's resolved promises settle; works with real and fake timers. */
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });

const Marker = (props: { route: { name: string } }) => <p>at:{props.route.name}</p>;

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('element not found');
  return x;
}

/** Home stand-in: the sheet over a button that opens it again, and a count of Home reloads. */
function rig(client = new FakeClient()) {
  const saved: Appearance[] = [];
  const appearance = new AppearanceState(new FakeQuery(true), {
    save: (a) => {
      saved.push(a);
      return Promise.resolve();
    },
  });
  const written: string[] = [];
  const env: SettingsEnv = {
    manifest: { version: () => '1.2.3' },
    clipboard: {
      readText: () => Promise.resolve(''),
      writeText: (text) => {
        written.push(text);
        return Promise.resolve();
      },
    },
    scheduler: new FakeScheduler(),
  };
  const changed = vi.fn();
  function Home() {
    const [open, setOpen] = useState(true);
    // Home re-renders on its own (the balance refresh); this button stands in for that.
    const [renders, setRenders] = useState(0);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setRenders(renders + 1);
          }}
        >
          Re-render home
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Open settings
        </button>
        <SettingsSheet
          open={open}
          onClose={() => {
            setOpen(false);
          }}
          onChanged={changed}
        />
      </>
    );
  }
  const table = {
    ...settingsRoutes,
    'home.main': Home,
    'settings.main': Marker,
    'dapp.sites': Marker,
    'lock.unlock': Marker,
  } as RouteTable<{ name: string }>;
  const { host } = render(
    <ClientProvider client={client}>
      <AppearanceProvider state={appearance}>
        <SettingsEnvProvider env={env}>
          <LockEnvProvider clock={clock} events={events}>
            <Router table={table} initial={{ name: 'home.main' }} />
          </LockEnvProvider>
        </SettingsEnvProvider>
      </AppearanceProvider>
    </ClientProvider>,
  );
  const button = (name: string | RegExp) =>
    [...host.querySelectorAll('button')].find((b) => {
      const label = b.getAttribute('aria-label') ?? b.textContent;
      return typeof name === 'string' ? label === name : name.test(label);
    });
  const dialogs = () => [...host.querySelectorAll('[role="dialog"]')];
  const key = (k: string) => {
    fireEvent(document.body, 'keydown', { key: k });
  };
  return { host, client, appearance, saved, written, changed, button, dialogs, key };
}

async function opened(client?: FakeClient) {
  const r = rig(client);
  await flush();
  return r;
}

describe('Settings sheet', () => {
  it('lists the rows in order, with the counts and the footer', async () => {
    const { host, dialogs } = await opened();
    expect(dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Settings']);
    const rows = [...host.querySelectorAll('.bp-settings-row-title, .bp-toggle-title')].map(
      (r) => r.textContent,
    );
    expect(rows).toEqual([
      'Appearance',
      'Theme follows token',
      'Preferred tokens',
      'Address book',
      'Connected sites',
      'Lock timers',
      'Show recovery phrase',
      'Testnet',
      'Lock wallet',
    ]);
    const text = host.textContent;
    expect(text).toContain("Use each token's brand kit colours");
    expect(text).toContain('15 min · 1 h');
    expect(text).toContain('Password needed');
    expect(text).toContain('BeePocket 1.2.3 · beezee-1');
    // The footer logo stays BeePocket green whatever token kit is active.
    const stops = [...host.querySelectorAll('.bp-settings-footer .bp-logo stop')];
    expect(stops.map((s) => s.getAttribute('stop-color'))).toEqual([
      '#3DD07A',
      '#1E9150',
      '#3DD07A',
      '#1E9150',
    ]);
    expect(host.querySelector('[aria-label="Connected sites · 2"]')).not.toBeNull();
    expect(host.querySelector('input[type="checkbox"], select')).toBeNull();
  });

  it('closes on Escape, on the backdrop and on the ×', async () => {
    const { host, button, dialogs, key } = await opened();
    key('Escape');
    expect(dialogs()).toHaveLength(0);
    fireEvent(button('Open settings'), 'click');
    await flush();
    fireEvent(host.querySelector('.bp-sheet-backdrop'), 'click');
    expect(dialogs()).toHaveLength(0);
    fireEvent(button('Open settings'), 'click');
    await flush();
    fireEvent(button('Close'), 'click');
    expect(dialogs()).toHaveLength(0);
  });

  it('the appearance control saves each pick and keeps System picked', async () => {
    const { host, appearance, saved } = await opened();
    const radio = (name: string) =>
      must(
        [...host.querySelectorAll('[role="radiogroup"] [role="radio"]')].find(
          (r) => r.textContent === name,
        ),
      );
    expect(radio('Dark').getAttribute('aria-checked')).toBe('true');
    fireEvent(radio('Light'), 'click');
    expect(appearance.current()).toBe('light');
    // System follows the OS (dark here): the scheme shown flips back, the pick stays System.
    fireEvent(radio('System'), 'click');
    expect(radio('System').getAttribute('aria-checked')).toBe('true');
    expect(appearance.appearance).toBe('system');
    expect(appearance.current()).toBe('dark');
    expect(saved).toEqual(['light', 'system']);
  });

  it('saves Theme follows token and tells Home to reload', async () => {
    const { client, changed, host } = await opened();
    const sw = must(
      [...host.querySelectorAll('[role="switch"]')].find((s) =>
        s.textContent.includes('Theme follows token'),
      ),
    );
    fireEvent(sw, 'click');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await flush();
    expect(client.saw('settings.set')).toEqual([{ brandThemes: false }]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('puts Theme follows token back when the save is refused', async () => {
    const client = new FakeClient();
    client.call = ((orig) => (method: Method, request: unknown) =>
      method === 'settings.set'
        ? Promise.resolve(fail(WalletErrorCodes.needsPassword, 'locked'))
        : orig(method, request))(client.call.bind(client));
    const { host, changed } = await opened(client);
    const sw = () =>
      must(
        [...host.querySelectorAll('[role="switch"]')].find((s) =>
          s.textContent.includes('Theme follows token'),
        ),
      );
    fireEvent(sw(), 'click');
    await flush();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unlock the wallet');
    expect(changed).not.toHaveBeenCalled();
  });

  it('Lock wallet locks at once and shows the unlock screen', async () => {
    const { client, button, host } = await opened();
    fireEvent(button('Lock wallet'), 'click');
    await flush();
    expect(client.saw('wallet.lock')).toEqual([{}]);
    expect(client.walletState).toBe('locked');
    expect(host.textContent).toBe('at:lock.unlock');
  });

  it('Preferred tokens and Connected sites open their screens', async () => {
    const first = await opened();
    fireEvent(first.button(/^Preferred tokens/), 'click');
    await flush();
    expect(first.host.querySelector('.bp-screen-title')?.textContent).toBe('Preferred tokens');
    cleanup();
    const second = await opened();
    fireEvent(second.button('Connected sites · 2'), 'click');
    expect(second.host.textContent).toBe('at:dapp.sites');
  });

  it('the address book replaces the sheet in manage mode and comes back to Settings', async () => {
    const { button, dialogs, host, key } = await opened();
    fireEvent(button(/^Address book/), 'click');
    await flush();
    expect(dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Address book']);
    expect(host.textContent).toContain('Alex');
    key('Escape');
    await flush();
    expect(dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Settings']);
  });

  it('the address book closes from its ×, back to Settings', async () => {
    const { button, dialogs } = await opened();
    fireEvent(button(/^Address book/), 'click');
    await flush();
    const close = dialogs()[0]?.querySelectorAll('button[aria-label="Close"]');
    expect(close).toHaveLength(1);
    fireEvent(close?.[0], 'click');
    await flush();
    expect(dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Settings']);
  });

  describe('testnet', () => {
    const toggle = (host: HTMLElement) =>
      must(
        [...host.querySelectorAll('[role="switch"]')].find((s) =>
          s.textContent.includes('Testnet'),
        ),
      );

    it('switches the network, shows it at once, keeps the sheet and tells Home', async () => {
      const { client, changed, host } = await opened();
      fireEvent(toggle(host), 'click');
      expect(toggle(host).getAttribute('aria-checked')).toBe('true');
      await flush();
      expect(client.saw('network.set')).toEqual([{ id: 'testnet' }]);
      expect(changed).toHaveBeenCalledOnce();
      expect(host.textContent).toContain('BeePocket 1.2.3 · bzetestnet-3');
    });

    it('lands on pick tokens when the network has none', async () => {
      const client = new FakeClient();
      client.preferred.testnet = [];
      const { host, changed } = await opened(client);
      fireEvent(toggle(host), 'click');
      await flush();
      await flush();
      expect(host.textContent).toContain('Pick your tokens');
      expect(host.querySelector('.bp-pill')?.textContent).toBe('Testnet');
      expect(changed).not.toHaveBeenCalled();
    });
  });

  describe('lock timers', () => {
    const openTimers = async () => {
      const r = await opened();
      fireEvent(r.button(/^Lock timers/), 'click');
      return r;
    };
    const pick = async (r: Awaited<ReturnType<typeof opened>>, row: string, choice: string) => {
      fireEvent(r.button(new RegExp(`^${row}, now`)), 'click');
      const option = must(
        [...r.host.querySelectorAll('[role="radio"]')].find((o) => o.textContent === choice),
      );
      fireEvent(option, 'click');
      await flush();
    };

    it('replaces the Settings sheet with the two lock times', async () => {
      const r = await openTimers();
      expect(r.dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Lock timers']);
      expect(r.host.textContent).toContain('Lock sending after');
      expect(r.host.textContent).toContain('Lock wallet after');
    });

    it('saves both keys and shows them on the Settings row', async () => {
      const r = await openTimers();
      await pick(r, 'Lock sending after', '5 min');
      await pick(r, 'Lock wallet after', '2 h');
      expect(r.client.saw('settings.set')).toEqual([
        { weakLockMinutes: 5 },
        { fullLockMinutes: 120 },
      ]);
      r.key('Escape');
      expect(r.host.textContent).toContain('5 min · 2 h');
    });

    it('a dropdown inside the sheet takes Escape first', async () => {
      const r = await openTimers();
      fireEvent(r.button(/^Lock sending after, now/), 'click');
      expect(r.dialogs()).toHaveLength(2);
      r.key('Escape');
      expect(r.dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Lock timers']);
    });

    it('offers only the allowed lock times and shows the wallet error inline', async () => {
      const r = await openTimers();
      fireEvent(r.button(/^Lock wallet after, now/), 'click');
      const offered = [...r.host.querySelectorAll('[role="radio"]')].map((o) => o.textContent);
      expect(offered).toEqual([
        '1 min',
        '2 min',
        '5 min',
        '10 min',
        '15 min',
        '30 min',
        '1 h',
        '2 h',
        '4 h',
        '8 h',
        '1 d',
        '7 d',
      ]);
      fireEvent(
        must([...r.host.querySelectorAll('[role="radio"]')].find((o) => o.textContent === '5 min')),
        'click',
      );
      await flush();
      expect(r.host.querySelector('[role="alert"]')?.textContent).toContain('must not come before');
    });

    it('shows a stored time that is not offered without sending it back', async () => {
      const client = new FakeClient();
      client.settings = { ...client.settings, weakLockMinutes: 7 };
      const r = await opened(client);
      expect(r.host.textContent).toContain('7 min · 1 h');
      fireEvent(r.button(/^Lock timers/), 'click');
      await pick(r, 'Lock sending after', '7 min');
      expect(client.saw('settings.set')).toEqual([]);
    });
  });
});

describe('Show recovery phrase', () => {
  const openReveal = async (client = new FakeClient()) => {
    const r = await opened(client);
    fireEvent(r.button(/^Show recovery phrase/), 'click');
    return r;
  };
  const submit = async (host: HTMLElement, password: string) => {
    const input = must(host.querySelector<HTMLInputElement>('input[type="password"]'));
    input.value = password;
    fireEvent(input, 'input');
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
  };
  const words = (host: HTMLElement) => host.querySelectorAll('.bp-words li .bp-word-n');

  it('asks the password, keeps the words out of the page until revealed, copies them', async () => {
    const r = await openReveal();
    expect(r.dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Recovery phrase']);
    await submit(r.host, 'pw');
    expect(r.client.saw('wallet.revealMnemonic')).toEqual([{ password: 'pw' }]);
    expect(r.host.textContent).toContain('Never share them');
    expect(r.host.textContent).not.toContain('abandon');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    expect(words(r.host)).toHaveLength(24);
    expect(r.host.textContent).toContain('abandon');
    fireEvent(r.button('Copy phrase'), 'click');
    await flush();
    expect(r.written).toEqual([PHRASE]);
  });

  for (const [how, close] of [
    [
      'Hide',
      (r: Awaited<ReturnType<typeof opened>>) => {
        fireEvent(r.button('Hide'), 'click');
      },
    ],
    [
      'Escape',
      (r: Awaited<ReturnType<typeof opened>>) => {
        r.key('Escape');
      },
    ],
    [
      'the backdrop',
      (r: Awaited<ReturnType<typeof opened>>) => {
        fireEvent(r.host.querySelector('.bp-sheet-backdrop'), 'click');
      },
    ],
  ] as const) {
    it(`drops the phrase on ${how} and asks the password again`, async () => {
      const r = await openReveal();
      await submit(r.host, 'pw');
      fireEvent(r.button(/^Reveal phrase/), 'click');
      close(r);
      await flush();
      expect(r.host.textContent).not.toContain('abandon');
      expect(r.dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Settings']);
      fireEvent(r.button(/^Show recovery phrase/), 'click');
      expect(r.host.querySelector('input[type="password"]')).not.toBeNull();
      expect(r.host.textContent).not.toContain('abandon');
    });
  }

  it('closing the whole sheet drops the phrase too', async () => {
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    // Back to Settings, then Settings closes: nothing of the phrase is left anywhere.
    r.key('Escape');
    r.key('Escape');
    await flush();
    expect(r.dialogs()).toHaveLength(0);
    fireEvent(r.button('Open settings'), 'click');
    await flush();
    fireEvent(r.button(/^Show recovery phrase/), 'click');
    expect(r.host.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('shows wrong password and the throttle error', async () => {
    const client = new FakeClient();
    client.reveal = ok({ status: 'wrong-password', retryAt: null });
    const r = await openReveal(client);
    await submit(r.host, 'nope');
    expect(r.host.textContent).toContain('Wrong password.');
    client.reveal = ok({ status: 'throttled', retryAt: Date.now() + 30_000 });
    await submit(r.host, 'nope');
    expect(r.host.textContent).toContain('Try again in');
    expect(r.button(/^Reveal phrase/)).toBeUndefined();
  });

  it('hides the phrase as soon as the worker pushes a weak lock', async () => {
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    events.push('unlocked');
    expect(words(r.host)).toHaveLength(24);
    events.push('weakLocked');
    expect(r.host.textContent).not.toContain('abandon');
  });

  it('hides the phrase after the idle time even while Home keeps re-rendering', async () => {
    vi.useFakeTimers();
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      fireEvent(r.button('Re-render home'), 'click');
    }
    expect(r.host.textContent).not.toContain('abandon');
  });

  it('hides the phrase after the idle time', async () => {
    vi.useFakeTimers();
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(r.host.textContent).not.toContain('abandon');
  });
});

describe('Preferred tokens', () => {
  let scheduler = new FakeScheduler();
  let clipboard = '';
  let readText = () => Promise.resolve(clipboard);
  const openPick = async (client: FakeClient) => {
    scheduler = new FakeScheduler();
    clipboard = '';
    readText = () => Promise.resolve(clipboard);
    const env: SettingsEnv = {
      manifest: { version: () => '1.2.3' },
      clipboard: { readText: () => readText(), writeText: () => Promise.resolve() },
      scheduler,
    };
    const table = { ...settingsRoutes, 'home.main': Marker, 'settings.main': Marker };
    const { host } = render(
      <ClientProvider client={client}>
        <SettingsEnvProvider env={env}>
          <Router
            table={table as RouteTable<{ name: string }>}
            initial={{ name: 'settings.pickTokens' }}
          />
        </SettingsEnvProvider>
      </ClientProvider>,
    );
    await flush();
    return host;
  };
  const codeField = (host: HTMLElement) => {
    const el = host.querySelector('.ob-code input');
    if (!(el instanceof HTMLInputElement)) throw new Error('no code field');
    return el;
  };
  const typeCode = (host: HTMLElement, value: string) => {
    const el = codeField(host);
    el.value = value;
    fireEvent(el, 'input');
  };
  const symbols = (host: HTMLElement) =>
    [...host.querySelectorAll('.bp-token-row-title')].map((t) => t.textContent.split(' ')[0]);
  const row = (host: HTMLElement, symbol: string) =>
    must(
      [...host.querySelectorAll('[role="checkbox"]')].find((c) =>
        c.querySelector('.bp-token-row-title')?.textContent.startsWith(symbol),
      ),
    );
  const button = (host: HTMLElement, name: string) =>
    [...host.querySelectorAll('button')].find(
      (b) => (b.getAttribute('aria-label') ?? b.textContent) === name,
    );

  it('ticks the current tokens and saves the difference, then returns to Settings', async () => {
    const client = new FakeClient();
    client.preferred.mainnet = ['ubze'];
    const host = await openPick(client);
    expect(host.textContent).toContain('Preferred tokens');
    expect(row(host, 'BZE').getAttribute('aria-checked')).toBe('true');
    expect(row(host, 'PAGE').getAttribute('aria-checked')).toBe('false');
    fireEvent(row(host, 'PAGE'), 'click');
    fireEvent(row(host, 'BZE'), 'click');
    fireEvent(button(host, 'Save'), 'click');
    await flush();
    // Added before removed: the last-token rule never trips halfway.
    expect(
      client.calls.filter((c) => c.method.startsWith('tokens.a') || c.method === 'tokens.remove'),
    ).toEqual([
      { method: 'tokens.add', request: { denom: PAGE.denom } },
      { method: 'tokens.remove', request: { denom: 'ubze' } },
    ]);
    expect(host.textContent).toBe('at:settings.main');
  });

  it('cannot save an empty pick, and ← goes back to Settings', async () => {
    const client = new FakeClient();
    client.preferred.mainnet = ['ubze'];
    const host = await openPick(client);
    fireEvent(row(host, 'BZE'), 'click');
    expect(button(host, 'Save')?.disabled).toBe(true);
    fireEvent(button(host, 'Back'), 'click');
    expect(host.textContent).toBe('at:settings.main');
  });

  it('stays put and says so when a save fails', async () => {
    const client = new FakeClient();
    client.failAdd = true;
    client.preferred.mainnet = ['ubze'];
    const host = await openPick(client);
    fireEvent(row(host, 'PAGE'), 'click');
    fireEvent(button(host, 'Save'), 'click');
    await flush();
    expect(host.textContent).toContain('The change could not be saved.');
  });

  it('a failed add removes nothing, so the set is never half applied', async () => {
    const client = new FakeClient();
    client.failAdd = true;
    client.preferred.mainnet = ['ubze'];
    const host = await openPick(client);
    fireEvent(row(host, 'PAGE'), 'click');
    fireEvent(row(host, 'BZE'), 'click');
    fireEvent(button(host, 'Save'), 'click');
    await flush();
    expect(client.saw('tokens.add')).toEqual([{ denom: PAGE.denom }]);
    expect(client.saw('tokens.remove')).toEqual([]);
    expect(client.preferred.mainnet).toEqual(['ubze']);
    expect(host.textContent).toContain('The change could not be saved.');
  });

  describe('token code', () => {
    it('a found code lists the token ticked once, and Save adds it', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      expect(host.textContent).not.toContain('GOLD');
      typeCode(host, GOLD.denom);
      // Debounced: nothing is looked up until the pause.
      expect(client.saw('tokens.lookup')).toEqual([]);
      scheduler.run();
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([{ code: GOLD.denom }]);
      expect(row(host, 'GOLD').getAttribute('aria-checked')).toBe('true');
      expect(row(host, 'GOLD').querySelector('img')?.getAttribute('src')).toBe(GOLD_LOGO);
      expect(host.textContent).toContain('2 selected');
      // Finding it again adds no second row.
      fireEvent(must(host.querySelector('.ob-code')), 'submit');
      await flush();
      expect(symbols(host).filter((x) => x === 'GOLD')).toHaveLength(1);
      fireEvent(button(host, 'Save'), 'click');
      await flush();
      expect(client.saw('tokens.add')).toEqual([{ denom: GOLD.denom }]);
      expect(client.saw('tokens.remove')).toEqual([]);
      expect(host.textContent).toBe('at:settings.main');
    });

    it('a code the wallet already lists ticks that row, no duplicate', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      typeCode(host, PAGE.denom);
      scheduler.run();
      await flush();
      expect(symbols(host)).toEqual(['BZE', 'PAGE']);
      expect(row(host, 'PAGE').getAttribute('aria-checked')).toBe('true');
    });

    it('Paste reads the clipboard on the tap and looks the code up', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      clipboard = `  ${GOLD.denom} `;
      fireEvent(button(host, 'Paste token code'), 'click');
      await flush();
      expect(codeField(host).value).toBe(GOLD.denom);
      expect(row(host, 'GOLD').getAttribute('aria-checked')).toBe('true');
    });

    it.each([
      [
        fail(TokenErrorCodes.noSuchToken, 'x'),
        'No token uses this code. Check it with whoever shared it.',
      ],
      [fail(TokenErrorCodes.invalidCode, 'x'), "That isn't a valid token code."],
      [fail('unexpected', 'x'), "We couldn't check this code. Try again."],
    ])('an unknown code says so under the field and adds nothing (%#)', async (answer, text) => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      client.lookup = () => Promise.resolve(answer);
      const host = await openPick(client);
      typeCode(host, 'factory/bze1x/nope');
      scheduler.run();
      await flush();
      expect(must(host.querySelector('.ob-code')).textContent).toContain(text);
      expect(symbols(host)).toEqual(['BZE', 'PAGE']);
      expect(host.textContent).toContain('1 selected');
      fireEvent(row(host, 'PAGE'), 'click');
      fireEvent(button(host, 'Save'), 'click');
      await flush();
      expect(client.saw('tokens.add')).toEqual([{ denom: PAGE.denom }]);
    });

    it('a clipboard read that ends after leaving the screen looks nothing up', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      let release: (text: string) => void = () => undefined;
      readText = () =>
        new Promise((resolve) => {
          release = resolve;
        });
      fireEvent(button(host, 'Paste token code'), 'click');
      fireEvent(button(host, 'Back'), 'click');
      expect(host.textContent).toBe('at:settings.main');
      release(GOLD.denom);
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([]);
    });

    it('a code longer than any denom is invalid without a lookup', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      typeCode(host, `factory/${'a'.repeat(121)}`);
      scheduler.run();
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([]);
      expect(must(host.querySelector('.ob-code')).textContent).toContain(
        "That isn't a valid token code.",
      );
      // 128 characters is still a code.
      typeCode(host, `factory/${'a'.repeat(120)}`);
      scheduler.run();
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([{ code: `factory/${'a'.repeat(120)}` }]);
    });

    it('drops an older answer that lands after the latest one', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const answers = new Map<string, (r: Result<unknown>) => void>();
      client.lookup = (code) =>
        new Promise((resolve) => {
          answers.set(code, resolve);
        });
      const host = await openPick(client);
      typeCode(host, GOLD.denom);
      scheduler.run();
      typeCode(host, 'factory/bze1x/nope');
      scheduler.run();
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([
        { code: GOLD.denom },
        { code: 'factory/bze1x/nope' },
      ]);
      must(answers.get('factory/bze1x/nope'))(fail(TokenErrorCodes.noSuchToken, 'x'));
      await flush();
      must(answers.get(GOLD.denom))(ok(GOLD));
      await flush();
      expect(host.textContent).not.toContain('GOLD');
      expect(host.textContent).toContain('No token uses this code.');
    });

    it('a new keystroke cancels the pending lookup', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      typeCode(host, 'factory/bze1x/ug');
      typeCode(host, GOLD.denom);
      expect(scheduler.pending).toHaveLength(1);
      scheduler.run();
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([{ code: GOLD.denom }]);
    });
  });

  it('lists a pick the wallet does not hold, ticked', async () => {
    const client = new FakeClient();
    client.preferred.mainnet = ['ubze', GOLD.denom];
    client.search = ok({ tokens: [BZE], partial: false });
    const host = await openPick(client);
    expect(symbols(host)).toEqual(['GOLD', 'BZE']);
    expect(row(host, 'GOLD').getAttribute('aria-checked')).toBe('true');
    fireEvent(row(host, 'GOLD'), 'click');
    fireEvent(button(host, 'Save'), 'click');
    await flush();
    expect(client.saw('tokens.remove')).toEqual([{ denom: GOLD.denom }]);
  });

  it('the search query filters the unheld picks too, down to the empty state', async () => {
    const client = new FakeClient();
    client.preferred.mainnet = ['ubze', GOLD.denom];
    client.search = ok({ tokens: [BZE], partial: false });
    const host = await openPick(client);
    const search = host.querySelector('.bp-search input');
    if (!(search instanceof HTMLInputElement)) throw new Error('no search field');
    client.search = ok({ tokens: [], partial: false });
    search.value = 'zzz';
    fireEvent(search, 'input');
    await flush();
    expect(symbols(host)).toEqual([]);
    expect(host.textContent).toContain('No tokens match');
    search.value = 'gOl';
    fireEvent(search, 'input');
    await flush();
    expect(symbols(host)).toEqual(['GOLD']);
  });

  it('shows the error banner when an address could not be read, and still lists the rest', async () => {
    const client = new FakeClient();
    client.preferred.mainnet = ['ubze'];
    client.search = ok({ tokens: [BZE, PAGE], partial: true });
    const host = await openPick(client);
    expect(host.querySelector('.bp-banner')?.textContent).toContain('Something went wrong');
    expect(symbols(host)).toEqual(['BZE', 'PAGE']);
  });

  it('shows no banner when every address was read', async () => {
    const host = await openPick(new FakeClient());
    expect(host.querySelector('.bp-banner')).toBeNull();
  });

  describe('as the landing of a network without tokens', () => {
    it('has no way back, names the network and switch network really switches it', async () => {
      const client = new FakeClient();
      client.network = 'testnet';
      client.preferred = { mainnet: [], testnet: [] };
      const host = await openPick(client);
      expect(host.textContent).toContain('Pick your tokens');
      expect(host.textContent).toContain('No tokens are picked on Testnet yet.');
      expect(host.querySelector('.bp-pill')?.textContent).toBe('Testnet');
      expect(button(host, 'Back')).toBeUndefined();
      fireEvent(button(host, 'Switch network'), 'click');
      await flush();
      expect(client.network).toBe('mainnet');
      expect(host.textContent).toContain('No tokens are picked on Mainnet yet.');
      expect(host.querySelector('.bp-pill')).toBeNull();
    });

    it('switching to a network that has tokens goes home', async () => {
      const client = new FakeClient();
      client.network = 'testnet';
      client.preferred.testnet = [];
      const host = await openPick(client);
      fireEvent(button(host, 'Switch network'), 'click');
      await flush();
      expect(host.textContent).toBe('at:home.main');
    });

    it('picking a token and saving adds it', async () => {
      const client = new FakeClient();
      client.network = 'testnet';
      client.preferred.testnet = [];
      const host = await openPick(client);
      fireEvent(row(host, 'BZE'), 'click');
      fireEvent(button(host, 'Save'), 'click');
      await flush();
      expect(client.preferred.testnet).toEqual(['ubze']);
      expect(host.textContent).toBe('at:settings.main');
    });
  });
});

describe('NetworkPill', () => {
  it('shows only on testnet', async () => {
    const client = new FakeClient();
    const { host } = render(
      <ClientProvider client={client}>
        <NetworkPill />
      </ClientProvider>,
    );
    await flush();
    expect(host.textContent).toBe('');
    client.network = 'testnet';
    const second = render(
      <ClientProvider client={client}>
        <NetworkPill />
      </ClientProvider>,
    ).host;
    await flush();
    expect(second.textContent).toBe('Testnet');
  });
});
