import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../i18n';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import {
  fail,
  ok,
  TokenErrorCodes,
  type AddTokenView,
  type Method,
  type RequestOf,
  type Result,
  type WalletState,
} from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { HomeEnvProvider, type HomeEnv } from '../home/env';
import { LockEnvProvider } from '../lock/env';
import { AddTokenScreen } from './AddTokenScreen';

afterEach(cleanup);

const GOLD = {
  denom: 'factory/bze1abcdefghijklmnopqrstuvwxyz0123456789/gold',
  symbol: 'GOLD',
  name: 'Gold Coin',
  decimals: 6,
  kind: 'factory',
  source: 'chain',
  branding: {
    font: 'inter',
    light: { background: '#FFFFFF', text: '#111111', primary: '#7A4F00', secondary: '#888888' },
    dark: { background: '#000000', text: '#EEEEEE', primary: '#FFB000', secondary: '#777777' },
  },
} as const;
const BZE = {
  ...GOLD,
  denom: 'ubze',
  symbol: 'BZE',
  name: 'BeeZee',
  kind: 'native',
  branding: null,
};

const link = (patch: Partial<Extract<AddTokenView, { status: 'link' }>> = {}): AddTokenView => ({
  status: 'link',
  source: 'link',
  code: GOLD.denom,
  host: 'dex.getbze.com',
  known: true,
  ...patch,
});

type Handler = (req: never) => Result<unknown>;

function rig(
  view: AddTokenView,
  handlers: Partial<Record<Method, Handler>> = {},
  state: WalletState = 'unlocked',
) {
  const calls: [string, unknown][] = [];
  const base: Partial<Record<Method, Handler>> = {
    'addtoken.current': () => ok(view),
    'addtoken.clear': () => ok({}),
    'wallet.state': () => ok({ state, retryAt: null }),
    'tokens.lookup': () => ok(GOLD),
    'tokens.preferred': () => ok([BZE]),
    'tokens.add': () => ok([BZE, GOLD]),
    'home.context': () => ok({ network: 'mainnet', brandThemes: true }),
    ...handlers,
  };
  const client = {
    call: (method: Method, req: RequestOf<Method>) => {
      calls.push([method, req]);
      const handler = base[method];
      return Promise.resolve(handler ? handler(req as never) : fail('unexpected', method));
    },
  } as unknown as Client;
  const applied: Record<string, string> = {};
  const copied: string[] = [];
  const env = {
    scheduler: { every: () => () => undefined, after: () => () => undefined },
    themeTarget: {
      style: {
        setProperty: (name: string, value: string) => {
          applied[name] = value;
        },
      },
      dataset: {},
    },
    scheme: { current: () => 'dark', subscribe: () => () => undefined },
    clipboard: {
      writeText: (text: string) => {
        copied.push(text);
        return Promise.resolve();
      },
    },
  } as unknown as HomeEnv;
  const close = vi.fn();
  const seen: { name: string }[] = [];
  const stub =
    (name: string) =>
    ({ route }: { route: { name: string } }) => {
      seen.push(route);
      return <p>{name}</p>;
    };
  const { host } = render(
    <ClientProvider client={client}>
      <LockEnvProvider
        clock={{ now: () => 0, sleep: () => Promise.resolve() }}
        events={{ subscribe: () => () => undefined }}
      >
        <HomeEnvProvider env={env}>
          <Router
            table={{
              'addtoken.main': () => <AddTokenScreen close={close} />,
              'home.main': stub('home'),
              'onboarding.welcome': stub('onboarding'),
              'lock.root': stub('root'),
            }}
            initial={{ name: 'addtoken.main' }}
          />
        </HomeEnvProvider>
      </LockEnvProvider>
    </ClientProvider>,
  );
  return { host, calls, applied, copied, close, seen };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

async function mounted(...args: Parameters<typeof rig>) {
  const t = rig(...args);
  await settle();
  await settle();
  await settle();
  return t;
}

const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent.startsWith(text));

describe('the Add a token screen', () => {
  it('shows the site, the token and what happens, in the token kit', async () => {
    const t = await mounted(link());
    expect(t.host.textContent).toContain(en['addtoken.title']);
    expect(t.host.querySelector('.bp-site-card-name')?.textContent).toBe('dex.getbze.com');
    expect(t.host.querySelector('.bp-site-card-aside')?.textContent).toBe(en['addtoken.sentYou']);
    expect(t.host.textContent).toContain('GOLD');
    expect(t.host.textContent).toContain('Gold Coin');
    expect(t.host.textContent).toContain(GOLD.denom);
    expect([...t.host.querySelectorAll('.bp-check-list li')].map((li) => li.textContent)).toEqual([
      en['addtoken.list.add'],
      'The wallet switches to GOLD and its colours',
      en['addtoken.list.private'],
    ]);
    expect(t.applied['--bp-primary']).toBe('#FFB000');
    expect(t.host.textContent).not.toContain(en['addtoken.unknown']);
    expect(button(t.host, 'Add GOLD')).toBeDefined();
  });

  it('shows the wallet network in the header pill, also when the lookup fails', async () => {
    const t = await mounted(link(), {
      'home.context': () => ok({ network: 'testnet', brandThemes: true }),
      'tokens.lookup': () => fail(TokenErrorCodes.noSuchToken, 'none'),
    });
    expect(t.host.textContent).toContain(en['addtoken.noSuchToken']);
    expect(t.host.querySelector('.bp-chain-pill')?.textContent).toBe('bzetestnet-3');
    expect(t.host.textContent).not.toContain('beezee-1');
  });

  it('keeps the BeePocket look when brand themes are off', async () => {
    const t = await mounted(link(), {
      'home.context': () => ok({ network: 'mainnet', brandThemes: false }),
    });
    expect(t.applied['--bp-primary']).not.toBe('#FFB000');
  });

  it('copies the full code', async () => {
    const t = await mounted(link());
    fireEvent(t.host.querySelector(`button[aria-label="${en['addtoken.copy']}"]`), 'click');
    await settle();
    expect(t.copied).toEqual([GOLD.denom]);
  });

  it.each([
    ['a site that is not a known one', link({ host: 'evil.example', known: false })],
    ['no referrer at all', link({ host: null, known: false })],
  ])('warns for %s', async (_name, view) => {
    const t = await mounted(view);
    expect(t.host.textContent).toContain(en['addtoken.unknown']);
  });

  it('shows the whole code, not a shortened one', async () => {
    const long = `factory/bze1${'q'.repeat(38)}/${'a'.repeat(40)}`;
    const t = await mounted(link({ code: long }), {
      'tokens.lookup': () => ok({ ...GOLD, denom: long }),
    });
    expect(t.host.textContent).toContain(long);
  });

  it.each([
    [
      'a held token',
      { ...GOLD, symbol: 'Gold' },
      [BZE, { ...GOLD, denom: 'factory/bze1other/gold' }],
    ],
    ['the native coin', { ...GOLD, symbol: 'bze' }, [BZE]],
  ])('warns when the symbol imitates %s', async (_name, found, held) => {
    const t = await mounted(link(), {
      'tokens.lookup': () => ok(found),
      'tokens.preferred': () => ok(held),
    });
    expect(t.host.textContent).toContain('different code');
  });

  it('does not warn about lookalikes for an ordinary token', async () => {
    const t = await mounted(link());
    expect(t.host.textContent).not.toContain('different code');
  });

  it('says "A link" when there is no referrer', async () => {
    const t = await mounted(link({ host: null, known: false }));
    expect(t.host.textContent).toContain(en['addtoken.siteUnknown']);
  });

  it('adds the token, then opens home on it with the toast', async () => {
    const t = await mounted(link());
    fireEvent(button(t.host, 'Add GOLD'), 'click');
    await settle();
    expect(t.calls).toContainEqual(['tokens.add', { denom: GOLD.denom }]);
    expect(t.calls).toContainEqual(['addtoken.clear', {}]);
    expect(t.seen.at(-1)).toEqual({ name: 'home.main', denom: GOLD.denom, toast: 'GOLD added' });
  });

  it('offers Open for a token that is already preferred and only selects it', async () => {
    const t = await mounted(link(), { 'tokens.preferred': () => ok([BZE, GOLD]) });
    expect(button(t.host, 'Add GOLD')).toBeUndefined();
    fireEvent(button(t.host, 'Open GOLD'), 'click');
    await settle();
    expect(t.calls.some(([m]) => m === 'tokens.add')).toBe(false);
    expect(t.seen.at(-1)).toEqual({ name: 'home.main', denom: GOLD.denom });
  });

  it('closes on Cancel and forgets the link', async () => {
    const t = await mounted(link());
    fireEvent(button(t.host, en['addtoken.cancel']), 'click');
    await settle();
    expect(t.calls).toContainEqual(['addtoken.clear', {}]);
    expect(t.close).toHaveBeenCalledTimes(1);
    expect(t.calls.some(([m]) => m === 'tokens.add')).toBe(false);
  });

  it('shows an unknown code with only Close', async () => {
    const t = await mounted(link(), { 'tokens.lookup': () => fail('no-such-token', 'x') });
    expect(t.host.textContent).toContain('No token with this code on BeeZee');
    expect(button(t.host, 'Add')).toBeUndefined();
    expect(button(t.host, en['addtoken.cancel'])).toBeUndefined();
    fireEvent(button(t.host, en['addtoken.close']), 'click');
    await settle();
    expect(t.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the screen and says so when adding fails', async () => {
    const t = await mounted(link(), { 'tokens.add': () => fail('locked', 'x') });
    fireEvent(button(t.host, 'Add GOLD'), 'click');
    await settle();
    expect(t.host.textContent).toContain(en['addtoken.failed']);
    expect(t.seen.some((r) => r.name === 'home.main')).toBe(false);
  });

  it('asks for the password first when the wallet is fully locked', async () => {
    const t = await mounted(link(), {}, 'locked');
    expect(t.host.textContent).toContain(en['addtoken.locked']);
    expect(t.host.textContent).not.toContain(en['addtoken.title']);
  });

  it('works directly with the weak lock', async () => {
    const t = await mounted(link(), {}, 'weakLocked');
    expect(button(t.host, 'Add GOLD')).toBeDefined();
  });

  it('hands over to onboarding when no wallet exists yet', async () => {
    const t = await mounted(link({ host: 'evil.example', known: false }), {}, 'uninitialised');
    expect(t.seen.at(-1)).toEqual({
      name: 'onboarding.welcome',
      prefillCode: GOLD.denom,
      link: { host: 'evil.example', known: false },
    });
  });

  it('opens onboarding for a link found at install, whatever the wallet says', async () => {
    const t = await mounted(link({ source: 'install', host: 'getbze.com', known: false }));
    expect(t.seen.at(-1)).toMatchObject({
      name: 'onboarding.welcome',
      prefillCode: GOLD.denom,
      link: { host: 'getbze.com', known: false },
    });
  });

  it('falls back to the normal wallet when no link waits', async () => {
    const t = await mounted({ status: 'none' });
    expect(t.seen.at(-1)).toEqual({ name: 'lock.root' });
  });
});
