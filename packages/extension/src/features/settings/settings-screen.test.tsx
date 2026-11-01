import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { fail, ok, WalletErrorCodes, type Method, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { ClientProvider } from '../../popup/client-context';
import { Router, type RouteTable } from '../../popup/router';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { settingsRoutes, type SettingsRoute } from './routes';
import { NetworkPill } from './NetworkPill';
import { SettingsScreen } from './SettingsScreen';

afterEach(cleanup);

const PHRASE = `${'abandon '.repeat(23)}art`;

class FakeClient implements Client {
  calls: { method: string; request: unknown }[] = [];
  settings = { brandThemes: true, weakLockMinutes: 15, fullLockMinutes: 60 };
  network = 'mainnet';
  preferred: Record<string, string[]> = { mainnet: ['ubze'], testnet: ['ubze'] };
  walletState = 'unlocked';
  reveal: Result<unknown> = ok({ status: 'ok', mnemonic: PHRASE });
  call(method: Method, request: unknown): Promise<Result<never>> {
    this.calls.push({ method, request });
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
          return ok(this.preferred[this.network] ?? []);
        case 'tokens.add':
          this.preferred[this.network] = ['ubze'];
          return ok(['ubze']);
        case 'wallet.state':
          return ok({ state: this.walletState, retryAt: null });
        case 'wallet.revealMnemonic':
          return this.reveal;
        default:
          return fail('unexpected', method);
      }
    };
    return Promise.resolve(reply() as Result<never>);
  }
}

const manifest = { version: () => '1.2.3' };

type TestRoute = SettingsRoute | { name: 'shell.home' } | { name: 'book' };
const Marker = (props: { route: { name: string } }) => <p>at:{props.route.name}</p>;
const table = {
  ...settingsRoutes,
  'settings.main': () => <SettingsScreen manifest={manifest} />,
  'shell.home': Marker,
  book: Marker,
} as RouteTable<TestRoute>;

function must<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error('element not found');
  return x;
}

const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

async function open(client: FakeClient) {
  const { host } = render(
    <ClientProvider client={client}>
      <Router<TestRoute> table={table} initial={{ name: 'settings.main' }} />
    </ClientProvider>,
  );
  await flush();
  return host;
}

describe('SettingsScreen', () => {
  it('shows every row with the manifest version and the repo link text', async () => {
    const host = await open(new FakeClient());
    const text = host.textContent;
    for (const s of ['Brand themes', 'Lock sending after', 'Lock wallet after', 'Address book']) {
      expect(text).toContain(s);
    }
    expect(text).toContain('Show recovery phrase');
    expect(text).toContain('Version 1.2.3');
    expect(text).toContain('github.com/bze-alphateam/beepocket');
    expect(text).not.toContain('Connected');
  });

  it('saves the brand themes flag and a lock timer', async () => {
    const client = new FakeClient();
    const host = await open(client);
    const sw = must(host.querySelector<HTMLInputElement>('input[role="switch"]'));
    sw.checked = false;
    fireEvent(sw, 'change');
    await flush();
    expect(client.settings.brandThemes).toBe(false);
    const select = must(host.querySelectorAll('select')[0]);
    select.value = '5';
    fireEvent(select, 'change');
    await flush();
    expect(client.settings.weakLockMinutes).toBe(5);
  });

  it('shows the wallet service error inline for an invalid combination', async () => {
    const host = await open(new FakeClient());
    const select = must(host.querySelectorAll('select')[1]);
    select.value = '5';
    fireEvent(select, 'change');
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('must not come before');
  });

  it('routes to the address book', async () => {
    const host = await open(new FakeClient());
    const row = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Address book');
    fireEvent(row, 'click');
    expect(host.textContent).toBe('at:book');
  });

  it('the testnet toggle shows the pill and a network without tokens lands on pick tokens', async () => {
    const client = new FakeClient();
    client.preferred.testnet = [];
    const host = await open(client);
    expect(host.querySelector('.bp-pill')).toBeNull();
    const sw = must(host.querySelectorAll<HTMLInputElement>('input[role="switch"]')[1]);
    sw.checked = true;
    fireEvent(sw, 'change');
    await flush();
    expect(client.network).toBe('testnet');
    await flush();
    expect(host.textContent).toContain('Pick your tokens');
    expect(host.querySelector('.bp-pill')?.textContent).toBe('Testnet');
  });

  it('stays on settings when the new network already has tokens, pill shown', async () => {
    const client = new FakeClient();
    const host = await open(client);
    const sw = must(host.querySelectorAll<HTMLInputElement>('input[role="switch"]')[1]);
    sw.checked = true;
    fireEvent(sw, 'change');
    await flush();
    expect(host.querySelector('.bp-pill')?.textContent).toBe('Testnet');
    expect(host.textContent).toContain('Brand themes');
  });
});

describe('reveal recovery phrase', () => {
  const openSheet = async (client: FakeClient) => {
    const host = await open(client);
    const row = [...host.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Show recovery phrase'),
    );
    fireEvent(row, 'click');
    return host;
  };
  const submit = async (host: HTMLElement, password: string) => {
    const input = must(host.querySelector<HTMLInputElement>('input[type="password"]'));
    input.value = password;
    fireEvent(input, 'input');
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
  };

  it('asks the password, shows the 24 words, hides them again on close', async () => {
    const client = new FakeClient();
    const host = await openSheet(client);
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
    await submit(host, 'pw');
    expect(client.calls.at(-1)).toEqual({
      method: 'wallet.revealMnemonic',
      request: { password: 'pw' },
    });
    expect(host.querySelectorAll('.bp-phrase li')).toHaveLength(24);
    fireEvent(
      [...host.querySelectorAll('button')].find((b) => b.textContent === 'Hide'),
      'click',
    );
    expect(host.textContent).not.toContain('abandon');
    // opening it again asks the password again
    const row = [...host.querySelectorAll('button')].find((b) =>
      b.textContent.includes('Show recovery phrase'),
    );
    fireEvent(row, 'click');
    expect(host.querySelector('input[type="password"]')).not.toBeNull();
  });

  it('shows wrong password and the throttle error', async () => {
    const client = new FakeClient();
    client.reveal = ok({ status: 'wrong-password', retryAt: null });
    const host = await openSheet(client);
    await submit(host, 'nope');
    expect(host.textContent).toContain('Wrong password.');
    client.reveal = ok({ status: 'throttled', retryAt: Date.now() + 30_000 });
    await submit(host, 'nope');
    expect(host.textContent).toMatch(/Try again in \d+ s/);
    expect(host.querySelector('.bp-phrase')).toBeNull();
  });

  describe('while the phrase is shown', () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    const shown = async (client: FakeClient) => {
      const host = await openSheet(client);
      await submit(host, 'pw');
      vi.useFakeTimers();
      expect(host.querySelector('.bp-phrase')).not.toBeNull();
      return host;
    };
    const advance = async (ms: number) => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };

    it('hides the phrase as soon as the wallet is weak locked', async () => {
      const client = new FakeClient();
      const host = await shown(client);
      await advance(2_100);
      expect(host.querySelector('.bp-phrase')).not.toBeNull();
      client.walletState = 'weakLocked';
      await advance(2_100);
      expect(host.querySelector('.bp-phrase')).toBeNull();
      expect(host.textContent).not.toContain('abandon');
    });

    it('hides the phrase after the idle time', async () => {
      const host = await shown(new FakeClient());
      await advance(61_000);
      expect(host.querySelector('.bp-phrase')).toBeNull();
    });
  });
});

describe('pick tokens screen', () => {
  const openPick = async (client: FakeClient) => {
    client.network = 'testnet';
    client.preferred.testnet = [];
    const { host } = render(
      <ClientProvider client={client}>
        <Router<TestRoute> table={table} initial={{ name: 'settings.pickTokens' }} />
      </ClientProvider>,
    );
    await flush();
    return host;
  };
  const button = (host: HTMLElement, text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === text);

  it('names the active network and switch network really switches it', async () => {
    const client = new FakeClient();
    client.preferred.mainnet = [];
    const host = await openPick(client);
    expect(host.textContent).toContain('No tokens are picked on Testnet yet.');
    fireEvent(button(host, 'Switch network'), 'click');
    await flush();
    expect(client.network).toBe('mainnet');
    expect(host.textContent).toContain('No tokens are picked on Mainnet yet.');
    expect(host.querySelector('.bp-pill')).toBeNull();
  });

  it('switching to a network that has tokens goes home', async () => {
    const client = new FakeClient();
    const host = await openPick(client);
    fireEvent(button(host, 'Switch network'), 'click');
    await flush();
    expect(client.network).toBe('mainnet');
    expect(host.textContent).toBe('at:shell.home');
  });

  it('add BZE picks the token and goes home', async () => {
    const client = new FakeClient();
    const host = await openPick(client);
    fireEvent(button(host, 'Add BZE'), 'click');
    await flush();
    expect(host.textContent).toBe('at:shell.home');
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
