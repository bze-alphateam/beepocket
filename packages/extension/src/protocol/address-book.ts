/** Error codes of the `book.*` methods (`Result.error.code`). */
export const BookErrorCodes = {
  /** The name is empty or longer than 32 characters. */
  invalidName: 'invalid-name',
  /** Not a BeeZee address. */
  invalidAddress: 'invalid-address',
  /** The address is already saved; the message names the existing contact. */
  duplicate: 'duplicate-contact',
  /** One of the wallet's own addresses: it already appears under "Your addresses". */
  ownAddress: 'own-address',
  /** No contact with this address. */
  unknownContact: 'unknown-contact',
} as const;

export interface Contact {
  name: string;
  address: string;
}

export interface OwnAddress {
  label: string;
  address: string;
}

/** What the Send form shows next to an address: "Alex · Contact", "Savings · Your address". */
export type BookMatch =
  | { kind: 'contact'; name: string }
  | { kind: 'own'; label: string }
  | { kind: 'unknown' }
  | { kind: 'invalid' };

/** Address book methods. Contacts are shared by both networks and sorted by name. */
export interface BookProtocol {
  'book.list': { req: Record<string, never>; res: { contacts: Contact[]; own: OwnAddress[] } };
  'book.add': { req: Contact; res: { contacts: Contact[] } };
  /** Renames the contact with this address. */
  'book.update': { req: Contact; res: { contacts: Contact[] } };
  'book.remove': { req: { address: string }; res: { contacts: Contact[] } };
  'book.match': { req: { input: string }; res: BookMatch };
}
