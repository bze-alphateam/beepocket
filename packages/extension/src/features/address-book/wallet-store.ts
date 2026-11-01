import { fail, type Contact, type Result } from '../../protocol';
import type { Profile, WalletService } from '../wallet';
import type { BookState, BookStore } from './ports';

/** The wallet service surface the address book needs. */
export type BookWallet = Pick<WalletService, 'getProfile' | 'updateProfile'>;

function isContact(x: unknown): x is Contact {
  return (
    typeof x === 'object' &&
    x !== null &&
    'name' in x &&
    typeof x.name === 'string' &&
    'address' in x &&
    typeof x.address === 'string'
  );
}

function stateOf(profile: Profile): BookState {
  return {
    contacts: profile.addressBook
      .filter(isContact)
      .map((c) => ({ name: c.name, address: c.address })),
    own: profile.addresses.map((a) => ({ label: a.label, address: a.address })),
  };
}

/** Contacts are the profile's `addressBook`; reading works weak locked, writing needs unlock. */
export function walletBookStore(wallet: BookWallet): BookStore {
  return {
    async read() {
      const profile = await wallet.getProfile();
      return profile.ok ? { ok: true, value: stateOf(profile.value) } : profile;
    },
    async mutate(change) {
      const box: { failure?: Result<never> } = {};
      const updated = await wallet.updateProfile((profile) => {
        const next = change(stateOf(profile));
        if (!next.ok) {
          box.failure = fail(next.error.code, next.error.message);
          return profile;
        }
        return { ...profile, addressBook: next.value };
      });
      if (box.failure) return box.failure;
      return updated.ok ? { ok: true, value: stateOf(updated.value) } : updated;
    },
  };
}
