import { deriveAccount } from '@beepocket/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'preact/test-utils';
import { fail, ok, type Contact, type Result } from '../../protocol';
import type { Client } from '../../protocol/client';
import { ClientProvider } from '../../popup/client-context';
import { Router } from '../../popup/router';
import { cleanup, fireEvent, render } from '../../ui/test-render';
import { AddressBookSheet, type AddressBookSheetProps } from './AddressBookSheet';
import { bookRoutes, type BookRoute } from './routes';

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

type Mode = AddressBookSheetProps['mode'];

function sheet(initial: Contact[], props: Partial<AddressBookSheetProps> & { mode: Mode }) {
  const { client, calls } = mockClient(initial);
  const onPick = vi.fn();
  const onClose = vi.fn();
  const onChanged = vi.fn();
  const { host } = render(
    <ClientProvider client={client}>
      <AddressBookSheet open onPick={onPick} onClose={onClose} onChanged={onChanged} {...props} />
    </ClientProvider>,
  );
  return { host, calls, onPick, onClose, onChanged };
}

const title = (host: HTMLElement) => host.querySelector('[role=dialog] h2')?.textContent;
const fieldByLabel = (host: HTMLElement, label: string) => {
  const l = [...host.querySelectorAll('label')].find((x) => x.textContent === label);
  return host.querySelector(`#${l?.getAttribute('for') ?? 'none'}`);
};

describe('AddressBookSheet, pick mode (Send)', () => {
  it('groups contacts and own addresses with counts and answers the tapped address', async () => {
    const { host, onPick } = sheet(
      [
        { name: 'Alex', address: A },
        { name: 'Bo', address: B },
      ],
      { mode: 'pick', selected: A },
    );
    await flush();
    expect(title(host)).toBe('Address book');
    const groups = [...host.querySelectorAll('.bp-section-label')].map((h) => h.textContent);
    expect(groups).toEqual(['Contacts · 2', 'My addresses · 1']);
    // The address the form holds is highlighted.
    expect(button(host, 'Choose Alex')?.closest('.bp-list-row-on')).not.toBeNull();
    expect(button(host, 'Choose Bo')?.closest('.bp-list-row-on')).toBeNull();
    fireEvent(button(host, 'Choose Bo'), 'click');
    fireEvent(button(host, 'Choose Main'), 'click');
    expect(onPick.mock.calls).toEqual([[B], [OWN]]);
  });

  it('searches by name and address and says when nothing matches', async () => {
    const { host } = sheet([{ name: 'Alex', address: A }], { mode: 'pick' });
    await flush();
    type(host.querySelector('input[type=search]'), 'zzz');
    expect(host.textContent).toContain('No contact matches “zzz”.');
    type(host.querySelector('input[type=search]'), A.slice(-6));
    expect(button(host, 'Choose Alex')).not.toBeNull();
    expect(host.textContent).toContain('Contacts · 1');
  });

  it('saves a new contact and answers it with "Save and use"', async () => {
    const { host, calls, onPick, onChanged } = sheet([], { mode: 'pick' });
    await flush();
    fireEvent(button(host, 'New contact'), 'click');
    expect(title(host)).toBe('New contact');
    type(fieldByLabel(host, 'Name'), 'Bo');
    type(fieldByLabel(host, 'Address'), 'bze1nope');
    expect(host.textContent).toContain('This is not a BeeZee address.');
    type(fieldByLabel(host, 'Address'), B);
    expect(button(host, 'Save and use')).not.toBeNull();
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(calls).toContainEqual({ method: 'book.add', payload: { name: 'Bo', address: B } });
    expect(onPick).toHaveBeenCalledWith(B);
    expect(onChanged).toHaveBeenCalled();
  });

  it('opens on the form with the address filled in, and Cancel closes the sheet', async () => {
    const { host, onClose } = sheet([], { mode: 'pick', newAddress: B });
    await flush();
    expect(title(host)).toBe('New contact');
    expect((fieldByLabel(host, 'Address') as HTMLInputElement).value).toBe(B);
    expect(host.textContent).toContain('Contacts are stored only in this browser.');
    fireEvent(button(host, 'Cancel'), 'click');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stores the address normalized, as Send looks it up', async () => {
    const { host, calls, onPick } = sheet([], {
      mode: 'pick',
      newAddress: `  ${B.toUpperCase()} `,
    });
    await flush();
    type(fieldByLabel(host, 'Name'), 'Bo');
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(calls).toContainEqual({ method: 'book.add', payload: { name: 'Bo', address: B } });
    expect(onPick).toHaveBeenCalledWith(B);
  });

  it('never edits or deletes: a duplicate only says where the address is saved', async () => {
    const { host, calls } = sheet([{ name: 'Alex', address: A }], { mode: 'pick' });
    await flush();
    fireEvent(button(host, 'New contact'), 'click');
    type(fieldByLabel(host, 'Name'), 'Other');
    type(fieldByLabel(host, 'Address'), A);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(host.textContent).toContain('already saved as Alex. Pick it from the list.');
    expect(button(host, 'Rename Alex')).toBeNull();
    expect(button(host, 'Delete contact')).toBeNull();
    expect(title(host)).toBe('New contact');
    expect(calls.some((c) => c.method === 'book.update' || c.method === 'book.remove')).toBe(false);
  });

  it('renders nothing while closed', () => {
    const { client } = mockClient([]);
    const { host } = render(
      <ClientProvider client={client}>
        <AddressBookSheet open={false} mode="pick" onClose={() => undefined} />
      </ClientProvider>,
    );
    expect(host.textContent).toBe('');
  });
});

describe('AddressBookSheet, manage mode (Settings)', () => {
  it('opens a contact to rename it and never answers an address', async () => {
    const { host, calls, onPick } = sheet([{ name: 'Alex', address: A }], { mode: 'manage' });
    await flush();
    // Own addresses are listed but are not buttons here.
    expect(host.textContent).toContain('Main');
    expect(button(host, 'Choose Main')).toBeNull();
    fireEvent(button(host, 'Edit Alex'), 'click');
    expect(title(host)).toBe('Edit contact');
    expect((fieldByLabel(host, 'Address') as HTMLInputElement).disabled).toBe(true);
    type(fieldByLabel(host, 'Name'), 'Alexandra');
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(calls).toContainEqual({
      method: 'book.update',
      payload: { name: 'Alexandra', address: A },
    });
    expect(title(host)).toBe('Address book');
    expect(button(host, 'Edit Alexandra')).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('deletes a contact from its edit form', async () => {
    const { host, calls, onChanged } = sheet(
      [
        { name: 'Alex', address: A },
        { name: 'Bo', address: B },
      ],
      { mode: 'manage' },
    );
    await flush();
    fireEvent(button(host, 'Edit Bo'), 'click');
    fireEvent(button(host, 'Delete contact'), 'click');
    await flush();
    expect(calls).toContainEqual({ method: 'book.remove', payload: { address: B } });
    expect(onChanged).toHaveBeenCalled();
    expect(title(host)).toBe('Address book');
    expect(button(host, 'Edit Bo')).toBeNull();
    expect(button(host, 'Edit Alex')).not.toBeNull();
  });

  it('offers to rename the existing contact on a duplicate', async () => {
    const { host } = sheet([{ name: 'Alex', address: A }], { mode: 'manage' });
    await flush();
    fireEvent(button(host, 'New contact'), 'click');
    type(fieldByLabel(host, 'Name'), 'Other');
    type(fieldByLabel(host, 'Address'), A);
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(host.textContent).toContain('already saved as Alex');
    fireEvent(button(host, 'Rename Alex'), 'click');
    expect(title(host)).toBe('Edit contact');
    expect(button(host, 'Delete contact')).not.toBeNull();
  });

  it('adds with a plain Save and goes back to the list', async () => {
    const { host, onPick } = sheet([], { mode: 'manage' });
    await flush();
    expect(host.textContent).toContain('No contacts yet.');
    fireEvent(button(host, 'New contact'), 'click');
    type(fieldByLabel(host, 'Name'), 'Bo');
    type(fieldByLabel(host, 'Address'), B);
    expect(button(host, 'Save and use')).toBeNull();
    fireEvent(host.querySelector('form'), 'submit');
    await flush();
    expect(button(host, 'Edit Bo')).not.toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('book route', () => {
  it('shows the sheet in manage mode and leaves to where it came from', async () => {
    const { client } = mockClient([{ name: 'Alex', address: A }]);
    const { host } = render(
      <ClientProvider client={client}>
        <Router<BookRoute | { name: 'settings.main' }>
          table={{ ...bookRoutes, 'settings.main': () => <p>SETTINGS</p> }}
          initial={{ name: 'book' }}
        />
      </ClientProvider>,
    );
    await flush();
    expect(button(host, 'Edit Alex')).not.toBeNull();
    fireEvent(button(host, 'Back'), 'click');
    expect(host.textContent).toBe('SETTINGS');
  });
});
