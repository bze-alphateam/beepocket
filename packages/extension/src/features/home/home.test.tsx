import type { DenomBranding } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from '../../protocol/client';
import {
  fail,
  ok,
  TokenErrorCodes,
  type ListedToken,
  type Method,
  type RequestOf,
  type Result,
  type TokenBalances,
  type WalletAddress,
} from '../../protocol';
import { ClientProvider } from '../../popup/client-context';
import { Router, type RouteTable } from '../../popup/router';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { Home, type HomeRoute } from './Home';
import { HomeEnvProvider, type HomeEnv } from './env';
import { registerHomeTab } from './tabs';

afterEach(cleanup);

const tok = (denom: string, symbol: string, decimals = 6): ListedToken => ({
  denom,
  symbol,
  name: symbol,
  decimals,
  kind: 'native',
  source: 'chain',
  branding: null,
});
const BZE = tok('ubze', 'BZE');
const PAGE = tok('factory/bze1x/page', 'PAGE', 2);
const addr = (index: number, label: string): WalletAddress => ({
  index,
  label,
  address: `bze1address${String(index)}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
});
const BRAND: DenomBranding = {
  font: 'inter',
  light: { background: '#FFFFFF', text: '#111111', primary: '#CC8800', secondary: '#888888' },
  dark: { background: '#000000', text: '#EEEEEE', primary: '#FFB000', secondary: '#777777' },
};

function balancesOf(denom: string, amounts: string[]): TokenBalances {
  return {
    denom,
    addresses: amounts.map((amount, index) => ({
      index,
      address: addr(index, '').address,
      amount,
    })),
    total: amounts.reduce((s, a) => (BigInt(s) + BigInt(a)).toString(), '0'),
    partial: false,
  };
}

interface World {
  tokens: ListedToken[];
  addresses: WalletAddress[];
  amounts: Record<string, string[]>;
  brandThemes: boolean;
  network: 'mainnet' | 'testnet';
  search: ListedToken[];
  lookup: Result<ListedToken>;
}

function setup(over: Partial<World> = {}) {
  const w: World = {
    tokens: [BZE, PAGE],
    addresses: [addr(0, 'Main'), addr(1, 'Savings')],
    amounts: { ubze: ['1234567890', '0'], [PAGE.denom]: ['500', '700'] },
    brandThemes: true,
    network: 'mainnet',
    search: [],
    lookup: fail(TokenErrorCodes.noSuchToken, 'none'),
    ...over,
  };
  const calls: { method: string; req: unknown }[] = [];
  const handlers: { [M in Method]?: (req: RequestOf<M>) => Result<unknown> } = {
    'home.context': () => ok({ network: w.network, brandThemes: w.brandThemes }),
    'tokens.preferred': () => ok(w.tokens),
    'wallet.addresses': () => ok({ addresses: w.addresses }),
    'tokens.balances': (r) =>
      ok(balancesOf(r.denom, w.amounts[r.denom] ?? w.addresses.map(() => '0'))),
    'tokens.theme': (r) => ok(r.denom === PAGE.denom ? BRAND : null),
    'tokens.search': () => ok(w.search),
    'tokens.lookup': () => w.lookup,
    'tokens.add': (r) => {
      const added = w.search.find((x) => x.denom === r.denom) ?? tok(r.denom, 'NEW');
      w.tokens = [...w.tokens, added];
      return ok(w.tokens);
    },
    'tokens.remove': (r) => {
      if (w.tokens.length === 1) return fail(TokenErrorCodes.lastToken, 'last');
      w.tokens = w.tokens.filter((x) => x.denom !== r.denom);
      return ok(w.tokens);
    },
    'wallet.deriveNext': () => {
      const next = addr(w.addresses.length, `Address ${String(w.addresses.length + 1)}`);
      w.addresses = [...w.addresses, next];
      w.amounts = Object.fromEntries(Object.entries(w.amounts).map(([k, v]) => [k, [...v, '0']]));
      return ok({ address: next });
    },
    'wallet.renameAddress': (r) => {
      const found = w.addresses.find((a) => a.index === r.index);
      if (!found || r.label.length < 1 || r.label.length > 32) return fail('invalid_label', 'bad');
      const renamed = { ...found, label: r.label };
      w.addresses = w.addresses.map((a) => (a.index === r.index ? renamed : a));
      return ok({ address: renamed });
    },
    'wallet.lock': () => ok({}),
  };
  const client: Client = {
    call: vi.fn(<M extends Method>(method: M, req: RequestOf<M>) => {
      calls.push({ method, req });
      const h = handlers[method] as ((r: RequestOf<M>) => Result<unknown>) | undefined;
      return Promise.resolve((h ? h(req) : fail('unknown_method', method)) as never);
    }),
  };

  const timers: { ms: number; fn: () => void; once: boolean; live: boolean }[] = [];
  const style = new Map<string, string>();
  const dataset: { scheme?: string | undefined } = {};
  const written: string[] = [];
  const onLocked = vi.fn();
  const env: HomeEnv = {
    scheduler: {
      every: (ms, fn) => {
        const t = { ms, fn, once: false, live: true };
        timers.push(t);
        return () => {
          t.live = false;
        };
      },
      after: (ms, fn) => {
        const t = { ms, fn, once: true, live: true };
        timers.push(t);
        return () => {
          t.live = false;
        };
      },
    },
    themeTarget: {
      style: {
        setProperty: (n, v) => {
          style.set(n, v);
        },
      },
      dataset,
    },
    scheme: { current: () => 'dark', subscribe: () => () => undefined },
    clipboard: {
      writeText: (text) => {
        written.push(text);
        return Promise.resolve();
      },
    },
    onLocked,
  };
  const table: RouteTable<HomeRoute> = { 'home.main': Home };
  const { host } = render(
    <ClientProvider client={client}>
      <HomeEnvProvider env={env}>
        <Router<HomeRoute> table={table} initial={{ name: 'home.main' }} />
      </HomeEnvProvider>
    </ClientProvider>,
  );
  const tick = async () => {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const fire = (ms: number) => {
    void act(() => {
      for (const t of timers.filter((x) => x.live && x.ms === ms)) {
        t.fn();
        if (t.once) t.live = false;
      }
    });
  };
  return { host, w, calls, style, written, onLocked, timers, tick, fire };
}

const byLabel = (host: HTMLElement, label: string) =>
  host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const text = (host: HTMLElement) => host.textContent;
const click = (el: Element | null) => {
  fireEvent(el, 'click');
};
const balanceCalls = (calls: { method: string }[]) =>
  calls.filter((c) => c.method === 'tokens.balances').length;

describe('balance block', () => {
  it('formats the total with the token decimals and says "in 1 of 2 addresses"', async () => {
    const s = setup();
    await s.tick();
    expect(text(s.host)).toContain('1,234.56789');
    expect(text(s.host)).toContain('in 1 of 2 addresses');
  });

  it('says "across N addresses" when every address holds it', async () => {
    const s = setup({ amounts: { ubze: ['1', '2'] } });
    await s.tick();
    expect(text(s.host)).toContain('across 2 addresses');
  });

  it('says "in none of your N addresses" and shows the empty state with all addresses', async () => {
    const s = setup({ amounts: { ubze: ['0', '0'] } });
    await s.tick();
    expect(text(s.host)).toContain('in none of your 2 addresses');
    expect(text(s.host)).toContain('No BZE yet');
    expect(text(s.host)).toContain('Main');
    expect(text(s.host)).toContain('Savings');
  });
});

describe('addresses tab', () => {
  it('folds addresses with 0 behind "Show N empty addresses"', async () => {
    const s = setup({
      addresses: [addr(0, 'Main'), addr(1, 'Two'), addr(2, 'Three')],
      amounts: { ubze: ['5', '0', '0'] },
    });
    await s.tick();
    expect(text(s.host)).not.toContain('Two');
    click(
      [...s.host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Show 2 empty addresses',
      ) ?? null,
    );
    expect(text(s.host)).toContain('Two');
    expect(text(s.host)).toContain('Three');
  });

  it('copies the full address and shows the toast until it expires', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Copy address Main'));
    await s.tick();
    expect(s.written).toEqual([addr(0, 'Main').address]);
    expect(text(s.host)).toContain('Copied');
    s.fire(1800);
    expect(text(s.host)).not.toContain('Copied');
  });

  it('derives the next address and opens the add sheet', async () => {
    const s = setup();
    await s.tick();
    click(
      [...s.host.querySelectorAll('button')].find((b) => b.textContent.includes('Add address')) ??
        null,
    );
    await s.tick();
    expect(s.calls.some((c) => c.method === 'wallet.deriveNext')).toBe(true);
    expect(s.host.querySelector('[role="dialog"]')?.textContent).toContain('Address added');
  });

  it('renames within 1–32 characters and refuses the rest', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Rename Main'));
    const input = () => s.host.querySelector<HTMLInputElement>('[role="dialog"] input');
    const type = (v: string) => {
      const el = input();
      if (el) el.value = v;
      fireEvent(el, 'input');
    };
    type('');
    fireEvent(s.host.querySelector('[role="dialog"] form'), 'submit');
    await s.tick();
    expect(text(s.host)).toContain('Use 1 to 32 characters.');
    type('x'.repeat(33));
    fireEvent(s.host.querySelector('[role="dialog"] form'), 'submit');
    await s.tick();
    expect(s.calls.some((c) => c.method === 'wallet.renameAddress')).toBe(false);
    type('Daily');
    fireEvent(s.host.querySelector('[role="dialog"] form'), 'submit');
    await s.tick();
    expect(s.w.addresses[0]?.label).toBe('Daily');
    expect(s.host.querySelector('[role="dialog"]')).toBeNull();
    expect(text(s.host)).toContain('Daily');
  });
});

describe('header', () => {
  it('hides the token selector with exactly one preferred token', async () => {
    const one = setup({ tokens: [BZE] });
    await one.tick();
    expect(byLabel(one.host, 'Choose token')).toBeNull();
    cleanup();
    const two = setup();
    await two.tick();
    expect(byLabel(two.host, 'Choose token')).not.toBeNull();
  });

  it('shows the testnet pill and locks through wallet.lock', async () => {
    const s = setup({ network: 'testnet' });
    await s.tick();
    expect(text(s.host)).toContain('Testnet');
    click(byLabel(s.host, 'Lock wallet'));
    await s.tick();
    expect(s.onLocked).toHaveBeenCalled();
  });
});

describe('token switcher', () => {
  const open = async (s: ReturnType<typeof setup>) => {
    await s.tick();
    click(byLabel(s.host, 'Choose token'));
    await s.tick();
  };

  it('lists preferred tokens with balances and switches', async () => {
    const s = setup();
    await open(s);
    const dialog = s.host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('1,234.56789');
    expect(dialog?.textContent).toContain('12.00');
    click(
      [...(dialog?.querySelectorAll('button.bp-home-label') ?? [])].find(
        (b) => b.textContent === 'PAGE',
      ) ?? null,
    );
    await s.tick();
    expect(s.host.querySelector('[role="dialog"]')).toBeNull();
    expect(text(s.host)).toContain('12.00');
  });

  it('searches and adds a token', async () => {
    const extra = tok('factory/bze1x/gold', 'GOLD');
    const s = setup({ search: [extra] });
    await open(s);
    const input = s.host.querySelector<HTMLInputElement>('[role="dialog"] input');
    if (input) input.value = 'gol';
    fireEvent(input, 'input');
    await s.tick();
    click(byLabel(s.host, 'Add GOLD'));
    await s.tick();
    expect(s.w.tokens.map((x) => x.symbol)).toEqual(['BZE', 'PAGE', 'GOLD']);
  });

  it('offers a pasted code that only lookup knows, and says when none exists', async () => {
    const gold = tok('factory/bze1x/gold', 'GOLD');
    const s = setup({ lookup: ok(gold) });
    await open(s);
    const input = s.host.querySelector<HTMLInputElement>('[role="dialog"] input');
    if (input) input.value = gold.denom;
    fireEvent(input, 'input');
    await s.tick();
    expect(byLabel(s.host, 'Add GOLD')).not.toBeNull();
    s.w.lookup = fail(TokenErrorCodes.noSuchToken, 'none');
    if (input) input.value = 'factory/bze1x/none';
    fireEvent(input, 'input');
    await s.tick();
    expect(text(s.host)).toContain('No token with this code on BeeZee');
  });

  it('removes a token but blocks removing the last one', async () => {
    const s = setup();
    await open(s);
    click(byLabel(s.host, 'Remove PAGE'));
    await s.tick();
    expect(s.w.tokens).toEqual([BZE]);
    expect(byLabel(s.host, 'Remove BZE')?.hasAttribute('disabled')).toBe(true);
  });
});

describe('theme', () => {
  it('applies the token kit on change and the BeePocket look when brand themes are off', async () => {
    const s = setup();
    await s.tick();
    const bzeVars = s.style.get('--bp-primary');
    await s.tick();
    click(byLabel(s.host, 'Choose token'));
    await s.tick();
    click(
      [...s.host.querySelectorAll('button.bp-home-label')].find((b) => b.textContent === 'PAGE') ??
        null,
    );
    await s.tick();
    await s.tick();
    expect(s.style.get('--bp-primary')).not.toBe(bzeVars);

    cleanup();
    const off = setup({ brandThemes: false, tokens: [PAGE, BZE] });
    await off.tick();
    expect(off.calls.some((c) => c.method === 'tokens.theme')).toBe(false);
    expect(off.style.get('--bp-primary')).not.toBe(s.style.get('--bp-primary'));
  });
});

describe('refresh', () => {
  it('reads on open, every 15 s, and stops when the screen goes away', async () => {
    const s = setup();
    await s.tick();
    expect(balanceCalls(s.calls)).toBe(1);
    s.fire(15_000);
    await s.tick();
    expect(balanceCalls(s.calls)).toBe(2);
    cleanup();
    expect(s.timers.filter((x) => x.ms === 15_000 && x.live)).toHaveLength(0);
  });
});

describe('HomeTabs slot', () => {
  it('shows a registered tab body', async () => {
    registerHomeTab({ id: 'probe', label: 'Probe', render: () => <p>probe body</p> });
    const s = setup();
    await s.tick();
    click(
      [...s.host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Probe') ?? null,
    );
    expect(text(s.host)).toContain('probe body');
  });
});
