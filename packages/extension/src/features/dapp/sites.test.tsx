import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { fail, ok, WalletErrorCodes, type Method, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { ConnectedSitesScreen } from './ConnectedSitesScreen';
import { browserSiteIcons, SiteIconsProvider, type SiteIcons } from './site-icons';

afterEach(cleanup);

const ADDRESSES = [
  { index: 0, label: 'Main', address: 'bze1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq' },
  { index: 1, label: 'Savings', address: 'bze1pppppppppppppppppppppppppppppppppppppp' },
];
const SITE = {
  origin: 'http://localhost:5173',
  label: 'Savings',
  address: ADDRESSES[1]?.address ?? '',
  connectedAt: Date.UTC(2026, 10, 2, 12),
};

type Handler = (req: unknown) => Result<unknown>;

function rig(handlers: Partial<Record<Method, Handler>>, icons?: SiteIcons) {
  const call = vi.fn((method: Method, req: unknown) => {
    const handler = handlers[method];
    return Promise.resolve(handler ? handler(req) : fail('unexpected', method));
  });
  const screen = (
    <Router
      table={{ here: ConnectedSitesScreen, 'settings.main': () => <p>settings</p> }}
      initial={{ name: 'here' }}
    />
  );
  const { host } = render(
    <ClientProvider client={{ call } as unknown as Client}>
      {icons ? <SiteIconsProvider icons={icons}>{screen}</SiteIconsProvider> : screen}
    </ClientProvider>,
  );
  return { host, call };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent === name || b.getAttribute('aria-label')?.startsWith(name),
  );

const listing = (sites: unknown[], network = 'mainnet') =>
  ok({ network, sites, addresses: ADDRESSES });

describe('Connected sites', () => {
  it('lists each site in one row: domain with port, label and short address, two actions', async () => {
    const t = rig({ 'sites.list': () => listing([SITE]) });
    await settle();
    const row = t.host.querySelector('.bp-sites-list .bp-site-row');
    expect(row?.querySelector('.bp-site-row-domain')?.textContent).toBe('http://localhost:5173');
    expect(row?.querySelector('.bp-site-row-who')?.textContent).toBe('Savings · bze1pppp…pppppp');
    expect(t.host.querySelector('.bp-sites-net')?.textContent).toBe('Mainnet · 1');
    expect(button(t.host, 'Change the address http://localhost:5173 sees')).toBeDefined();
    expect(button(t.host, 'Disconnect http://localhost:5173')).toBeDefined();
    // No intro paragraph, no date, no "Sees" caption: the row says it all.
    expect(t.host.textContent).not.toContain('Each site sees');
    expect(t.host.textContent).not.toMatch(/Connected (\d|[A-Z][a-z]{2} )/);
  });

  it('shows a long domain whole, never cut', async () => {
    const origin = 'https://dex.getbze.com.claim-rewards-airdrop.example-dapp.xyz:8443';
    const t = rig({ 'sites.list': () => listing([{ ...SITE, origin }]) });
    await settle();
    expect(t.host.querySelector('.bp-site-row-domain')?.textContent).toBe(
      'dex.getbze.com.claim-rewards-airdrop.example-dapp.xyz:8443',
    );
  });

  it('shows the icon the browser has for each site, and the letter without one', async () => {
    const icons: SiteIcons = {
      url: (origin) => (origin === SITE.origin ? null : `icon:${origin}`),
    };
    const other = { ...SITE, origin: 'https://dex.getbze.com' };
    const t = rig({ 'sites.list': () => listing([SITE, other]) }, icons);
    await settle();
    const avatars = [...t.host.querySelectorAll('.bp-site-row .bp-avatar')];
    expect(avatars[0]?.querySelector('img')).toBeNull();
    expect(avatars[0]?.textContent).toBe('L');
    expect(avatars[1]?.querySelector('img')?.getAttribute('src')).toBe(
      'icon:https://dex.getbze.com',
    );
  });

  it('names the network in the empty state', async () => {
    const t = rig({ 'sites.list': () => listing([], 'testnet') });
    await settle();
    expect(t.host.textContent).toContain('No sites on Testnet');
    expect(t.host.querySelector('.bp-sites-list')).toBeNull();
    expect(button(t.host, 'Disconnect all')).toBeUndefined();
  });

  it('labels the testnet list', async () => {
    const t = rig({ 'sites.list': () => listing([SITE], 'testnet') });
    await settle();
    expect(t.host.querySelector('.bp-sites-net-testnet')?.textContent).toBe('Testnet · 1');
  });

  it('counts the sites and disconnects them all, one by one', async () => {
    const other = { ...SITE, origin: 'https://dex.getbze.com' };
    let sites = [SITE, other];
    const t = rig({
      'sites.list': () => listing(sites),
      'sites.disconnect': (req) => {
        sites = sites.filter((s) => s.origin !== (req as { origin: string }).origin);
        return ok({});
      },
    });
    await settle();
    expect(t.host.querySelector('.bp-sites-net')?.textContent).toBe('Mainnet · 2');
    fireEvent(button(t.host, 'Disconnect all'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('sites.disconnect', { origin: SITE.origin });
    expect(t.call).toHaveBeenCalledWith('sites.disconnect', { origin: other.origin });
    expect(t.host.textContent).toContain('No sites on Mainnet');
  });

  it('Disconnect calls the worker at once, without a confirmation', async () => {
    let sites = [SITE];
    const t = rig({
      'sites.list': () => listing(sites),
      'sites.disconnect': () => {
        sites = [];
        return ok({});
      },
    });
    await settle();
    fireEvent(button(t.host, 'Disconnect'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('sites.disconnect', { origin: SITE.origin });
    expect(t.host.textContent).toContain('No sites on Mainnet');
  });

  it('Change opens a sheet with the current address preselected and saves the pick', async () => {
    const t = rig({ 'sites.list': () => listing([SITE]), 'sites.change': () => ok({}) });
    await settle();
    fireEvent(button(t.host, 'Change'), 'click');
    await settle();
    const radios = t.host.querySelectorAll('[role=radio]');
    expect(radios[1]?.getAttribute('aria-checked')).toBe('true');
    fireEvent(radios[0], 'click');
    fireEvent(button(t.host, 'Save'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('sites.change', { origin: SITE.origin, index: 0 });
    expect(t.host.querySelector('[role=dialog]')).toBeNull();
  });

  it('a failed change keeps the sheet open and shows the error inside it', async () => {
    const t = rig({
      'sites.list': () => listing([SITE]),
      'sites.change': () => fail(WalletErrorCodes.needsPassword, 'locked'),
    });
    await settle();
    fireEvent(button(t.host, 'Change'), 'click');
    await settle();
    fireEvent(t.host.querySelectorAll('[role=radio]')[0], 'click');
    fireEvent(button(t.host, 'Save'), 'click');
    await settle();
    const sheet = t.host.querySelector('[role=dialog]');
    expect(sheet?.querySelector('[role=alert]')?.textContent).toContain('Unlock the wallet');
    expect(t.host.querySelectorAll('[role=alert]')).toHaveLength(1);
    // Closing the sheet drops the error with it.
    fireEvent(t.host.querySelector('.bp-sheet-backdrop'), 'click');
    expect(t.host.querySelector('[role=alert]')).toBeNull();
  });

  it('asks to unlock when the profile cannot be saved in weak lock', async () => {
    const t = rig({
      'sites.list': () => listing([SITE]),
      'sites.disconnect': () => fail(WalletErrorCodes.needsPassword, 'locked'),
    });
    await settle();
    fireEvent(button(t.host, 'Disconnect'), 'click');
    await settle();
    expect(t.host.textContent).toContain('Unlock the wallet');
    expect(t.host.textContent).toContain('http://localhost:5173');
  });
});

describe('browserSiteIcons', () => {
  it('asks the browser cache for the icon of the origin, never the site itself', () => {
    const icons = browserSiteIcons({ getURL: (path) => `chrome-extension://abc${path}` });
    expect(icons.url('https://dex.getbze.com:8443')).toBe(
      'chrome-extension://abc/_favicon/?pageUrl=https%3A%2F%2Fdex.getbze.com%3A8443&size=32',
    );
  });
});
