import type { Random } from '@beepocket/core';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../i18n';
import { AppearanceProvider } from '../../popup/appearance';
import { Router } from '../../popup/router';
import { AppearanceState, type Scheme } from '../../theme';
import { readPermittedClipboard, type ClipboardPermissions } from '../../popup/clipboard';
import { ClientProvider } from '../../popup/client-context';
import { fail, ok, type Method, type RequestOf, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import {
  onboardingRoutes,
  OnboardingEnvProvider,
  RandomProvider,
  type OnboardingEnv,
  type OnboardingRoute,
} from '.';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const PHRASE = Array.from({ length: 24 }, (_, i) => `term${String.fromCharCode(97 + i)}`).join(' ');
const PHRASE_12 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
/** A real 24-word phrase (the BIP-39 vector of all-zero entropy). */
const PHRASE_24 = `${'abandon '.repeat(23)}art`;
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

/** With `permissions`, Paste goes through the real `clipboardRead` check, as in the browser. */
function mockEnv(
  clipboard = '',
  permissions?: ClipboardPermissions,
): OnboardingEnv & {
  readText: ReturnType<typeof vi.fn>;
  writeText: ReturnType<typeof vi.fn>;
} {
  const readText = vi.fn(() => Promise.resolve(clipboard));
  const writeText = vi.fn(() => Promise.resolve());
  return {
    readText,
    writeText,
    clipboard: {
      readText: permissions ? () => readPermittedClipboard(permissions, { readText }) : readText,
      writeText,
    },
    // Runs on the next macrotask, which `flush` waits for.
    scheduler: {
      after: (_ms, fn) => {
        const id = setTimeout(fn, 0);
        return () => {
          clearTimeout(id);
        };
      },
    },
  };
}

function mount(
  client: Client,
  route: OnboardingRoute = { name: 'onboarding.welcome' },
  env: OnboardingEnv = mockEnv(),
  scheme: Scheme = 'dark',
) {
  const seen: unknown[] = [];
  const table = {
    ...onboardingRoutes,
    'home.main': ({ route: r }: { route: { name: 'home.main' } }) => {
      seen.push(r);
      return <p>home</p>;
    },
    // The state routing: with a wallet it opens the unlock screen.
    'lock.root': ({ route: r }: { route: { name: 'lock.root' } }) => {
      seen.push(r);
      return <p>state routing</p>;
    },
  };
  const view = render(
    <ClientProvider client={client}>
      <AppearanceProvider
        state={
          new AppearanceState(
            { matches: true, addEventListener: () => undefined },
            { initial: scheme },
          )
        }
      >
        <OnboardingEnvProvider env={env}>
          <RandomProvider random={mockRandom()}>
            <Router table={table} initial={route} />
          </RandomProvider>
        </OnboardingEnvProvider>
      </AppearanceProvider>
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
  if (!(el instanceof HTMLInputElement)) throw new Error('no field');
  el.value = value;
  fireEvent(el, 'input');
}

const field = (host: HTMLElement, label: string) => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === label);
  return l ? host.querySelector(`#${l.getAttribute('for') ?? l.htmlFor}`) : null;
};

const baseHandlers = {
  'wallet.state': () => ok({ state: 'uninitialised', retryAt: null }),
  'wallet.generateMnemonic': () => ok({ mnemonic: PHRASE }),
  'tokens.preferred': () => ok([]),
  'wallet.createWallet': () => ok({ addresses: [] }),
  'wallet.importWallet': () => ok({ addresses: [] }),
  'tokens.add': ({ denom }: { denom: string }) => ok([{ ...BZE, denom }]),
  'tokens.search': () => ok({ tokens: [BZE, GOLD], partial: false }),
  'tokens.lookup': ({ code }: { code: string }) =>
    code === GOLD.denom
      ? ok(GOLD)
      : code === 'bad code'
        ? fail('invalid-code', 'x')
        : fail('no-such-token', 'x'),
} as Partial<Record<Method, Handler>>;

const savedCheck = (host: HTMLElement) => host.querySelector('[role="checkbox"]');
const backButton = (host: HTMLElement) => host.querySelector('.bp-ob-header [aria-label="Back"]');
const progress = (host: HTMLElement) => host.querySelector('.bp-progress-short')?.textContent;

async function toPassword(host: HTMLElement) {
  await click(host, 'Create a new wallet');
  await click(host, 'Reveal phrase');
  fireEvent(savedCheck(host), 'click');
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
    fireEvent(savedCheck(host), 'click');
    expect(button(host, 'Continue')?.disabled).toBe(false);
  });

  it('creates 24 words only: no length control, 24 cells, "1 of 5"', async () => {
    const { host } = mount(mockClient(baseHandlers));
    await click(host, 'Create a new wallet');
    expect(progress(host)).toBe('1 of 5');
    expect(host.querySelector('[role="radiogroup"]')).toBeNull();
    expect(host.querySelector('.bp-seg')).toBeNull();
    expect(host.querySelectorAll('.bp-word')).toHaveLength(24);
    await click(host, 'Reveal phrase');
    expect(host.querySelectorAll('.bp-word')).toHaveLength(24);
    expect(host.querySelector('.bp-seg')).toBeNull();
  });

  it('hides the phrase again when the user comes back from the check step', async () => {
    const { host } = mount(mockClient(baseHandlers));
    await toPassword(host);
    expect(host.textContent).toContain(en['onboarding.confirm.title']);
    fireEvent(backButton(host), 'click');
    expect(host.textContent).toContain(en['onboarding.phrase.reveal']);
    for (const w of PHRASE.split(' ')) expect(host.textContent).not.toContain(w);
  });

  it('copies the phrase only from the Copy button and never reads the clipboard', async () => {
    const env = mockEnv();
    const { host } = mount(mockClient(baseHandlers), undefined, env);
    await click(host, 'Create a new wallet');
    expect(button(host, en['onboarding.phrase.copy'])).toBeUndefined();
    await click(host, 'Reveal phrase');
    expect(env.writeText).not.toHaveBeenCalled();
    await click(host, en['onboarding.phrase.copy']);
    expect(env.writeText).toHaveBeenCalledExactlyOnceWith(PHRASE);
    expect(host.textContent).toContain(en['onboarding.phrase.copied']);
    expect(env.readText).not.toHaveBeenCalled();
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

const cells = (host: HTMLElement) => [...host.querySelectorAll<HTMLInputElement>('.bp-word input')];

function typeWords(host: HTMLElement, words: string) {
  words.split(' ').forEach((w, i) => {
    type(cells(host)[i], w);
  });
}

function paste(el: Element | undefined, text: string) {
  fireEvent(el, 'paste', { clipboardData: { getData: () => text } });
}

async function submitPassword(host: HTMLElement) {
  type(field(host, en['onboarding.password.label']), 'longenough1');
  type(field(host, en['onboarding.password.repeat']), 'longenough1');
  fireEvent(host.querySelector('form'), 'submit');
  await flush();
}

describe('import flow', () => {
  async function toImport(client: Client, env?: OnboardingEnv) {
    const view = mount(client, undefined, env);
    await click(view.host, 'Import a recovery phrase');
    return view;
  }

  it('opens on 12 cells, "1 of 4", and switches to 24 and back', async () => {
    const { host } = await toImport(mockClient(baseHandlers));
    expect(progress(host)).toBe('1 of 4');
    expect(cells(host)).toHaveLength(12);
    expect(host.querySelector('textarea')).toBeNull();
    await click(host, '24 words');
    expect(cells(host)).toHaveLength(24);
    typeWords(host, PHRASE_24);
    await click(host, '12 words');
    expect(cells(host)).toHaveLength(12);
    // Back on 24, the words typed into cells 13–24 are still there.
    await click(host, '24 words');
    expect(cells(host).map((c) => c.value)).toEqual(PHRASE_24.split(' '));
  });

  it('on 12, imports only the first 12 words even with 13–24 kept for later', async () => {
    const client = mockClient(baseHandlers);
    const { host } = await toImport(client);
    await click(host, '24 words');
    typeWords(host, `${PHRASE_12} ${'zoo '.repeat(11)}zoo`);
    await click(host, '12 words');
    await click(host, 'Continue');
    await submitPassword(host);
    expect(client.calls.find(([m]) => m === 'wallet.importWallet')?.[1]).toEqual({
      password: 'longenough1',
      mnemonic: PHRASE_12,
    });
  });

  it.each([
    ['13 words on 12 cells', 12, 13],
    ['25 words on 24 cells', 24, 25],
  ])('a paste of %s writes nothing and gives the count', async (_, length, count) => {
    const { host } = await toImport(mockClient(baseHandlers));
    if (length === 24) await click(host, '24 words');
    type(cells(host)[0], 'marble');
    paste(cells(host)[3], Array.from({ length: count }, () => 'abandon').join(' '));
    expect(cells(host)).toHaveLength(length);
    expect(cells(host).map((c) => c.value)).toEqual([
      'marble',
      ...Array.from({ length: length - 1 }, () => ''),
    ]);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      `${String(count)} words: a phrase has 12 or 24`,
    );
    // The next edit clears the line.
    type(cells(host)[1], 'echo');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('a short paste that runs past the last cell writes nothing', async () => {
    const { host } = await toImport(mockClient(baseHandlers));
    paste(cells(host)[10], 'marble echo tribe');
    expect(cells(host).every((c) => c.value === '')).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      '3 words: a phrase has 12 or 24',
    );
  });

  it('the Paste button refuses a phrase that does not fit, too', async () => {
    const env = mockEnv(Array.from({ length: 13 }, () => 'abandon').join(' '));
    const { host } = await toImport(mockClient(baseHandlers), env);
    await click(host, en['onboarding.import.paste']);
    expect(cells(host).every((c) => c.value === '')).toBe(true);
    expect(host.textContent).toContain('13 words: a phrase has 12 or 24');
  });

  it.each([
    ['12', PHRASE_12, 12],
    ['24', PHRASE_24, 24],
  ])(
    'pastes %s words into any cell: fills them all, sets the length, imports',
    async (_, words, count) => {
      const client = mockClient(baseHandlers);
      const { host } = await toImport(client);
      expect(button(host, 'Continue')?.disabled).toBe(true);
      paste(cells(host)[5], `  ${words.toUpperCase().replaceAll(' ', '\n ')}  `);
      expect(cells(host)).toHaveLength(count);
      expect(cells(host).map((c) => c.value)).toEqual(words.split(' '));
      await click(host, 'Continue');
      await submitPassword(host);
      expect(client.calls.find(([m]) => m === 'wallet.importWallet')?.[1]).toEqual({
        password: 'longenough1',
        mnemonic: words,
      });
    },
  );

  it('a short paste fills the cells from the one pasted into', async () => {
    const { host } = await toImport(mockClient(baseHandlers));
    paste(cells(host)[2], 'marble echo tribe');
    expect(
      cells(host)
        .map((c) => c.value)
        .slice(0, 6),
    ).toEqual(['', '', 'marble', 'echo', 'tribe', '']);
  });

  it('reads the clipboard only when Paste is tapped, once per tap', async () => {
    const env = mockEnv(PHRASE_12);
    const { host } = await toImport(mockClient(baseHandlers), env);
    expect(env.readText).not.toHaveBeenCalled();
    await click(host, en['onboarding.import.paste']);
    expect(env.readText).toHaveBeenCalledOnce();
    expect(
      cells(host)
        .map((c) => c.value)
        .join(' '),
    ).toBe(PHRASE_12);
    await click(host, en['onboarding.import.paste']);
    expect(env.readText).toHaveBeenCalledTimes(2);
  });

  it('Paste asks for clipboardRead in the tap itself, then fills the phrase', async () => {
    const permissions = {
      request: vi.fn(() => Promise.resolve(true)),
    };
    const env = mockEnv(PHRASE_12, permissions);
    const { host } = await toImport(mockClient(baseHandlers), env);
    fireEvent(button(host, en['onboarding.import.paste']), 'click');
    // Same tick as the click, before any promise has settled: the user gesture still holds.
    expect(permissions.request).toHaveBeenCalledExactlyOnceWith({
      permissions: ['clipboardRead'],
    });
    expect(env.readText).not.toHaveBeenCalled();
    await flush();
    expect(
      cells(host)
        .map((c) => c.value)
        .join(' '),
    ).toBe(PHRASE_12);
  });

  it('a declined Paste focuses the first word and says to paste by hand', async () => {
    const permissions = {
      request: vi.fn(() => Promise.resolve(false)),
    };
    const env = mockEnv(PHRASE_12, permissions);
    const { host } = await toImport(mockClient(baseHandlers), env);
    await click(host, en['onboarding.import.paste']);
    expect(env.readText).not.toHaveBeenCalled();
    expect(cells(host).every((c) => c.value === '')).toBe(true);
    expect(document.activeElement).toBe(cells(host)[0]);
    expect(host.textContent).toContain(en['app.pasteHint']);
    // Ctrl+V / ⌘V into the cell still fills the whole phrase and drops the hint.
    paste(cells(host)[0], PHRASE_12);
    await flush();
    expect(
      cells(host)
        .map((c) => c.value)
        .join(' '),
    ).toBe(PHRASE_12);
    expect(host.textContent).not.toContain(en['app.pasteHint']);
  });

  it('marks a word no list word starts with and suggests the closest one', async () => {
    const { host } = await toImport(mockClient(baseHandlers));
    typeWords(host, 'marble echo tribe velvet pioneer gho');
    // Still being typed: "gho" can become "ghost".
    expect(host.querySelector('.bp-word-bad')).toBeNull();
    type(cells(host)[5], 'gost');
    const bad = host.querySelectorAll('.bp-word-bad');
    expect(bad).toHaveLength(1);
    expect(bad[0]?.querySelector('input')?.getAttribute('aria-invalid')).toBe('true');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'Word 6 "gost" isn\'t a recovery phrase word. Did you mean "ghost"?',
    );
    expect(button(host, 'Continue')?.disabled).toBe(true);
    type(cells(host)[5], 'ghost');
    expect(host.querySelector('.bp-word-bad')).toBeNull();
  });

  it('refuses a phrase with a bad checksum on Continue, before the password', async () => {
    const client = mockClient(baseHandlers);
    const { host } = await toImport(client);
    typeWords(host, `${'abandon '.repeat(11)}abandon`);
    await click(host, 'Continue');
    expect(host.textContent).toContain(en['onboarding.import.invalid']);
    expect(host.textContent).toContain(en['onboarding.import.title']);
    // Editing clears the error.
    type(cells(host)[11], 'about');
    expect(host.textContent).not.toContain(en['onboarding.import.invalid']);
  });

  it('marks complete words that are only prefixes once Continue is tried', async () => {
    const { host } = await toImport(mockClient(baseHandlers));
    typeWords(host, `${'abandon '.repeat(11)}ab`);
    expect(host.querySelector('.bp-word-bad')).toBeNull();
    await click(host, 'Continue');
    expect(host.querySelectorAll('.bp-word-bad')).toHaveLength(1);
    expect(host.textContent).toContain('Word 12 "ab"');
  });

  it('returns to the phrase with an inline error when the service refuses it', async () => {
    const client = mockClient({
      ...baseHandlers,
      'wallet.importWallet': () => fail('invalid_mnemonic', 'This recovery phrase is not valid.'),
    });
    const { host } = await toImport(client);
    paste(cells(host)[0], PHRASE_12);
    await click(host, 'Continue');
    await submitPassword(host);
    expect(host.textContent).toContain(en['onboarding.import.invalid']);
    expect(
      cells(host)
        .map((c) => c.value)
        .join(' '),
    ).toBe(PHRASE_12);
  });

  it('drops the typed words when going back to Welcome', async () => {
    const { host } = await toImport(mockClient(baseHandlers));
    paste(cells(host)[0], PHRASE_24);
    // On 12, cells 13–24 are out of sight but still held: going back must drop them too.
    await click(host, '12 words');
    fireEvent(backButton(host), 'click');
    expect(host.textContent).toContain(en['onboarding.welcome.create']);
    await click(host, 'Import a recovery phrase');
    expect(cells(host)).toHaveLength(12);
    expect(cells(host).every((c) => c.value === '')).toBe(true);
    await click(host, '24 words');
    expect(cells(host).every((c) => c.value === '')).toBe(true);
  });

  it('keeps nothing of the words once unmounted', async () => {
    const client = mockClient(baseHandlers);
    const { host } = await toImport(client);
    paste(cells(host)[0], PHRASE_12);
    cleanup();
    const again = await toImport(client);
    expect(cells(again.host).every((c) => c.value === '')).toBe(true);
  });

  it('never writes typed or pasted words to storage, the URL or the console', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const chromeStorage = { local: { set: vi.fn() }, session: { set: vi.fn() } };
    vi.stubGlobal('chrome', { storage: chromeStorage });
    const before = location.href;
    const env = mockEnv(PHRASE_12);
    const { host } = await toImport(mockClient(baseHandlers), env);
    typeWords(host, 'marble echo gost');
    await click(host, en['onboarding.import.paste']);
    await click(host, 'Continue');
    expect(setItem).not.toHaveBeenCalled();
    expect(chromeStorage.local.set).not.toHaveBeenCalled();
    expect(chromeStorage.session.set).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(location.href).toBe(before);
    vi.unstubAllGlobals();
  });
});

async function createdWallet(
  client: Client,
  route?: OnboardingRoute,
  env?: OnboardingEnv,
  scheme?: Scheme,
) {
  const view = mount(client, route, env, scheme);
  await toPassword(view.host);
  answerQuiz(view.host, true);
  await click(view.host, 'Continue');
  type(field(view.host, en['onboarding.password.label']), 'longenough1');
  type(field(view.host, en['onboarding.password.repeat']), 'longenough1');
  fireEvent(view.host.querySelector('form'), 'submit');
  await flush();
  return view;
}

/** A wallet already exists: the worker refuses a create or import without `replace: true`. */
const existing = {
  ...baseHandlers,
  'wallet.state': () => ok({ state: 'locked', retryAt: null }),
  'wallet.createWallet': (req: { replace?: boolean }) =>
    req.replace === true
      ? ok({ addresses: [] })
      : fail('wallet_already_initialised', 'A wallet already exists.'),
  'wallet.importWallet': (req: { replace?: boolean }) =>
    req.replace === true
      ? ok({ addresses: [] })
      : fail('wallet_already_initialised', 'A wallet already exists.'),
} as Partial<Record<Method, Handler>>;

const writes = (client: { calls: [string, unknown][] }) =>
  client.calls.filter(([m]) => m === 'wallet.createWallet' || m === 'wallet.importWallet');

describe('over an existing wallet', () => {
  // The lock screen's "Forgot it?" opens the import step. Back used to land on a first-run
  // Welcome with no way to the unlock screen: the wallet looked deleted, and one Import from
  // there replaced it without a word.
  it('Back from the "Forgot it?" import step returns to the unlock screen', async () => {
    const client = mockClient(existing);
    const { host, seen } = mount(client, { name: 'onboarding.import' });
    await flush();
    fireEvent(backButton(host), 'click');
    await flush();
    expect(seen).toEqual([{ name: 'lock.root' }]);
    expect(host.textContent).not.toContain(en['onboarding.welcome.create']);
    expect(writes(client)).toEqual([]);
  });

  it('Welcome has a way back to the unlock screen, and the create step leads back there too', async () => {
    const client = mockClient(existing);
    const { host, seen } = mount(client);
    await flush();
    const welcomeBack = host.querySelector('.ob-welcome [aria-label="Back"]');
    if (!welcomeBack) throw new Error('no back button on Welcome');
    fireEvent(welcomeBack, 'click');
    await flush();
    expect(seen).toEqual([{ name: 'lock.root' }]);
    cleanup();
    const again = mount(client);
    await flush();
    await click(again.host, 'Create a new wallet');
    fireEvent(backButton(again.host), 'click');
    await flush();
    expect(again.seen).toEqual([{ name: 'lock.root' }]);
    expect(writes(client)).toEqual([]);
  });

  it('a first run keeps Back on Welcome and shows no Welcome back button', async () => {
    const { host, seen } = mount(mockClient(baseHandlers));
    await flush();
    expect(host.querySelector('.ob-welcome [aria-label="Back"]')).toBeNull();
    await click(host, 'Create a new wallet');
    fireEvent(backButton(host), 'click');
    await flush();
    expect(host.textContent).toContain(en['onboarding.welcome.create']);
    expect(seen).toEqual([]);
  });

  it('an import asks to confirm the deletion; the button waits for the tick, then replaces', async () => {
    const client = mockClient(existing);
    const { host } = mount(client, { name: 'onboarding.import' });
    await flush();
    paste(cells(host)[0], PHRASE_12);
    await click(host, 'Continue');
    await submitPassword(host);
    expect(writes(client)).toEqual([
      ['wallet.importWallet', { password: 'longenough1', mnemonic: PHRASE_12 }],
    ]);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(en['onboarding.replace.text']);
    const confirm = button(host, en['onboarding.replace.confirm']);
    expect(confirm?.disabled).toBe(true);
    fireEvent(confirm, 'click');
    await flush();
    expect(writes(client)).toHaveLength(1);
    fireEvent(alert?.querySelector('[role="checkbox"]'), 'click');
    expect(button(host, en['onboarding.replace.confirm'])?.disabled).toBe(false);
    await click(host, en['onboarding.replace.confirm']);
    expect(writes(client)[1]).toEqual([
      'wallet.importWallet',
      { password: 'longenough1', mnemonic: PHRASE_12, replace: true },
    ]);
    expect(host.textContent).toContain(en['onboarding.start.title']);
  });

  it('Cancel returns to the password step without writing; asking again starts unticked', async () => {
    const client = mockClient(existing);
    const { host } = mount(client);
    await flush();
    await toPassword(host);
    answerQuiz(host, true);
    await click(host, 'Continue');
    await submitPassword(host);
    fireEvent(host.querySelector('[role="alert"] [role="checkbox"]'), 'click');
    await click(host, en['onboarding.replace.cancel']);
    expect(host.textContent).toContain(en['onboarding.password.title']);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(writes(client)).toEqual([
      ['wallet.createWallet', { password: 'longenough1', mnemonic: PHRASE }],
    ]);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(button(host, en['onboarding.replace.confirm'])?.disabled).toBe(true);
    expect(writes(client).every(([, req]) => !(req as { replace?: boolean }).replace)).toBe(true);
  });

  it('a create confirmed over the wallet sends replace: true', async () => {
    const client = mockClient(existing);
    const { host } = mount(client);
    await flush();
    await toPassword(host);
    answerQuiz(host, true);
    await click(host, 'Continue');
    await submitPassword(host);
    fireEvent(host.querySelector('[role="alert"] [role="checkbox"]'), 'click');
    await click(host, en['onboarding.replace.confirm']);
    expect(writes(client)[1]).toEqual([
      'wallet.createWallet',
      { password: 'longenough1', mnemonic: PHRASE, replace: true },
    ]);
    expect(host.textContent).toContain(en['onboarding.start.title']);
  });
});

describe('start with a token denom', () => {
  async function look(host: HTMLElement, code: string) {
    await click(host, en['onboarding.start.haveCode']);
    type(field(host, en['onboarding.start.codeLabel']), code);
    // The lookup runs once typing pauses.
    await flush();
    await flush();
  }

  it('shows a found token in its brand colours and opens the wallet on it', async () => {
    const client = mockClient(baseHandlers);
    const { host, seen } = await createdWallet(client);
    expect(progress(host)).toBe('4 of 5');
    expect(host.querySelector('[role="radio"]')?.getAttribute('aria-checked')).toBe('false');
    await look(host, GOLD.denom);
    const card = host.querySelector<HTMLElement>('.bp-token-row-card');
    expect(card?.textContent).toContain('GOLD');
    expect(card?.textContent).toContain('Gold Coin');
    expect(card?.textContent).toContain(en['onboarding.start.kit']);
    // A found code makes the token step unnecessary: the flow is one step shorter.
    expect(progress(host)).toBe('4 of 4');
    await click(host, 'Open wallet with GOLD');
    expect(client.calls.filter(([m]) => m === 'tokens.add')).toEqual([
      ['tokens.add', { denom: GOLD.denom }],
    ]);
    expect(seen).toEqual([{ name: 'home.main' }]);
  });

  it('says so when no token has the code', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers));
    await look(host, 'factory/bze1x/ghost');
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      'No token uses this denom. Check it with whoever shared it.',
    );
    expect(button(host, 'Open wallet')).toBeUndefined();
    expect(button(host, 'Continue')?.disabled).toBe(true);
    expect(progress(host)).toBe('4 of 5');
  });

  it('shows a syntax error for an invalid code', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers));
    await look(host, 'bad code');
    expect(host.textContent).toContain(en['onboarding.start.invalid']);
  });

  it('looks up once typing pauses, and only the latest code lands', async () => {
    let releaseOld: (r: Result<unknown>) => void = () => undefined;
    const lookup = vi.fn(({ code }: { code: string }) =>
      code === 'factory/bze1x/old'
        ? new Promise<Result<unknown>>((r) => (releaseOld = r))
        : code === GOLD.denom
          ? ok(GOLD)
          : fail('no-such-token', 'x'),
    );
    const client = mockClient({ ...baseHandlers, 'tokens.lookup': lookup });
    const { host } = await createdWallet(client);
    await click(host, en['onboarding.start.haveCode']);
    const input = field(host, en['onboarding.start.codeLabel']);
    type(input, 'fact');
    type(input, 'factory/bze1x/old');
    expect(lookup).not.toHaveBeenCalled();
    await flush();
    expect(lookup).toHaveBeenCalledExactlyOnceWith({ code: 'factory/bze1x/old' });
    type(input, GOLD.denom);
    await flush();
    await flush();
    expect(button(host, 'Open wallet with GOLD')).toBeDefined();
    // The slow answer for the old code comes back last and changes nothing.
    releaseOld(fail('no-such-token', 'x'));
    await flush();
    expect(button(host, 'Open wallet with GOLD')).toBeDefined();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('reads the clipboard only when Paste is tapped and looks the code up', async () => {
    const env = mockEnv(` ${GOLD.denom} `);
    const { host } = await createdWallet(mockClient(baseHandlers), undefined, env);
    await click(host, en['onboarding.start.haveCode']);
    expect(env.readText).not.toHaveBeenCalled();
    await click(host, en['onboarding.start.paste']);
    await flush();
    expect(env.readText).toHaveBeenCalledOnce();
    expect((field(host, en['onboarding.start.codeLabel']) as HTMLInputElement).value).toBe(
      GOLD.denom,
    );
    expect(button(host, 'Open wallet with GOLD')).toBeDefined();
  });

  it('a declined token-denom Paste focuses the field, hints, and looks nothing up', async () => {
    const permissions = {
      request: vi.fn(() => Promise.resolve(false)),
    };
    const client = mockClient(baseHandlers);
    const env = mockEnv(GOLD.denom, permissions);
    const { host } = await createdWallet(client, undefined, env);
    await click(host, en['onboarding.start.haveCode']);
    await click(host, en['onboarding.start.paste']);
    await flush();
    const input = field(host, en['onboarding.start.codeLabel']) as HTMLInputElement;
    expect(permissions.request).toHaveBeenCalledOnce();
    expect(env.readText).not.toHaveBeenCalled();
    expect(client.calls.filter(([m]) => m === 'tokens.lookup')).toEqual([]);
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(host.textContent).toContain(en['app.pasteHint']);
    expect(host.textContent).not.toContain(en['onboarding.start.codeHint']);
    // Ctrl+V / ⌘V arrives as input and is looked up like typing.
    type(input, GOLD.denom);
    await flush();
    await flush();
    expect(host.textContent).not.toContain(en['app.pasteHint']);
    expect(host.textContent).toContain('The unique identifier of each token');
    expect(button(host, 'Open wallet with GOLD')).toBeDefined();
  });

  it('a granted token-denom Paste asks for clipboardRead in the tap, then looks it up', async () => {
    const permissions = {
      request: vi.fn(() => Promise.resolve(true)),
    };
    const env = mockEnv(GOLD.denom, permissions);
    const { host } = await createdWallet(mockClient(baseHandlers), undefined, env);
    await click(host, en['onboarding.start.haveCode']);
    fireEvent(button(host, en['onboarding.start.paste']), 'click');
    expect(permissions.request).toHaveBeenCalledOnce();
    expect(env.readText).not.toHaveBeenCalled();
    await flush();
    await flush();
    expect(button(host, 'Open wallet with GOLD')).toBeDefined();
  });

  it('switching to the manual card drops the code shortcut', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers));
    await look(host, GOLD.denom);
    expect(progress(host)).toBe('4 of 4');
    await click(host, en['onboarding.start.choose']);
    expect(progress(host)).toBe('4 of 5');
    expect(button(host, 'Open wallet')).toBeUndefined();
    await click(host, 'Continue');
    expect(host.textContent).toContain(en['onboarding.tokens.title']);
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
    // A code typed or opened without a link never shows the link warning.
    expect(host.textContent).not.toContain(en['addtoken.unknown']);
  });

  it('names the link on Welcome and warns about an unknown site on the code step', async () => {
    const client = mockClient(baseHandlers);
    const route: OnboardingRoute = {
      name: 'onboarding.welcome',
      prefillCode: GOLD.denom,
      link: { host: 'evil.example', known: false },
    };
    const view = mount(client, route);
    await flush();
    expect(view.host.querySelector('.bp-notice-title')?.textContent).toBe('Setting up for GOLD');
    expect(view.host.querySelector('.bp-notice-sub')?.textContent).toBe('Link from evil.example');
    cleanup();
    const { host } = await createdWallet(client, route);
    expect(host.textContent).toContain('Filled in from evil.example');
    expect(host.textContent).toContain(en['addtoken.unknown']);
  });

  it('does not warn about a known site', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers), {
      name: 'onboarding.welcome',
      prefillCode: GOLD.denom,
      link: { host: 'dex.getbze.com', known: true },
    });
    expect(host.textContent).toContain('Filled in from dex.getbze.com');
    expect(host.textContent).not.toContain(en['addtoken.unknown']);
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
    fireEvent(backButton(host), 'click');
    expect(host.textContent).not.toContain(PHRASE.split(' ')[0]);
    await click(host, 'Create a new wallet');
    expect(client.calls.filter(([m]) => m === 'wallet.generateMnemonic')).toHaveLength(2);
  });

  it('has no back button on the start step', async () => {
    const { host } = await createdWallet(mockClient(baseHandlers));
    expect(backButton(host)).toBeNull();
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
    await click(host, 'Continue');
    const boxes = host.querySelectorAll('.bp-token-row');
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
    expect(seen).toEqual([{ name: 'home.main' }]);
  });
});

describe('pick tokens', () => {
  async function toPick(client: Client) {
    const view = await createdWallet(client);
    await click(view.host, en['onboarding.start.choose']);
    await click(view.host, 'Continue');
    return view;
  }

  it('lists, searches, selects (BZE optional) and adds in order', async () => {
    const search = vi.fn(({ query }: { query: string }) =>
      ok({
        tokens: [BZE, GOLD].filter((t) => t.symbol.toLowerCase().includes(query.toLowerCase())),
        partial: false,
      }),
    );
    const client = mockClient({ ...baseHandlers, 'tokens.search': search });
    const { host, seen } = await toPick(client);
    expect(host.querySelectorAll('.bp-token-row')).toHaveLength(2);
    expect(button(host, 'Finish')?.disabled).toBe(true);

    type(field(host, en['onboarding.tokens.search']), 'gol');
    await flush();
    expect(search).toHaveBeenLastCalledWith({ query: 'gol' });
    expect(host.querySelectorAll('.bp-token-row')).toHaveLength(1);

    expect(progress(host)).toBe('5 of 5');
    fireEvent(host.querySelector('[role="checkbox"]'), 'click');
    expect(host.querySelector('[role="checkbox"]')?.getAttribute('aria-checked')).toBe('true');
    expect(host.textContent).toContain(en['onboarding.tokens.selectedOne']);
    expect(button(host, 'Finish')?.disabled).toBe(false);

    type(field(host, en['onboarding.tokens.search']), '');
    await flush();
    const boxes = host.querySelectorAll('[role="checkbox"]');
    fireEvent(boxes[0], 'click'); // BZE after GOLD
    expect(host.textContent).toContain('2 selected');
    await click(host, 'Finish');
    expect(client.calls.filter(([m]) => m === 'tokens.add').map(([, r]) => r)).toEqual([
      { denom: GOLD.denom },
      { denom: 'ubze' },
    ]);
    expect(seen).toEqual([{ name: 'home.main' }]);
  });

  it('can leave BZE out and unselect', async () => {
    const client = mockClient(baseHandlers);
    const { host } = await toPick(client);
    const boxes = host.querySelectorAll('[role="checkbox"]');
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

  it.each([
    ['dark', 'rgb(255, 176, 0)'],
    ['light', 'rgb(122, 79, 0)'],
  ] as const)('shows the found token with its %s kit swatches', async (scheme, primary) => {
    const { host } = await createdWallet(mockClient(baseHandlers), undefined, undefined, scheme);
    await click(host, en['onboarding.start.haveCode']);
    type(field(host, en['onboarding.start.codeLabel']), GOLD.denom);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    const swatches = [...host.querySelectorAll<HTMLElement>('.bp-swatches > span')].map(
      (e) => e.style.background,
    );
    expect(swatches).toHaveLength(3);
    expect(swatches[1]).toBe(primary);
  });
});
