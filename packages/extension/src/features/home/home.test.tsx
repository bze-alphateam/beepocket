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
import { Home, type HomeRoute, type SendTarget, type SettingsTarget } from './Home';
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
  /** What `tokens.search('')` answers: every token on any address, plus ubze. */
  held: ListedToken[];
  lookup: Result<ListedToken>;
  /** Indexes of addresses whose balance read fails. */
  failed: number[];
}

function setup(
  over: Partial<World> = {},
  route: HomeRoute = { name: 'home.main' },
  /** Methods that wait from the first render until `releaseAll()`. */
  held: Method[] = [],
) {
  const w: World = {
    tokens: [BZE, PAGE],
    addresses: [addr(0, 'Main'), addr(1, 'Savings')],
    amounts: { ubze: ['1234567890', '0'], [PAGE.denom]: ['500', '700'] },
    brandThemes: true,
    network: 'mainnet',
    search: [],
    held: [BZE],
    lookup: fail(TokenErrorCodes.noSuchToken, 'none'),
    failed: [],
    ...over,
  };
  const calls: { method: string; req: unknown }[] = [];
  const handlers: { [M in Method]?: (req: RequestOf<M>) => Result<unknown> } = {
    'home.context': () => ok({ network: w.network, brandThemes: w.brandThemes }),
    'tokens.preferred': () => ok(w.tokens),
    'wallet.addresses': () => ok({ addresses: w.addresses }),
    'tokens.balances': (r) => {
      const b = balancesOf(r.denom, w.amounts[r.denom] ?? w.addresses.map(() => '0'));
      const addrs = b.addresses.map((a) =>
        w.failed.includes(a.index) ? { ...a, amount: '0', failed: true } : a,
      );
      const total = addrs.reduce((n, a) => n + BigInt(a.amount), 0n).toString();
      return ok({ ...b, addresses: addrs, total, partial: w.failed.length > 0 });
    },
    'tokens.theme': (r) => ok(r.denom === PAGE.denom ? BRAND : null),
    'tokens.search': (r) => ok(r.query === '' ? w.held : w.search),
    'tokens.lookup': () => w.lookup,
    'tokens.add': (r) => {
      const added =
        [...w.search, ...w.held].find((x) => x.denom === r.denom) ?? tok(r.denom, 'NEW');
      w.tokens = [...w.tokens, added];
      return ok(w.tokens);
    },
    'tokens.remove': (r) => {
      if (w.tokens.length === 1) return fail(TokenErrorCodes.lastToken, 'last');
      w.tokens = w.tokens.filter((x) => x.denom !== r.denom);
      return ok(w.tokens);
    },
    'wallet.previewNext': () => {
      const index = w.addresses.length;
      return ok({ index, address: addr(index, '').address });
    },
    'wallet.deriveNext': (r) => {
      const index = w.addresses.length;
      if (r.index !== undefined && r.index !== index) return fail('stale_index', 'stale');
      const next = addr(index, r.label ?? `Address ${String(index + 1)}`);
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
  const gates = new Map<string, Promise<void>>();
  const hold = (method: string) => {
    let release: () => void = () => undefined;
    gates.set(
      method,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return () => {
      gates.delete(method);
      release();
    };
  };
  const releases = held.map(hold);
  const client: Client = {
    call: vi.fn(async <M extends Method>(method: M, req: RequestOf<M>) => {
      calls.push({ method, req });
      await gates.get(method);
      const h = handlers[method] as ((r: RequestOf<M>) => Result<unknown>) | undefined;
      return (h ? h(req) : fail('unknown_method', method)) as never;
    }),
  };

  const timers: { ms: number; fn: () => void; once: boolean; live: boolean }[] = [];
  const style = new Map<string, string>();
  const dataset: { scheme?: string | undefined } = {};
  const written: string[] = [];
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
  };
  const seen: { name: string }[] = [];
  const Marker = (props: { route: SendTarget | SettingsTarget }) => {
    seen.push(props.route);
    return <p>at:{props.route.name}</p>;
  };
  const table = {
    'home.main': Home,
    send: Marker,
    'settings.main': Marker,
  } as RouteTable<HomeRoute | SendTarget | SettingsTarget>;
  const { host } = render(
    <ClientProvider client={client}>
      <HomeEnvProvider env={env}>
        <Router<HomeRoute | SendTarget | SettingsTarget> table={table} initial={route} />
      </HomeEnvProvider>
    </ClientProvider>,
  );
  const tick = async () => {
    // Effects flush per `act`, and each stage (load, render, effect, call) needs another one.
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  };
  const fire = (ms: number) => {
    void act(() => {
      for (const t of timers.filter((x) => x.live && x.ms === ms)) {
        t.fn();
        if (t.once) t.live = false;
      }
    });
  };
  const releaseAll = () => {
    for (const release of releases) release();
  };
  return { host, hold, releaseAll, w, calls, style, written, timers, tick, fire, seen };
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

describe('arrival from the add-a-token link', () => {
  it('opens on the chosen token and shows the toast until it expires', async () => {
    const s = setup({}, { name: 'home.main', denom: PAGE.denom, toast: 'PAGE added' });
    await s.tick();
    expect(text(s.host)).toContain('PAGE');
    expect(
      s.calls.some(
        (c) => c.method === 'tokens.balances' && (c.req as { denom: string }).denom === 'ubze',
      ),
    ).toBe(false);
    expect(text(s.host)).toContain('PAGE added');
    s.fire(1800);
    expect(text(s.host)).not.toContain('PAGE added');
  });

  it('starts the toast timer only once the screen is showing', async () => {
    const s = setup({}, { name: 'home.main', denom: PAGE.denom, toast: 'PAGE added' }, [
      'tokens.preferred',
    ]);
    await s.tick();
    s.fire(1800);
    s.releaseAll();
    await s.tick();
    expect(text(s.host)).toContain('PAGE added');
    s.fire(1800);
    expect(text(s.host)).not.toContain('PAGE added');
  });

  it('falls back to the first token when the chosen one is not in the list', async () => {
    const s = setup({}, { name: 'home.main', denom: 'factory/bze1x/gone' });
    await s.tick();
    expect(
      s.calls.some(
        (c) => c.method === 'tokens.balances' && (c.req as { denom: string }).denom === 'ubze',
      ),
    ).toBe(true);
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
    expect(text(s.host)).toContain('Address copied');
    expect(byLabel(s.host, 'Copy address Main')?.classList.contains('bp-copy-done')).toBe(true);
    s.fire(1800);
    expect(text(s.host)).not.toContain('Address copied');
    expect(byLabel(s.host, 'Copy address Main')?.classList.contains('bp-copy-done')).toBe(false);
  });

  it('opens Send from the tapped address', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Send BZE from Main'));
    expect(s.seen).toEqual([{ name: 'send', denom: 'ubze', fromIndex: 0 }]);
  });

  it('opens Send without a preset from the total card', async () => {
    const s = setup();
    await s.tick();
    click([...s.host.querySelectorAll('button')].find((b) => b.textContent === 'Send BZE') ?? null);
    expect(s.seen).toEqual([{ name: 'send', denom: 'ubze' }]);
  });

  it('previews the next address without storing it, then adds exactly that one', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Add address'));
    await s.tick();
    const dialog = () => s.host.querySelector('[role="dialog"]');
    expect(s.calls.some((c) => c.method === 'wallet.previewNext')).toBe(true);
    expect(s.calls.some((c) => c.method === 'wallet.deriveNext')).toBe(false);
    expect(s.w.addresses).toHaveLength(2);
    expect(dialog()?.textContent).toContain("It's address #3 in this wallet.");
    expect(dialog()?.textContent).toContain(addr(2, '').address);
    const input = dialog()?.querySelector<HTMLInputElement>('input');
    if (input) input.value = 'x7-cold';
    fireEvent(input, 'input');
    fireEvent(dialog()?.querySelector('form'), 'submit');
    await s.tick();
    expect(s.calls.filter((c) => c.method === 'wallet.deriveNext').map((c) => c.req)).toEqual([
      { index: 2, label: 'x7-cold' },
    ]);
    expect(s.w.addresses[2]).toEqual(addr(2, 'x7-cold'));
    expect(dialog()).toBeNull();
    // The new address is empty, so it folds away behind the ghost button.
    expect(text(s.host)).toContain('Show 2 empty addresses');
  });

  it('adds without a label, and closes on Cancel without storing anything', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Add address'));
    await s.tick();
    click(
      [...(s.host.querySelector('[role="dialog"]')?.querySelectorAll('button') ?? [])].find(
        (b) => b.textContent === 'Cancel',
      ) ?? null,
    );
    expect(s.host.querySelector('[role="dialog"]')).toBeNull();
    expect(s.calls.some((c) => c.method === 'wallet.deriveNext')).toBe(false);
    click(byLabel(s.host, 'Add address'));
    await s.tick();
    fireEvent(s.host.querySelector('[role="dialog"] form'), 'submit');
    await s.tick();
    expect(s.calls.filter((c) => c.method === 'wallet.deriveNext').map((c) => c.req)).toEqual([
      { index: 2 },
    ]);
  });

  it('shows the new next address when another one was added meanwhile', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Add address'));
    await s.tick();
    // Another popup adds address #3 first.
    s.w.addresses = [...s.w.addresses, addr(2, 'Elsewhere')];
    fireEvent(s.host.querySelector('[role="dialog"] form'), 'submit');
    await s.tick();
    const dialog = s.host.querySelector('[role="dialog"]');
    // Not an error: the sheet says why the address changed and offers the new next one.
    expect(dialog?.querySelector('[role="alert"]')).toBeNull();
    expect(dialog?.textContent).not.toContain('Could not add the address');
    expect(dialog?.querySelector('[role="status"]')?.textContent).toBe(
      'Another address was added meanwhile. This is the next one.',
    );
    expect(dialog?.textContent).toContain("It's address #4 in this wallet.");
    expect(s.w.addresses).toHaveLength(3);
    // Adding now stores the new next address.
    fireEvent(dialog?.querySelector('form'), 'submit');
    await s.tick();
    expect(s.w.addresses).toHaveLength(4);
    expect(s.host.querySelector('[role="dialog"]')).toBeNull();
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
  it('shows the token title instead of the switcher with exactly one preferred token', async () => {
    const one = setup({ tokens: [BZE] });
    await one.tick();
    expect(byLabel(one.host, 'Switch token, current BZE')).toBeNull();
    expect(one.host.querySelector('.bp-token-title')?.textContent).toContain('BZE wallet');
    cleanup();
    const two = setup();
    await two.tick();
    expect(byLabel(two.host, 'Switch token, current BZE')).not.toBeNull();
  });

  it('shows the testnet pill, the appearance and settings buttons, and no lock button', async () => {
    const s = setup({ network: 'testnet' });
    await s.tick();
    expect(text(s.host)).toContain('Testnet');
    expect(byLabel(s.host, 'Switch to light mode')).not.toBeNull();
    expect(byLabel(s.host, 'Lock wallet')).toBeNull();
    click(byLabel(s.host, 'Settings'));
    expect(s.seen).toEqual([{ name: 'settings.main' }]);
  });
});

describe('token switcher', () => {
  const open = async (s: ReturnType<typeof setup>) => {
    await s.tick();
    click(byLabel(s.host, 'Switch token, current BZE'));
    await s.tick();
  };
  const dialog = (s: ReturnType<typeof setup>) => s.host.querySelector('[role="dialog"]');
  const groups = (s: ReturnType<typeof setup>) =>
    [...(dialog(s)?.querySelectorAll('section') ?? [])].map((g) => ({
      title: g.querySelector('h3')?.textContent,
      rows: [...g.querySelectorAll('.bp-list-row-title')].map((r) => r.textContent),
    }));

  it('lists preferred tokens with balances and switches', async () => {
    const s = setup();
    await open(s);
    expect(dialog(s)?.textContent).toContain('1,234.56789');
    expect(dialog(s)?.textContent).toContain('12.00');
    click(dialog(s)?.querySelector('[aria-label="PAGE"]') ?? null);
    await s.tick();
    expect(s.host.querySelector('[role="dialog"]')).toBeNull();
    expect(text(s.host)).toContain('12.00');
  });

  it('groups preferred tokens and the other held tokens; empty ones stay out', async () => {
    const gold = tok('factory/bze1x/gold', 'GOLD');
    const dust = tok('factory/bze1x/dust', 'DUST');
    const s = setup({
      held: [BZE, gold, dust],
      amounts: {
        ubze: ['1234567890', '0'],
        [PAGE.denom]: ['500', '700'],
        [gold.denom]: ['3000000', '0'],
        [dust.denom]: ['0', '0'],
      },
    });
    await open(s);
    expect(groups(s)).toEqual([
      { title: 'Preferred · 2', rows: ['BZE', 'PAGE'] },
      { title: 'You hold · 1', rows: ['GOLD'] },
    ]);
    expect(byLabel(s.host, 'Remove BZE from preferred')?.getAttribute('aria-pressed')).toBe('true');
    // A held token is starred, not opened.
    expect(dialog(s)?.querySelector('[aria-label="GOLD"]')).toBeNull();
    click(byLabel(s.host, 'Add GOLD to preferred'));
    await s.tick();
    expect(s.calls.filter((c) => c.method === 'tokens.add').map((c) => c.req)).toEqual([
      { denom: gold.denom },
    ]);
    expect(groups(s)[0]).toEqual({ title: 'Preferred · 3', rows: ['BZE', 'PAGE', 'GOLD'] });
  });

  it('filters by symbol or name into one Results group', async () => {
    const s = setup({ search: [] });
    await open(s);
    const input = dialog(s)?.querySelector<HTMLInputElement>('input');
    if (input) input.value = 'pag';
    fireEvent(input, 'input');
    await s.tick();
    expect(groups(s)).toEqual([{ title: 'Results · 1', rows: ['PAGE'] }]);
    expect(s.calls.some((c) => c.method === 'tokens.lookup')).toBe(false);
  });

  it('searches and adds a token', async () => {
    const extra = tok('factory/bze1x/gold', 'GOLD');
    const s = setup({ search: [extra] });
    await open(s);
    const input = s.host.querySelector<HTMLInputElement>('[role="dialog"] input');
    if (input) input.value = 'gol';
    fireEvent(input, 'input');
    await s.tick();
    click(byLabel(s.host, 'Add GOLD to preferred'));
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
    expect(byLabel(s.host, 'Add GOLD to preferred')).not.toBeNull();
    s.w.lookup = fail(TokenErrorCodes.noSuchToken, 'none');
    if (input) input.value = 'factory/bze1x/none';
    fireEvent(input, 'input');
    await s.tick();
    expect(text(s.host)).toContain('No token with this code on BeeZee');
  });

  it('un-stars a token but never the last preferred one, and says why', async () => {
    const s = setup();
    await open(s);
    click(byLabel(s.host, 'Remove PAGE from preferred'));
    await s.tick();
    expect(s.w.tokens).toEqual([BZE]);
    expect(byLabel(s.host, 'Remove BZE from preferred')).toBeNull();
    const star = byLabel(s.host, 'Keep at least one preferred token');
    expect(star?.hasAttribute('disabled')).toBe(true);
    click(star);
    await s.tick();
    expect(s.calls.filter((c) => c.method === 'tokens.remove')).toHaveLength(1);
  });
});

describe('theme', () => {
  it('applies the token kit on change and the BeePocket look when brand themes are off', async () => {
    const s = setup();
    await s.tick();
    const bzeVars = s.style.get('--bp-primary');
    await s.tick();
    click(byLabel(s.host, 'Switch token, current BZE'));
    await s.tick();
    click(s.host.querySelector('[role="dialog"] [aria-label="PAGE"]'));
    await s.tick();
    await s.tick();
    expect(s.style.get('--bp-primary')).not.toBe(bzeVars);

    cleanup();
    const off = setup({ brandThemes: false, tokens: [PAGE, BZE] });
    await off.tick();
    expect(off.style.get('--bp-primary')).not.toBe(s.style.get('--bp-primary'));
    // The avatar keeps the token's own colour either way.
    expect(off.host.querySelector<HTMLElement>('.bp-token-pill .bp-avatar')?.style.background).toBe(
      'rgb(255, 176, 0)',
    );
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

describe('unreadable addresses', () => {
  it('shows "unavailable" instead of zero when every read failed', async () => {
    const s = setup({ failed: [0, 1] });
    await s.tick();
    expect(text(s.host)).toContain('Balance unavailable right now.');
    expect(text(s.host)).not.toContain('No BZE yet');
    expect(text(s.host)).not.toContain('in none of');
  });

  it('counts only the readable addresses and warns when some failed', async () => {
    const s = setup({
      addresses: [addr(0, 'Main'), addr(1, 'Two'), addr(2, 'Three')],
      amounts: { ubze: ['5', '7', '9'] },
      failed: [2],
    });
    await s.tick();
    expect(text(s.host)).toContain('across 2 addresses');
    expect(text(s.host)).toContain('Some addresses could not be read');
    expect(text(s.host)).toContain('Unavailable');
  });
});

describe('races and guards', () => {
  it('adds the address once a slow add answers, then closes the sheet', async () => {
    const s = setup();
    await s.tick();
    const release = s.hold('wallet.deriveNext');
    click(byLabel(s.host, 'Add address'));
    await s.tick();
    fireEvent(s.host.querySelector('[role="dialog"] form'), 'submit');
    await s.tick();
    // Still waiting: the sheet stays open and nothing is listed yet.
    expect(s.host.querySelector('[role="dialog"]')).not.toBeNull();
    expect(text(s.host)).toContain('Show 1 empty address');
    release();
    await s.tick();
    expect(s.w.addresses).toHaveLength(3);
    expect(s.host.querySelector('[role="dialog"]')).toBeNull();
    expect(text(s.host)).toContain('Show 2 empty addresses');
  });

  it('stores once on a double tap of Add address', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Add address'));
    await s.tick();
    const release = s.hold('wallet.deriveNext');
    const form = s.host.querySelector('[role="dialog"] form');
    fireEvent(form, 'submit');
    fireEvent(form, 'submit');
    await s.tick();
    const add = [...(form?.querySelectorAll('button') ?? [])].find(
      (b) => b.textContent === 'Add address',
    );
    expect(add?.hasAttribute('disabled')).toBe(true);
    release();
    await s.tick();
    expect(s.calls.filter((c) => c.method === 'wallet.deriveNext')).toHaveLength(1);
  });

  it('re-arms the Copied toast on a second copy', async () => {
    const s = setup();
    await s.tick();
    click(byLabel(s.host, 'Copy address Main'));
    await s.tick();
    s.fire(1800);
    click(byLabel(s.host, 'Copy address Main'));
    await s.tick();
    expect(text(s.host)).toContain('Address copied');
  });

  it('does not poll again while a read is in flight', async () => {
    const s = setup();
    await s.tick();
    const release = s.hold('tokens.balances');
    s.fire(15_000);
    s.fire(15_000);
    await s.tick();
    expect(balanceCalls(s.calls)).toBe(2);
    release();
    await s.tick();
  });

  it('hands tabs a refresh that reads the balances again', async () => {
    let refresh: (() => Promise<void>) | undefined;
    registerHomeTab({
      id: 'probe2',
      label: 'Probe2',
      render: (ctx) => {
        refresh = ctx.refresh;
        return <p>probe2</p>;
      },
    });
    const s = setup();
    await s.tick();
    click(
      [...s.host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Probe2') ?? null,
    );
    const before = balanceCalls(s.calls);
    await act(async () => {
      await refresh?.();
    });
    expect(balanceCalls(s.calls)).toBe(before + 1);
  });
});
