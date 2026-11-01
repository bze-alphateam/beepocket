import { describe, expect, it, vi } from 'vitest';
import type { Client } from '../protocol/client';
import { fireEvent, render } from '../ui/test-render';
import { ClientProvider, useClient } from './client-context';
import { Layout } from './Layout';
import { Router, useRoute, type RouteTable } from './router';
import { App } from './App';

type TestRoute = { name: 'test.a' } | { name: 'test.b'; id: string };

function A() {
  const { navigate } = useRoute<TestRoute>();
  return (
    <button
      type="button"
      onClick={() => {
        navigate({ name: 'test.b', id: '42' });
      }}
    >
      to b
    </button>
  );
}

function B({ route }: { route: { name: 'test.b'; id: string } }) {
  return <p>b:{route.id}</p>;
}

const table: RouteTable<TestRoute> = { 'test.a': A, 'test.b': B };

describe('Router', () => {
  it('renders the initial route and navigates with typed params', () => {
    const { host } = render(<Router table={table} initial={{ name: 'test.a' }} />);
    expect(host.textContent).toBe('to b');
    fireEvent(host.querySelector('button'), 'click');
    expect(host.textContent).toBe('b:42');
  });

  it('fails clearly when useRoute is used outside a Router', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<A />)).toThrow(/inside a Router/);
    spy.mockRestore();
  });
});

describe('ClientProvider', () => {
  it('hands the injected client to descendants', async () => {
    const client: Client = {
      call: vi.fn(() => Promise.resolve({ ok: true as const, value: { nonce: 'n', at: 1 } })),
    };
    let got: Client | undefined;
    function Probe() {
      got = useClient();
      return null;
    }
    render(
      <ClientProvider client={client}>
        <Probe />
      </ClientProvider>,
    );
    expect(got).toBe(client);
    expect(await got?.call('app.ping', { nonce: 'n' })).toEqual({
      ok: true,
      value: { nonce: 'n', at: 1 },
    });
  });

  it('fails clearly without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Probe() {
      useClient();
      return null;
    }
    expect(() => render(<Probe />)).toThrow(/inside a ClientProvider/);
    spy.mockRestore();
  });
});

describe('Layout', () => {
  it('shows the header slot only when given', () => {
    const withHeader = render(<Layout header={<b>head</b>}>body</Layout>).host;
    expect(withHeader.querySelector('header')?.textContent).toBe('head');
    expect(withHeader.querySelector('.bp-body')?.textContent).toBe('body');
    expect(render(<Layout>body</Layout>).host.querySelector('header')).toBeNull();
  });
});

describe('App', () => {
  it('opens on the shell home screen', () => {
    const { host } = render(<App />);
    expect(host.querySelector('h1')?.textContent).toBe('BeePocket');
  });
});
