import {
  BookErrorCodes as Codes,
  fail,
  ok,
  type BookMatch,
  type Contact,
  type OwnAddress,
  type Result,
} from '../../protocol';
import { MAX_NAME_LENGTH, nameKey, normalizeAddress, normalizeName } from './contact';
import type { BookState, BookStore } from './ports';

/** By name, case-insensitive; equal names keep their storage order. */
function sorted(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

function checkName(name: string): Result<string> {
  const clean = normalizeName(name);
  return clean === null
    ? fail(Codes.invalidName, `A name has 1 to ${String(MAX_NAME_LENGTH)} characters.`)
    : ok(clean);
}

function checkAddress(address: string): Result<string> {
  const clean = normalizeAddress(address);
  return clean === null ? fail(Codes.invalidAddress, 'Not a BeeZee address.') : ok(clean);
}

/** Contacts and the matching of an address against them; rules of Business Logic §11. */
export class AddressBook {
  constructor(private readonly store: BookStore) {}

  async list(): Promise<Result<{ contacts: Contact[]; own: OwnAddress[] }>> {
    const state = await this.store.read();
    if (!state.ok) return state;
    return ok({ contacts: sorted(state.value.contacts), own: state.value.own });
  }

  add(contact: Contact): Promise<Result<{ contacts: Contact[] }>> {
    const name = checkName(contact.name);
    if (!name.ok) return Promise.resolve(name);
    const address = checkAddress(contact.address);
    if (!address.ok) return Promise.resolve(address);
    return this.save((state) => {
      if (state.own.some((o) => o.address.toLowerCase() === address.value)) {
        return fail(Codes.ownAddress, 'This is one of your own addresses.');
      }
      const existing = state.contacts.find((c) => c.address === address.value);
      if (existing) {
        return fail(Codes.duplicate, `This address is already saved as ${existing.name}.`);
      }
      if (state.contacts.some((c) => nameKey(c.name) === nameKey(name.value))) {
        return fail(Codes.duplicateName, 'Another contact already has this name.');
      }
      return ok([...state.contacts, { name: name.value, address: address.value }]);
    });
  }

  update(contact: Contact): Promise<Result<{ contacts: Contact[] }>> {
    const name = checkName(contact.name);
    if (!name.ok) return Promise.resolve(name);
    const address = normalizeAddress(contact.address) ?? '';
    return this.save((state) => {
      if (!state.contacts.some((c) => c.address === address)) {
        return fail(Codes.unknownContact, 'No contact with this address.');
      }
      if (
        state.contacts.some((c) => c.address !== address && nameKey(c.name) === nameKey(name.value))
      ) {
        return fail(Codes.duplicateName, 'Another contact already has this name.');
      }
      return ok(
        state.contacts.map((c) => (c.address === address ? { ...c, name: name.value } : c)),
      );
    });
  }

  remove(addressInput: string): Promise<Result<{ contacts: Contact[] }>> {
    const address = normalizeAddress(addressInput) ?? '';
    return this.save((state) =>
      state.contacts.some((c) => c.address === address)
        ? ok(state.contacts.filter((c) => c.address !== address))
        : fail(Codes.unknownContact, 'No contact with this address.'),
    );
  }

  /** What the Send form says about the typed address. */
  async match(input: string): Promise<Result<BookMatch>> {
    const address = normalizeAddress(input);
    if (address === null) return ok({ kind: 'invalid' });
    const state = await this.store.read();
    // A locked wallet knows no contacts and no own addresses; the address itself is fine.
    if (!state.ok) return ok({ kind: 'unknown' });
    const own = state.value.own.find((o) => o.address.toLowerCase() === address);
    if (own) return ok({ kind: 'own', label: own.label });
    const contact = state.value.contacts.find((c) => c.address === address);
    return ok(contact ? { kind: 'contact', name: contact.name } : { kind: 'unknown' });
  }

  private async save(
    change: (state: BookState) => Result<Contact[]>,
  ): Promise<Result<{ contacts: Contact[] }>> {
    const saved = await this.store.mutate(change);
    return saved.ok ? ok({ contacts: sorted(saved.value.contacts) }) : saved;
  }
}
