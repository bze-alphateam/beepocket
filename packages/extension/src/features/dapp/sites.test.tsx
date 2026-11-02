import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { fail, ok, WalletErrorCodes, type Method, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { ConnectedSitesScreen } from './ConnectedSitesScreen';

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

function rig(handlers: Partial<Record<Method, Handler>>) {
  const call = vi.fn((method: Method, req: unknown) => {
    const handler = handlers[method];
    return Promise.resolve(handler ? handler(req) : fail('unexpected', method));
  });
  const { host } = render(
    <ClientProvider client={{ call } as unknown as Client}>
      <Router
        table={{ here: ConnectedSitesScreen, 'settings.main': () => <p>settings</p> }}
        initial={{ name: 'here' }}
      />
    </ClientProvider>,
  );
  return { host, call };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
const button = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === name);

const listing = (sites: unknown[], network = 'mainnet') =>
  ok({ network, sites, addresses: ADDRESSES });

describe('Connected sites', () => {
  it('lists each site with its host and port, the address it sees and the date', async () => {
    const t = rig({ 'sites.list': () => listing([SITE]) });
    await settle();
    expect(t.host.textContent).toContain('http://localhost:5173');
    expect(t.host.textContent).toContain('Sees Savings');
    expect(t.host.textContent).toContain('Connected ');
    expect(button(t.host, 'Change')).toBeDefined();
    expect(button(t.host, 'Disconnect')).toBeDefined();
  });

  it('shows the empty state for the active network', async () => {
    const t = rig({ 'sites.list': () => listing([], 'testnet') });
    await settle();
    expect(t.host.textContent).toContain('No sites connected on Testnet');
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
    expect(t.host.textContent).toContain('No sites connected on Mainnet');
  });

  it('Change opens a sheet with the current address preselected and saves the pick', async () => {
    const t = rig({ 'sites.list': () => listing([SITE]), 'sites.change': () => ok({}) });
    await settle();
    fireEvent(button(t.host, 'Change'), 'click');
    await settle();
    const radios = t.host.querySelectorAll('input[type=radio]');
    expect((radios[1] as HTMLInputElement).checked).toBe(true);
    fireEvent(radios[0], 'change');
    fireEvent(button(t.host, 'Save'), 'click');
    await settle();
    expect(t.call).toHaveBeenCalledWith('sites.change', { origin: SITE.origin, index: 0 });
    expect(t.host.querySelector('[role=dialog]')).toBeNull();
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
