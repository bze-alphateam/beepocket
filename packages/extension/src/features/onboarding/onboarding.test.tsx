import type { Random } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../i18n';
import { Router } from '../../popup/router';
import { ClientProvider } from '../../popup/client-context';
import { fail, ok, type Method, type RequestOf, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { onboardingRoutes, RandomProvider, type OnboardingRoute } from '.';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PHRASE = Array.from({ length: 24 }, (_, i) => `term${String.fromCharCode(97 + i)}`).join(' ');
const PHRASE_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const GOLD = {
  denom: 'factory/bze1x/gold',
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

type Handler = (req: never) => Result<unknown> | Promise<Result<unknown>>;

function mockClient(
  handlers: Partial<Record<Method, Handler>>,
): Client & { calls: [string, unknown][] } {
  const calls: [string, unknown][] = [];
  return {
    calls,
    call: ((method: Method, req: RequestOf<Method>) => {
      calls.push([method, req]);
      const h = handlers[method];
      return Promise.resolve(h ? h(req as never) : fail('unknown_method', method));
    }) as Client['call'],
  };
}

/** Counter-driven bytes: deterministic but varied. */
function mockRandom(): Random {
  let n = 7;
  return {
    bytes(len) {
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = n = (n * 31 + 17) % 251;
      return out;
    },
  };
}

function mount(client: Client, route: OnboardingRoute = { name: 'onboarding.welcome' }) {
  const seen: unknown[] = [];
  const table = {
    ...onboardingRoutes,
    'shell.home': ({ route: r }: { route: { name: 'shell.home' } }) => {
      seen.push(r);
      return <p>home</p>;
    },
  };
  const view = render(
    <ClientProvider client={client}>
      <RandomProvider random={mockRandom()}>
        <Router table={table} initial={route} />
      </RandomProvider>
    </ClientProvider>,
  );
  return { ...view, seen };
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent.includes(text));

async function click(host: HTMLElement, text: string) {
  const b = button(host, text);
  if (!b) throw new Error(`no button ${text}`);
  fireEvent(b, 'click');
  await flush();
}

function type(el: Element | null | undefined, value: string) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))
    throw new Error('no field');
  el.value = value;
  fireEvent(el, 'input');
}

const field = (host: HTMLElement, label: string) => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === label);
  return l ? host.querySelector(`#${l.getAttribute('for') ?? l.htmlFor}`) : null;
};

const baseHandlers = {
  'wallet.generateMnemonic': () => ok({ mnemonic: PHRASE }),
  'tokens.preferred': () => ok([]),
  'wallet.createWallet': () => ok({ addresses: [] }),
  'wallet.importWallet': () => ok({ addresses: [] }),
  'tokens.add': ({ denom }: { denom: string }) => ok([{ ...BZE, denom }]),
  'tokens.search': () => ok([BZE, GOLD]),
  'tokens.lookup': ({ code }: { code: string }) =>
    code === GOLD.denom
      ? ok(GOLD)
      : code === 'bad code'
        ? fail('invalid-code', 'x')
        : fail('no-such-token', 'x'),
} as Partial<Record<Method, Handler>>;

async function toPassword(host: HTMLElement) {
  await click(host, 'Create a new wallet');
  await click(host, 'Reveal phrase');
  fireEvent(host.querySelector('input[type="checkbox"]'), 'click');
  await click(host, 'Continue');
}

function answerQuiz(host: HTMLElement, correct: boolean) {
  const words = PHRASE.split(' ');
  for (const q of host.querySelectorAll('fieldset')) {
    const n = Number(/#(\d+)/.exec(q.querySelector('legend')?.textContent ?? '')?.[1]);
    const right = words[n - 1];
    const opts = [...q.querySelectorAll('button')];
    const pick = correct
      ? opts.find((o) => o.textContent === right)
      : opts.find((o) => o.textContent !== right);
    fireEvent(pick, 'click');
  }
}

describe('create flow', () => {
  it('shows the generated phrase, asks 3 positions and rejects a wrong pick', async () => {
    const client = mockClient(baseHandlers);
    const { host } = mount(client);
    expect(host.textContent).toContain(en['onboarding.welcome.create']);
    await toPassword(host);
    // back on the confirm step
    expect(host.querySelectorAll('fieldset')).toHaveLength(3);
    for (const q of host.querySelectorAll('fieldset')) {
      expect(q.querySelectorAll('button')).toHaveLength(3);
    }
    answerQuiz(host, false);
    await click(host, 'Continue');
    expect(host.textContent).toContain(en['onboarding.confirm.wrong']);
    expect(host.textContent).toContain(en['onboarding.confirm.title']);
    answerQuiz(host, true);
    await click(host, 'Continue');
    expect(host.textContent).toContain(en['onboarding.password.title']);
  });

  it('needs the phrase revealed and acknowledged before continuing', async () => {
    const { host } = mount(mockClient(baseHandlers));
    await click(host, 'Create a new wallet');
    // The words are not in the page at all until revealed.
    for (const w of PHRASE.split(' ')) expect(host.textContent).not.toContain(w);
    expect(button(host, 'Continue')?.disabled).toBe(true);
    await click(host, 'Reveal phrase');
    expect(host.textContent).toContain(PHRASE.split(' ')[0]);
    expect(button(host, 'Continue')?.disabled).toBe(true);
    fireEvent(host.querySelector('input[type="checkbox"]'), 'click');
    expect(button(host, 'Continue')?.disabled).toBe(false);
  });

  it('enforces password rules, calls createWallet and lands on the token step', async () => {
    const client = mockClient(baseHandlers);
    const { host } = mount(client);
    await toPassword(host);
    answerQuiz(host, true);
    await click(host, 'Continue');

    const pw = field(host, en['onboarding.password.label']);
    const rp = field(host, en['onboarding.password.repeat']);
    type(pw, 'short');
    expect(host.textContent).toContain('at least 8 characters');
    expect(button(host, 'Continue')?.disabled).toBe(true);
    type(pw, 'longenough1');
    type(rp, 'different1');
    expect(host.textContent).toContain(en['onboarding.password.mismatch']);
    expect(button(host, 'Continue')?.disabled).toBe(true);
    type(rp, 'longenough1');
    expect(host.textContent).toContain(en['onboarding.password.match']);
    expect(host.textContent).toContain('Fair');
    type(pw, 'Longer-password-1!');
    type(rp, 'Longer-password-1!');
    expect(host.textContent).toContain('Strong');

    const form = host.querySelector('form');
    fireEvent(form, 'submit');
    await flush();
    expect(client.calls.find(([m]) => m === 'wallet.createWallet')?.[1]).toEqual({
      password: 'Longer-password-1!',
      mnemonic: PHRASE,
    });
    expect(host.textContent).toContain(en['onboarding.start.title']);
  });

  it('keeps the form disabled with a spinner while the wallet is made', async () => {
    let release: (r: Result<unknown>) => void = () => undefined;
    const client = mockClient({
      ...baseHandlers,
      'wallet.createWallet': () => new Promise((r) => (release = r)),
    });
    const { host } = mount(client);
    await toPassword(host);
    answerQuiz(host, true);
    await click(host, 'Continue');
    type(field(host, en['onboarding.password.label']), 'longenough1');
    type(field(host, en['onboarding.password.repeat']), 'longenough1');
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(host.querySelector('input')?.disabled).toBe(true);
    release(ok({ addresses: [] }));
    await flush();
    expect(host.textContent).toContain(en['onboarding.start.title']);
  });
});

describe('import entry route', () => {
  it('opens straight on the import step', () => {
    const { host } = mount(mockClient(baseHandlers), { name: 'onboarding.import' });
    expect(host.textContent).toContain(en['onboarding.import.title']);
  });
});

describe('import flow', () => {
  async function toImport(client: Client) {
    const view = mount(client);
    await click(view.host, 'Import a recovery phrase');
    return view;
  }

  it.each([
    ['12', PHRASE_12, 12],
    ['24', PHRASE, 24],
  ])('accepts %s words, normalising whitespace and case', async (_, words, count) => {
    const client = mockClient(baseHandlers);
    const { host } = await toImport(client);
    expect(button(host, 'Continue')?.disabled).toBe(true);
    type(host.querySelector('textarea'), `  ${words.toUpperCase().replaceAll(' ', '\n ')}  `);
    expect(host.textContent).toContain(`${String(count)} words`);
    await click(host, 'Continue');
    type(field(host, en['onboarding.password.label']), 'longenough1');
    type(field(host, en['onboarding.password.repeat']), 'longenough1');
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(client.calls.find(([m]) => m === 'wallet.importWallet')?.[1]).toEqual({
      password: 'longenough1',
      mnemonic: words,
    });
  });

  it('blocks other word counts', async () => {
    const { host } = await toImport(mockClient(baseHandlers));
    type(host.querySelector('textarea'), 'one two three');
    expect(host.textContent).toContain('a phrase has 12 or 24');
    expect(button(host, 'Continue')?.disabled).toBe(true);
  });

  it('returns to the phrase with an inline error when the service refuses it', async () => {
    const client = mockClient({
      ...baseHandlers,
      'wallet.importWallet': () => fail('invalid_mnemonic', 'This recovery phrase is not valid.'),
    });
    const { host } = await toImport(client);
    type(host.querySelector('textarea'), PHRASE_12);
    await click(host, 'Continue');
    type(field(host, en['onboarding.password.label']), 'longenough1');
    type(field(host, en['onboarding.password.repeat']), 'longenough1');
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(host.textContent).toContain(en['onboarding.import.invalid']);
    expect(host.querySelector('textarea')?.value).toBe(PHRASE_12);
  });
});

async function createdWallet(client: Client, route?: OnboardingRoute) {
  const view = mount(client, route);
  await toPassword(view.host);
  answerQuiz(view.host, true);
  await click(view.host, 'Continue');
  type(field(view.host, en['onboarding.password.label']), 'longenough1');
  type(field(view.host, en['onboarding.password.repeat']), 'longenough1');
  fireEvent(view.host.querySelector('form'), 'submit');
  await flush();
  return view;
}

describe('start with a token code', () => {
  async function look(host: HTMLElement, code: string) {
    await click(host, en['onboarding.start.haveCode']);
    type(field(host, en['onboarding.start.codeLabel']), code);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
  }

  it('shows a found token in its brand colours and opens the wallet on it', async () => {
    const client = mockClient(baseHandlers);
    const { host, seen } = await createdWallet(client);
    await look(host, GOLD.denom);
    const card = host.querySelector<HTMLElement>('.ob-token');
    expect(card?.textContent).toContain('GOLD');
    expect(card?.textContent).toContain('Gold Coin');
    expect(card?.getAttribute('style')).toContain('--bp-primary');
    await click(host, 'Open wallet with GOLD');
    expect(client.calls.filter(([m]) => m === 'tokens.add')).toEqual([
      ['tokens.add', { denom: GOLD.denom }],
    ]);
    expect(seen).toEqual([{ name: 'shell.home' }]);
  });

  it('says so when no token has the code', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers));
    await look(host, 'factory/bze1x/ghost');
    expect(host.textContent).toContain('No token with this code on BeeZee');
    expect(button(host, 'Open wallet')).toBeUndefined();
  });

  it('shows a syntax error for an invalid code', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers));
    await look(host, 'bad code');
    expect(host.textContent).toContain(en['onboarding.start.invalid']);
  });

  it('pre-fills and looks up the code of a link', async () => {
    const client = mockClient(baseHandlers);
    const { host } = await createdWallet(client, {
      name: 'onboarding.welcome',
      prefillCode: GOLD.denom,
    });
    expect((field(host, en['onboarding.start.codeLabel']) as HTMLInputElement).value).toBe(
      GOLD.denom,
    );
    expect(client.calls).toContainEqual(['tokens.lookup', { code: GOLD.denom }]);
    expect(host.textContent).toContain(en['onboarding.start.prefilled']);
    expect(button(host, 'Open wallet with GOLD')).toBeDefined();
  });
});

describe('retries and navigation', () => {
  it('offers a proper retry when the phrase cannot be made', async () => {
    let fails = true;
    const client = mockClient({
      ...baseHandlers,
      'wallet.generateMnemonic': () => (fails ? fail('internal', 'x') : ok({ mnemonic: PHRASE })),
    });
    const { host } = mount(client);
    await click(host, 'Create a new wallet');
    expect(button(host, en['onboarding.start.lookup'])).toBeUndefined();
    fails = false;
    await click(host, en['onboarding.phrase.retry']);
    expect(host.textContent).toContain(en['onboarding.phrase.reveal']);
  });

  it('drops the phrase when going back to the welcome screen', async () => {
    const client = mockClient(baseHandlers);
    const { host } = mount(client);
    await click(host, 'Create a new wallet');
    await click(host, 'Reveal phrase');
    fireEvent(host.querySelector('.ob-back'), 'click');
    expect(host.textContent).not.toContain(PHRASE.split(' ')[0]);
    await click(host, 'Create a new wallet');
    expect(client.calls.filter(([m]) => m === 'wallet.generateMnemonic')).toHaveLength(2);
  });

  it('has no back button on the start step', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers));
    expect(host.querySelector('.ob-back')).toBeNull();
  });

  it('a retry after a partial add only adds what is missing', async () => {
    let preferred: unknown[] = [];
    let failGold = true;
    const client = mockClient({
      ...baseHandlers,
      'tokens.preferred': () => ok(preferred),
      'tokens.add': ({ denom }: { denom: string }) => {
        if (denom === GOLD.denom && failGold) return fail('internal', 'x');
        preferred = [...preferred, { ...BZE, denom }];
        return ok(preferred);
      },
    });
    const { host, seen } = await createdWallet(client);
    await click(host, en['onboarding.start.choose']);
    await flush();
    const boxes = host.querySelectorAll('input[type="checkbox"]');
    fireEvent(boxes[0], 'click'); // BZE
    fireEvent(boxes[1], 'click'); // GOLD
    await click(host, 'Finish');
    expect(seen).toEqual([]);
    expect(host.textContent).toContain(en['app.error.generic']);
    failGold = false;
    await click(host, 'Finish');
    const adds = client.calls.filter(([m]) => m === 'tokens.add').map(([, r]) => r);
    expect(adds).toEqual(
      [{ denom: 'ubze' }, { denom: GOLD.denom }, { denom: GOLD.denom }].slice(0, 3),
    );
    expect(seen).toEqual([{ name: 'shell.home' }]);
  });
});

describe('pick tokens', () => {
  async function toPick(client: Client) {
    const view = await createdWallet(client);
    await click(view.host, en['onboarding.start.choose']);
    await flush();
    return view;
  }

  it('lists, searches, selects (BZE optional) and adds in order', async () => {
    const search = vi.fn(({ query }: { query: string }) =>
      ok([BZE, GOLD].filter((t) => t.symbol.toLowerCase().includes(query.toLowerCase()))),
    );
    const client = mockClient({ ...baseHandlers, 'tokens.search': search });
    const { host, seen } = await toPick(client);
    expect(host.querySelectorAll('.ob-row')).toHaveLength(2);
    expect(button(host, 'Finish')?.disabled).toBe(true);

    type(field(host, en['onboarding.tokens.search']), 'gol');
    await flush();
    expect(search).toHaveBeenLastCalledWith({ query: 'gol' });
    expect(host.querySelectorAll('.ob-row')).toHaveLength(1);

    fireEvent(host.querySelector('input[type="checkbox"]'), 'click');
    expect(host.textContent).toContain(en['onboarding.tokens.selectedOne']);
    expect(button(host, 'Finish')?.disabled).toBe(false);

    type(field(host, en['onboarding.tokens.search']), '');
    await flush();
    const boxes = host.querySelectorAll('input[type="checkbox"]');
    fireEvent(boxes[0], 'click'); // BZE after GOLD
    expect(host.textContent).toContain('2 selected');
    await click(host, 'Finish');
    expect(client.calls.filter(([m]) => m === 'tokens.add').map(([, r]) => r)).toEqual([
      { denom: GOLD.denom },
      { denom: 'ubze' },
    ]);
    expect(seen).toEqual([{ name: 'shell.home' }]);
  });

  it('can leave BZE out and unselect', async () => {
    const client = mockClient(baseHandlers);
    const { host } = await toPick(client);
    const boxes = host.querySelectorAll('input[type="checkbox"]');
    fireEvent(boxes[1], 'click');
    fireEvent(boxes[1], 'click');
    expect(button(host, 'Finish')?.disabled).toBe(true);
    fireEvent(boxes[1], 'click');
    await click(host, 'Finish');
    expect(client.calls.filter(([m]) => m === 'tokens.add')).toHaveLength(1);
  });
});

describe('secrets and themes', () => {
  it('never writes the phrase to storage, the URL or the console', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log');
    const chromeStorage = { local: { set: vi.fn() }, session: { set: vi.fn() } };
    vi.stubGlobal('chrome', { storage: chromeStorage });
    const before = location.href;
    await createdWallet(mockClient(baseHandlers));
    expect(setItem).not.toHaveBeenCalled();
    expect(chromeStorage.local.set).not.toHaveBeenCalled();
    expect(chromeStorage.session.set).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(location.href).toBe(before);
    expect(document.body.textContent).not.toContain(PHRASE);
    vi.unstubAllGlobals();
  });

  it.each(['dark', 'light'] as const)('renders the token card with the %s kit', async (scheme) => {
    document.documentElement.dataset.scheme = scheme;
    const { host } = await createdWallet(mockClient(baseHandlers));
    await click(host, en['onboarding.start.haveCode']);
    type(field(host, en['onboarding.start.codeLabel']), GOLD.denom);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    const style = host.querySelector<HTMLElement>('.ob-token')?.getAttribute('style') ?? '';
    expect(style.toLowerCase()).toContain(scheme === 'dark' ? '#ffb000' : '#7a4f00');
    delete document.documentElement.dataset.scheme;
  });
});
