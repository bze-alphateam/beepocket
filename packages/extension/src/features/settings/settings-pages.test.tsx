import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
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
import { readPermittedClipboard } from '../../popup/clipboard';
import { ClientProvider } from '../../popup/client-context';
import { Router, type RouteTable } from '../../popup/router';
import { AppearanceState, type Appearance, type SchemeQuery } from '../../theme';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { LockEnvProvider } from '../lock/env';
import type { StateEvents } from '../lock/events';
import { bookRoutes } from '../address-book/routes';
import { ConnectedSitesScreen } from '../dapp/ConnectedSitesScreen';
import { StateSupervisor } from '../lock/StateSupervisor';
import { browserOnboardingEnv } from '../onboarding/env';
import { browserSettingsEnv, SettingsEnvProvider, type SettingsEnv } from './env';
import { REVEAL_IDLE_MS } from './RevealPhrase';
import { NetworkPill } from './NetworkPill';
import { settingsRoutes } from './routes';

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
  /** Weak lock: token writes after this many are refused with needs-password until reauth. */
  weakLockAfter: number | null = null;
  private writes = 0;
  private weakLocked(): boolean {
    if (this.weakLockAfter === null) return false;
    if (this.writes >= this.weakLockAfter) return true;
    this.writes++;
    return false;
  }
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
          if (this.weakLocked()) return fail(WalletErrorCodes.needsPassword, 'pw');
          if (this.failAdd) return fail('unexpected', 'no');
          const { denom } = request as { denom: string };
          this.preferred[this.network] = [...(this.preferred[this.network] ?? []), denom];
          return ok(tokens());
        }
        case 'tokens.remove': {
          if (this.weakLocked()) return fail(WalletErrorCodes.needsPassword, 'pw');
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
        case 'wallet.reauth':
          this.weakLockAfter = null;
          return ok({ status: 'ok' });
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

/** The Settings tree on the real routes, with Home and the sites screen stood in by markers. */
function rig(
  client = new FakeClient(),
  initial: string | { name: string; required?: boolean } = 'settings.main',
) {
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
  const table = {
    ...settingsRoutes,
    ...bookRoutes,
    'home.main': Marker,
    'dapp.sites': ConnectedSitesScreen,
    'lock.unlock': Marker,
  } as unknown as RouteTable<{ name: string }>;
  const { host } = render(
    <ClientProvider client={client}>
      <AppearanceProvider state={appearance}>
        <SettingsEnvProvider env={env}>
          <LockEnvProvider clock={clock} events={events}>
            <Router
              table={table}
              initial={typeof initial === 'string' ? { name: initial } : initial}
            >
              <StateSupervisor />
            </Router>
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
  return { host, client, appearance, saved, written, button, dialogs, key };
}

async function opened(
  client?: FakeClient,
  initial?: string | { name: string; required?: boolean },
) {
  const r = rig(client, initial);
  await flush();
  return r;
}

type Rig = Awaited<ReturnType<typeof opened>>;

/** Taps the rows in turn, each one a level deeper (or a route away). */
async function go(r: Rig, ...rows: (string | RegExp)[]) {
  for (const row of rows) {
    fireEvent(must(r.button(row)), 'click');
    await flush();
  }
}

const CONFIGURATION = /^Configuration/;
const APPEARANCE = /^Appearance/;
const SECURITY = /^Security/;
const ADVANCED = /^Advanced/;
/** The page shown: its title, or `at:<route>` when a stand-in marker is on screen. */
const page = (r: Rig) =>
  r.host.querySelector('.bp-screen-title')?.textContent ?? r.host.textContent;
const titles = (host: HTMLElement) =>
  [...host.querySelectorAll('.bp-settings-row-title, .bp-toggle-title')].map((e) => e.textContent);
const close = (r: Rig) => must(r.button('Close settings'));
const back = (r: Rig) => must(r.button('Back'));

describe('Settings pages', () => {
  it('lists the top level in order, with the counts and the footer', async () => {
    const { host, button } = await opened();
    expect(host.querySelector('.bp-screen-title')?.textContent).toBe('Settings');
    expect(titles(host)).toEqual(['Manage tokens', 'Configuration', 'Address book', 'Lock wallet']);
    expect(host.textContent).toContain('BeePocket 1.2.3 · beezee-1');
    // The footer logo stays BeePocket green whatever token kit is active.
    const stops = [...host.querySelectorAll('.bp-settings-footer .bp-logo stop')];
    expect(stops.map((s) => s.getAttribute('stop-color'))).toEqual([
      '#3DD07A',
      '#1E9150',
      '#3DD07A',
      '#1E9150',
    ]);
    const values = [...host.querySelectorAll('.bp-settings-row')].map((r) => r.textContent);
    expect(values[0]).toContain('2');
    expect(values[2]).toContain('1');
    expect(host.querySelector('input[type="checkbox"], select')).toBeNull();
    // The root has the × only, no way up.
    expect(button('Back')).toBeUndefined();
    expect(button('Close settings')).toBeDefined();
  });

  it('Configuration lists Appearance, Connected sites, Security and Advanced in order', async () => {
    const r = await opened();
    await go(r, CONFIGURATION);
    expect(page(r)).toBe('Configuration');
    expect(titles(r.host)).toEqual(['Appearance', 'Connected sites', 'Security', 'Advanced']);
    expect(r.host.querySelector('[aria-label="Connected sites · 2"]')).not.toBeNull();
  });

  it('← goes up exactly one level, from every level', async () => {
    const r = await opened();
    await go(r, CONFIGURATION, SECURITY, /^Lock timers/);
    expect(page(r)).toBe('Lock timers');
    await go(r, 'Back');
    expect(page(r)).toBe('Security');
    expect(titles(r.host)).toEqual(['Lock timers', 'Show recovery phrase']);
    expect(r.host.textContent).toContain('15 min · 1 h');
    await go(r, /^Show recovery phrase/);
    expect(page(r)).toBe('Recovery phrase');
    await go(r, 'Back');
    expect(page(r)).toBe('Security');
    await go(r, 'Back');
    expect(page(r)).toBe('Configuration');
    await go(r, APPEARANCE);
    expect(page(r)).toBe('Appearance');
    await go(r, 'Back');
    expect(page(r)).toBe('Configuration');
    await go(r, ADVANCED);
    expect(page(r)).toBe('Advanced');
    await go(r, 'Back');
    expect(page(r)).toBe('Configuration');
    await go(r, 'Back');
    expect(page(r)).toBe('Settings');
    await go(r, /^Address book/);
    expect(page(r)).toBe('Address book');
    await go(r, 'Back');
    expect(page(r)).toBe('Settings');
  });

  it('× returns to Home from the root and from every nested level', async () => {
    const r = await opened();
    await go(r, 'Close settings');
    expect(page(r)).toBe('at:home.main');
    cleanup();
    for (const route of [
      ['settings.configuration'],
      ['settings.appearance'],
      ['settings.security'],
      ['settings.timers'],
      ['settings.advanced'],
      ['settings.reveal'],
      ['settings.book'],
      ['settings.pickTokens'],
      ['dapp.sites'],
    ] as const) {
      const quiet = new FakeClient();
      quiet.sites = [];
      const deep = await opened(quiet, route[0]);
      expect(deep.button('Close settings')).toBeDefined();
      await go(deep, 'Close settings');
      expect(page(deep)).toBe('at:home.main');
      cleanup();
    }
  });

  it('Escape goes up one level, and to Home from the root', async () => {
    const r = await opened();
    await go(r, CONFIGURATION, SECURITY);
    r.key('Escape');
    await flush();
    expect(page(r)).toBe('Configuration');
    r.key('Escape');
    await flush();
    expect(page(r)).toBe('Settings');
    r.key('Escape');
    await flush();
    expect(page(r)).toBe('at:home.main');
  });

  it('every nested page carries the logo, version and chain footer', async () => {
    const r = await opened();
    await go(r, CONFIGURATION, SECURITY, /^Lock timers/);
    for (let i = 0; i < 3; i++) {
      expect(r.host.querySelector('.bp-footer .bp-settings-footer .bp-logo')).not.toBeNull();
      expect(r.host.querySelector('.bp-footer')?.textContent).toContain(
        'BeePocket 1.2.3 · beezee-1',
      );
      await go(r, 'Back');
    }
    await go(r, /^Address book/);
    expect(r.host.querySelector('.bp-footer')?.textContent).toContain('BeePocket 1.2.3 · beezee-1');
    await go(r, 'Back', /^Manage tokens/);
    expect(r.host.querySelector('.bp-footer')?.textContent).toContain('BeePocket 1.2.3 · beezee-1');
  });

  it('Manage tokens keeps Save directly above the footer', async () => {
    const r = await opened(undefined, 'settings.pickTokens');
    const footer = must(r.host.querySelector('.bp-footer'));
    expect([...footer.children].map((c) => c.className)).toEqual([
      'bp-bottom-bar',
      'bp-settings-footer',
    ]);
    expect(footer.querySelector('.bp-bottom-bar button')?.textContent).toBe('Save');
    // ← goes up to Settings.
    await go(r, 'Back');
    expect(page(r)).toBe('Settings');
  });

  it('the appearance control saves each pick and keeps System picked', async () => {
    const r = await opened();
    await go(r, CONFIGURATION, APPEARANCE);
    const { host, appearance, saved } = r;
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

  it('saves Theme follows token', async () => {
    const r = await opened();
    await go(r, CONFIGURATION, APPEARANCE);
    const { client, host } = r;
    const sw = must(
      [...host.querySelectorAll('[role="switch"]')].find((s) =>
        s.textContent.includes('Theme follows token'),
      ),
    );
    fireEvent(sw, 'click');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    await flush();
    expect(client.saw('settings.set')).toEqual([{ brandThemes: false }]);
  });

  it('puts Theme follows token back when the save is refused', async () => {
    const client = new FakeClient();
    client.call = ((orig) => (method: Method, request: unknown) =>
      method === 'settings.set'
        ? Promise.resolve(fail(WalletErrorCodes.needsPassword, 'locked'))
        : orig(method, request))(client.call.bind(client));
    const r = await opened(client);
    await go(r, CONFIGURATION, APPEARANCE);
    const { host } = r;
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
  });

  it('Lock wallet locks at once and shows the unlock screen', async () => {
    const { client, button, host } = await opened();
    fireEvent(button('Lock wallet'), 'click');
    await flush();
    expect(client.saw('wallet.lock')).toEqual([{}]);
    expect(client.walletState).toBe('locked');
    expect(host.textContent).toBe('at:lock.unlock');
  });

  it('Manage tokens and Connected sites open their screens', async () => {
    const first = await opened();
    fireEvent(first.button(/^Manage tokens/), 'click');
    await flush();
    expect(first.host.querySelector('.bp-screen-title')?.textContent).toBe('Manage tokens');
    cleanup();
    const second = await opened();
    await go(second, CONFIGURATION);
    await go(second, 'Connected sites · 2');
    expect(page(second)).toBe('Connected sites');
  });

  it('the address book is a page with the contacts, a New contact button and the footer', async () => {
    const { button, host } = await opened();
    fireEvent(button(/^Address book/), 'click');
    await flush();
    expect(host.querySelector('.bp-screen-title')?.textContent).toBe('Address book');
    expect(host.textContent).toContain('Alex');
    expect(host.querySelector('.bp-footer')?.textContent).toContain('New contact');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('New contact and editing one open as a small sheet on the page', async () => {
    const r = await opened(undefined, 'settings.book');
    fireEvent(must(r.button(/New contact/)), 'click');
    expect(r.dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['New contact']);
    expect(r.host.querySelector('.bp-screen-title')?.textContent).toBe('Address book');
    // Escape closes the sheet first, the page stays.
    r.key('Escape');
    expect(r.dialogs()).toHaveLength(0);
    expect(page(r)).toBe('Address book');
    fireEvent(must(r.button(/Alex/)), 'click');
    expect(r.dialogs().map((d) => d.getAttribute('aria-label'))).toEqual(['Edit contact']);
  });

  describe('testnet', () => {
    const toggle = (host: HTMLElement) =>
      must(
        [...host.querySelectorAll('[role="switch"]')].find((s) =>
          s.textContent.includes('Testnet'),
        ),
      );
    const openAdvanced = async (client?: FakeClient) => {
      const r = await opened(client);
      await go(r, CONFIGURATION, ADVANCED);
      return r;
    };

    it('switches the network, shows it at once and names it in the footer', async () => {
      const { client, host } = await openAdvanced();
      expect(titles(host)).toEqual(['Testnet']);
      fireEvent(toggle(host), 'click');
      expect(toggle(host).getAttribute('aria-checked')).toBe('true');
      await flush();
      expect(client.saw('network.set')).toEqual([{ id: 'testnet' }]);
      expect(host.textContent).toContain('BeePocket 1.2.3 · bzetestnet-3');
    });

    it('puts the switch back and shows the banner here when the network is refused', async () => {
      const client = new FakeClient();
      client.call = ((orig) => (method: Method, request: unknown) =>
        method === 'network.set'
          ? Promise.resolve(fail('unexpected', 'no'))
          : orig(method, request))(client.call.bind(client));
      const { host } = await openAdvanced(client);
      fireEvent(toggle(host), 'click');
      await flush();
      expect(toggle(host).getAttribute('aria-checked')).toBe('false');
      expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be saved');
    });

    it('lands on pick tokens when the network has none', async () => {
      const client = new FakeClient();
      client.preferred.testnet = [];
      const { host } = await openAdvanced(client);
      fireEvent(toggle(host), 'click');
      await flush();
      await flush();
      expect(host.textContent).toContain('Pick your tokens');
      expect(host.querySelector('.bp-pill')?.textContent).toBe('Testnet');
    });
  });

  describe('lock timers', () => {
    const openTimers = async () => {
      const r = await opened();
      await go(r, CONFIGURATION, SECURITY, /^Lock timers/);
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

    it('is a page with the two lock times', async () => {
      const r = await openTimers();
      expect(page(r)).toBe('Lock timers');
      expect(r.host.textContent).toContain('Lock sending after');
      expect(r.host.textContent).toContain('Lock wallet after');
    });

    it('saves both keys and shows them on the Security row', async () => {
      const r = await openTimers();
      await pick(r, 'Lock sending after', '5 min');
      await pick(r, 'Lock wallet after', '2 h');
      expect(r.client.saw('settings.set')).toEqual([
        { weakLockMinutes: 5 },
        { fullLockMinutes: 120 },
      ]);
      await go(r, 'Back');
      expect(page(r)).toBe('Security');
      expect(r.host.textContent).toContain('5 min · 2 h');
    });

    it('a dropdown on the page takes Escape first', async () => {
      const r = await openTimers();
      fireEvent(r.button(/^Lock sending after, now/), 'click');
      expect(r.dialogs()).toHaveLength(1);
      r.key('Escape');
      expect(r.dialogs()).toHaveLength(0);
      expect(page(r)).toBe('Lock timers');
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
      await go(r, CONFIGURATION, SECURITY);
      expect(r.host.textContent).toContain('7 min · 1 h');
      await go(r, /^Lock timers/);
      await pick(r, 'Lock sending after', '7 min');
      expect(client.saw('settings.set')).toEqual([]);
    });
  });
});

describe('Show recovery phrase', () => {
  const openReveal = async (client = new FakeClient()) => {
    const r = await opened(client);
    await go(r, CONFIGURATION, SECURITY, /^Show recovery phrase/);
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
    expect(page(r)).toBe('Recovery phrase');
    await submit(r.host, 'pw');
    expect(r.client.saw('wallet.revealMnemonic')).toEqual([{ password: 'pw' }]);
    expect(r.host.textContent).toContain('Never share them');
    expect(r.host.textContent).not.toContain('abandon');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    expect(words(r.host)).toHaveLength(24);
    expect(r.host.textContent).toContain('abandon');
    // Hide sits above the footer, which stays.
    expect(r.host.querySelector('.bp-footer')?.textContent).toContain('BeePocket 1.2.3');
    fireEvent(r.button('Copy phrase'), 'click');
    await flush();
    expect(r.written).toEqual([PHRASE]);
  });

  for (const [how, leave] of [
    [
      'Hide',
      (r: Rig) => {
        fireEvent(must(r.button('Hide')), 'click');
      },
    ],
    [
      '←',
      (r: Rig) => {
        fireEvent(back(r), 'click');
      },
    ],
    [
      'Escape',
      (r: Rig) => {
        r.key('Escape');
      },
    ],
  ] as const) {
    it(`drops the phrase on ${how} and asks the password again`, async () => {
      const r = await openReveal();
      await submit(r.host, 'pw');
      fireEvent(r.button(/^Reveal phrase/), 'click');
      leave(r);
      await flush();
      expect(r.host.textContent).not.toContain('abandon');
      expect(page(r)).toBe('Security');
      fireEvent(r.button(/^Show recovery phrase/), 'click');
      await flush();
      expect(r.host.querySelector('input[type="password"]')).not.toBeNull();
      expect(r.host.textContent).not.toContain('abandon');
    });
  }

  it('closing Settings with × drops the phrase too', async () => {
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    fireEvent(close(r), 'click');
    await flush();
    expect(page(r)).toBe('at:home.main');
    expect(r.host.textContent).not.toContain('abandon');
    cleanup();
    const again = await opened(undefined, 'settings.reveal');
    expect(again.host.querySelector('input[type="password"]')).not.toBeNull();
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

  it('leaves the page and drops the phrase as soon as the worker pushes a weak lock', async () => {
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    events.push('unlocked');
    expect(words(r.host)).toHaveLength(24);
    events.push('weakLocked');
    await flush();
    expect(r.host.textContent).not.toContain('abandon');
    expect(page(r)).toBe('Security');
  });

  it('a full lock drops the phrase and leaves the route to the unlock screen', async () => {
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    events.push('locked');
    await flush();
    expect(page(r)).toBe('at:lock.unlock');
    expect(r.host.textContent).not.toContain('abandon');
  });

  it('hides the phrase after the idle time', async () => {
    vi.useFakeTimers();
    const r = await openReveal();
    await submit(r.host, 'pw');
    fireEvent(r.button(/^Reveal phrase/), 'click');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REVEAL_IDLE_MS + 1_000);
    });
    expect(r.host.textContent).not.toContain('abandon');
    expect(page(r)).toBe('Security');
  });
});

describe('Manage tokens', () => {
  let scheduler = new FakeScheduler();
  let clipboard = '';
  let readText = () => Promise.resolve(clipboard);
  // `chrome.permissions`: `clipboardRead` is granted unless a test says otherwise.
  const permissions = {
    grant: true,
    request: vi.fn(() => Promise.resolve(permissions.grant)),
  };
  const openPick = async (client: FakeClient) => {
    scheduler = new FakeScheduler();
    clipboard = '';
    readText = () => Promise.resolve(clipboard);
    permissions.grant = true;
    permissions.request.mockClear();
    const env: SettingsEnv = {
      manifest: { version: () => '1.2.3' },
      clipboard: {
        readText: () => readPermittedClipboard(permissions, { readText: () => readText() }),
        writeText: () => Promise.resolve(),
      },
      scheduler,
    };
    const table = { ...settingsRoutes, 'home.main': Marker, 'settings.main': Marker };
    const { host } = render(
      <ClientProvider client={client}>
        <LockEnvProvider clock={clock} events={events}>
          <SettingsEnvProvider env={env}>
            <Router
              table={table as unknown as RouteTable<{ name: string }>}
              initial={{ name: 'settings.pickTokens' }}
            />
          </SettingsEnvProvider>
        </LockEnvProvider>
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
    expect(host.textContent).toContain('Manage tokens');
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

  describe('in the weak lock', () => {
    const password = (host: HTMLElement) =>
      host.querySelector<HTMLInputElement>('input[type="password"]');
    const unlock = async (host: HTMLElement) => {
      const input = must(password(host));
      input.value = 'pw';
      fireEvent(input, 'input');
      fireEvent(input.closest('form'), 'submit');
      await flush();
    };

    it('asks the password in place, keeps the picks, then saves them', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      client.weakLockAfter = 0;
      const host = await openPick(client);
      fireEvent(row(host, 'PAGE'), 'click');
      fireEvent(row(host, 'BZE'), 'click');
      fireEvent(button(host, 'Save'), 'click');
      await flush();
      expect(password(host)).not.toBeNull();
      expect(host.textContent).toContain('Unlock and save');
      // The pick count stays above the password field.
      expect(must(host.querySelector('.bp-bottom-bar-note')).textContent).toBe('1 selected');
      fireEvent(row(host, 'PAGE'), 'click');
      expect(must(host.querySelector('.bp-bottom-bar-note')).textContent).toBe(
        'Pick at least one token.',
      );
      fireEvent(row(host, 'PAGE'), 'click');
      expect(host.textContent).not.toContain('The change could not be saved.');
      expect(client.saw('tokens.remove')).toEqual([]);
      expect(client.preferred.mainnet).toEqual(['ubze']);
      expect(row(host, 'PAGE').getAttribute('aria-checked')).toBe('true');
      expect(row(host, 'BZE').getAttribute('aria-checked')).toBe('false');
      await unlock(host);
      expect(client.saw('wallet.reauth')).toEqual([{ password: 'pw' }]);
      expect(client.preferred.mainnet).toEqual([PAGE.denom]);
      expect(host.textContent).toBe('at:settings.main');
    });

    it('a retry sends only what the interrupted save had not written yet', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      // The add lands, then the weak lock refuses the remove.
      client.weakLockAfter = 1;
      const host = await openPick(client);
      fireEvent(row(host, 'PAGE'), 'click');
      fireEvent(row(host, 'BZE'), 'click');
      fireEvent(button(host, 'Save'), 'click');
      await flush();
      expect(client.preferred.mainnet).toEqual(['ubze', PAGE.denom]);
      await unlock(host);
      expect(client.saw('tokens.add')).toEqual([{ denom: PAGE.denom }]);
      expect(client.saw('tokens.remove')).toEqual([{ denom: 'ubze' }, { denom: 'ubze' }]);
      expect(client.preferred.mainnet).toEqual([PAGE.denom]);
      expect(host.textContent).toBe('at:settings.main');
    });
  });

  describe('when Home requires it', () => {
    const required = async () => {
      const client = new FakeClient();
      client.preferred.mainnet = [];
      return opened(client, { name: 'settings.pickTokens', required: true });
    };

    it('has no ×, and Escape does not leave', async () => {
      const r = await required();
      expect(r.button('Close settings')).toBeUndefined();
      expect(r.button('Back')).toBeUndefined();
      r.key('Escape');
      await flush();
      expect(page(r)).toBe('Pick your tokens');
    });

    it('a landing reached by switching to an empty network keeps × to Home', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = [];
      const r = await opened(client, 'settings.pickTokens');
      expect(r.button('Close settings')).toBeDefined();
      await go(r, 'Close settings');
      expect(page(r)).toBe('at:home.main');
    });
  });

  describe('token denom', () => {
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
      fireEvent(button(host, 'Paste token denom'), 'click');
      await flush();
      expect(codeField(host).value).toBe(GOLD.denom);
      expect(row(host, 'GOLD').getAttribute('aria-checked')).toBe('true');
    });

    it.each([
      [
        fail(TokenErrorCodes.noSuchToken, 'x'),
        'No token uses this denom. Check it with whoever shared it.',
      ],
      [fail(TokenErrorCodes.invalidCode, 'x'), "That isn't a valid token denom."],
      [fail('unexpected', 'x'), "We couldn't check this denom. Try again."],
    ])('an unknown code says so under the field and adds nothing (%#)', async (answer, text) => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      client.lookup = () => Promise.resolve(answer);
      const host = await openPick(client);
      const hint = 'The unique identifier of each token';
      expect(must(host.querySelector('.ob-code')).textContent).toContain(hint);
      typeCode(host, 'factory/bze1x/nope');
      scheduler.run();
      await flush();
      expect(must(host.querySelector('.ob-code')).textContent).toContain(text);
      // The error takes the hint's line.
      expect(must(host.querySelector('.ob-code')).textContent).not.toContain(hint);
      expect(symbols(host)).toEqual(['BZE', 'PAGE']);
      expect(host.textContent).toContain('1 selected');
      fireEvent(row(host, 'PAGE'), 'click');
      fireEvent(button(host, 'Save'), 'click');
      await flush();
      expect(client.saw('tokens.add')).toEqual([{ denom: PAGE.denom }]);
    });

    it('Paste asks for clipboardRead in the tap itself, then reads and looks up', async () => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      clipboard = GOLD.denom;
      fireEvent(button(host, 'Paste token denom'), 'click');
      // Same tick as the click, before any promise has settled: the user gesture still holds.
      expect(permissions.request).toHaveBeenCalledExactlyOnceWith({
        permissions: ['clipboardRead'],
      });
      expect(client.saw('tokens.lookup')).toEqual([]);
      await flush();
      expect(codeField(host).value).toBe(GOLD.denom);
      expect(client.saw('tokens.lookup')).toEqual([{ code: GOLD.denom }]);
      expect(row(host, 'GOLD').getAttribute('aria-checked')).toBe('true');
    });

    it.each([
      ['the permission is declined', () => (permissions.grant = false)],
      [
        'the read fails',
        () => (readText = () => Promise.reject(new DOMException('no', 'NotAllowedError'))),
      ],
    ])('when %s, Paste focuses the field and says to paste by hand', async (_, refuse) => {
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      const host = await openPick(client);
      clipboard = GOLD.denom;
      refuse();
      fireEvent(button(host, 'Paste token denom'), 'click');
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([]);
      expect(codeField(host).value).toBe('');
      expect(document.activeElement).toBe(codeField(host));
      expect(must(host.querySelector('.ob-code')).textContent).toContain('Paste with Ctrl+V / ⌘V');
      // Ctrl+V / ⌘V lands as input: it clears the hint and is looked up like typing.
      typeCode(host, GOLD.denom);
      scheduler.run();
      await flush();
      expect(must(host.querySelector('.ob-code')).textContent).not.toContain('Ctrl+V');
      expect(client.saw('tokens.lookup')).toEqual([{ code: GOLD.denom }]);
    });

    it('a pasted IBC code is looked up exactly as the chain spells it', async () => {
      const IBC = 'ibc/02EE50AB3A4B7540FA001B24CB75E688016F65547CABE885EA184338440080B2';
      const sherpa = { ...token(IBC, 'SHERPA'), kind: 'ibc', source: 'scan' };
      const client = new FakeClient();
      client.preferred.mainnet = ['ubze'];
      client.lookup = (code) =>
        Promise.resolve(code === IBC ? ok(sherpa) : fail(TokenErrorCodes.noSuchToken, 'none'));
      const host = await openPick(client);
      clipboard = `${IBC}\n`;
      fireEvent(button(host, 'Paste token denom'), 'click');
      await flush();
      expect(client.saw('tokens.lookup')).toEqual([{ code: IBC }]);
      expect(row(host, 'SHERPA').getAttribute('aria-checked')).toBe('true');
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
      fireEvent(button(host, 'Paste token denom'), 'click');
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
        "That isn't a valid token denom.",
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
      expect(host.textContent).toContain('No token uses this denom.');
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

describe('the browser clipboard behind Paste', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const stub = (grant: boolean) => {
    const request = vi.fn(() => Promise.resolve(grant));
    const readText = vi.fn(() => Promise.resolve('factory/bze1x/ugold'));
    vi.stubGlobal('chrome', { permissions: { request } });
    vi.stubGlobal('navigator', { clipboard: { readText, writeText: vi.fn() } });
    return { request, readText };
  };
  const readers = [
    ['Settings', () => browserSettingsEnv.clipboard.readText()],
    ['onboarding', () => browserOnboardingEnv().clipboard.readText()],
  ] as const;

  it.each(readers)('%s asks for clipboardRead synchronously, then reads', async (_, read) => {
    const s = stub(true);
    const reading = read();
    // Asked before anything is awaited, so the tap's user gesture is still there.
    expect(s.request).toHaveBeenCalledExactlyOnceWith({ permissions: ['clipboardRead'] });
    expect(s.readText).not.toHaveBeenCalled();
    await expect(reading).resolves.toBe('factory/bze1x/ugold');
  });

  it.each(readers)('%s never reads when clipboardRead is declined', async (_, read) => {
    const s = stub(false);
    await expect(read()).rejects.toThrow();
    expect(s.readText).not.toHaveBeenCalled();
  });

  it('the manifest offers clipboardRead as optional only', () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../public/manifest.json'), 'utf8'),
    ) as { permissions: string[]; optional_permissions?: string[] };
    expect(manifest.permissions).toEqual(['storage', 'alarms', 'activeTab', 'favicon']);
    expect(manifest.optional_permissions).toEqual(['clipboardRead']);
  });
});
