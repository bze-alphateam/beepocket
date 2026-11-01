import { deriveAccount } from '@beepocket/core';
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'preact/test-utils';
import { fail, ok, type Contact, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { ContactPicker } from './ContactPicker';
import { bookRoutes } from './routes';

afterEach(cleanup);

const PHRASE = `${'abandon '.repeat(23)}art`;
const addr = (i: number): string => deriveAccount(PHRASE, i).address;
const OWN = addr(0);
const A = addr(5);
const B = addr(6);

function mockClient(initial: Contact[]) {
  let contacts = [...initial];
  const calls: { method: string; payload: unknown }[] = [];
  const client = {
    call(method: string, payload: unknown): Promise<Result<unknown>> {
      calls.push({ method, payload });
      const p = payload as Contact;
      if (method === 'book.list')
        return Promise.resolve(ok({ contacts, own: [{ label: 'Main', address: OWN }] }));
      if (method === 'book.add') {
        const dup = contacts.find((c) => c.address === p.address);
        if (dup) return Promise.resolve(fail('duplicate-contact', 'dup'));
        contacts = [...contacts, p];
        return Promise.resolve(ok({ contacts }));
      }
      if (method === 'book.update') {
        contacts = contacts.map((c) => (c.address === p.address ? p : c));
        return Promise.resolve(ok({ contacts }));
      }
      if (method === 'book.remove') {
        contacts = contacts.filter((c) => c.address !== p.address);
        return Promise.resolve(ok({ contacts }));
      }
      return Promise.resolve(fail('unknown_method', method));
    },
  } as unknown as Client;
  return { client, calls };
}

const flush = async () => {
  for (let i = 0; i < 3; i++) await act(() => new Promise<void>((r) => setTimeout(r, 0)));
};
const type = (el: Element | null, value: string) => {
  (el as HTMLInputElement).value = value;
  fireEvent(el, 'input');
};
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent) === text,
  ) ?? null;

describe('AddressBookScreen', () => {
  it('lists, searches, adds and deletes contacts', async () => {
    const { client, calls } = mockClient([{ name: 'Alex', address: A }]);
    const { host } = render(
      <ClientProvider client={client}>
        <Router table={bookRoutes} initial={{ name: 'book' }} />
      </ClientProvider>,
    );
    await flush();
    expect(host.textContent).toContain('Alex');
    expect(host.textContent).toContain('Your addresses');
    expect(host.textContent).toContain('Main');

    type(host.querySelector('input'), 'zzz');
    expect(host.textContent).toContain('Nothing found.');
    type(host.querySelector('input'), A.slice(-6));
    expect(host.textContent).toContain('Alex');

    fireEvent(button(host, 'Add contact'), 'click');
    const inputs = host.querySelectorAll('input');
    type(inputs[0] ?? null, 'Bo');
    type(inputs[1] ?? null, 'bze1nope');
    expect(host.textContent).toContain('This is not a BeeZee address.');
    type(host.querySelectorAll('input')[1] ?? null, B);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(calls.some((c) => c.method === 'book.add')).toBe(true);
    expect(host.textContent).toContain('Bo');

    fireEvent(button(host, 'Delete Bo'), 'click');
    await flush();
    expect(host.textContent).not.toContain('Bo');
  });

  it('offers to rename the existing contact on a duplicate', async () => {
    const { client } = mockClient([{ name: 'Alex', address: A }]);
    const { host } = render(
      <ClientProvider client={client}>
        <Router table={bookRoutes} initial={{ name: 'book' }} />
      </ClientProvider>,
    );
    await flush();
    fireEvent(button(host, 'Add contact'), 'click');
    type(host.querySelectorAll('input')[0] ?? null, 'Other');
    type(host.querySelectorAll('input')[1] ?? null, A);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(host.textContent).toContain('already saved as Alex');
    fireEvent(button(host, 'Rename Alex'), 'click');
    expect(host.textContent).toContain('Edit contact');
  });
});

describe('ContactPicker', () => {
  it('searches contacts and own addresses and answers the picked address', async () => {
    const { client } = mockClient([
      { name: 'Alex', address: A },
      { name: 'Bo', address: B },
    ]);
    const picked: string[] = [];
    const { host } = render(
      <ClientProvider client={client}>
        <ContactPicker open onClose={() => undefined} onPick={(a) => picked.push(a)} />
      </ClientProvider>,
    );
    await flush();
    expect(host.textContent).toContain('Alex');
    expect(host.textContent).toContain('Main');
    type(host.querySelector('input'), 'bo');
    expect(host.textContent).not.toContain('Alex');
    fireEvent(button(host, host.querySelector('.bp-book-row')?.textContent ?? ''), 'click');
    expect(picked).toEqual([B]);
  });

  it('renders nothing while closed', () => {
    const { client } = mockClient([]);
    const { host } = render(
      <ClientProvider client={client}>
        <ContactPicker open={false} onClose={() => undefined} onPick={() => undefined} />
      </ClientProvider>,
    );
    expect(host.textContent).toBe('');
  });
});
