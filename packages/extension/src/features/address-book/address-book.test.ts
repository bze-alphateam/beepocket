import { deriveAccount } from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../background/registry';
import { fail, ok, type Result } from '../../protocol';
import { newProfile, type Profile } from '../wallet/profile';
import { registerBookHandlers } from './handlers';
import { walletBookStore, type BookWallet } from './wallet-store';

const PHRASE = `${'abandon '.repeat(23)}art`;
const addr = (i: number): string => deriveAccount(PHRASE, i).address;
const OWN = addr(0);
const OWN2 = addr(1);
const A = addr(5);
const B = addr(6);
const C = addr(7);

function setup(opts: { locked?: boolean; weak?: boolean; addressBook?: unknown[] } = {}) {
  let profile: Profile = {
    ...newProfile([
      { index: 0, label: 'Main', address: OWN },
      { index: 1, label: 'Savings', address: OWN2 },
    ]),
    addressBook: opts.addressBook ?? [],
  };
  const wallet: BookWallet = {
    getProfile: (): Promise<Result<Profile>> =>
      Promise.resolve(opts.locked ? fail('wallet_locked', 'locked') : ok(profile)),
    updateProfile: (patch): Promise<Result<Profile>> => {
      if (opts.locked) return Promise.resolve(fail('wallet_locked', 'locked'));
      if (opts.weak) return Promise.resolve(fail('needs-password', 'password'));
      profile = patch(structuredClone(profile));
      return Promise.resolve(ok(profile));
    },
  };
  const registry = new HandlerRegistry();
  registerBookHandlers(registry, walletBookStore(wallet));
  const call = (method: string, payload: unknown = {}) =>
    registry.dispatch({ method, payload }) as Promise<
      | { ok: true; value: Record<string, unknown> }
      | { ok: false; error: { code: string; message: string } }
    >;
  return { call, stored: () => profile.addressBook };
}

const names = async (t: ReturnType<typeof setup>) => {
  const r = await t.call('book.list');
  if (!r.ok) throw new Error('list failed');
  return (r.value.contacts as { name: string }[]).map((c) => c.name);
};

describe('book.add', () => {
  it('saves a trimmed contact in the profile', async () => {
    const t = setup();
    const r = await t.call('book.add', { name: '  Alex  ', address: ` ${A} ` });
    expect(r).toEqual({ ok: true, value: { contacts: [{ name: 'Alex', address: A }] } });
    expect(t.stored()).toEqual([{ name: 'Alex', address: A }]);
  });

  it('bounds the name to 1–32 characters after trimming', async () => {
    const t = setup();
    for (const name of ['', '   ', 'x'.repeat(33)]) {
      expect(await t.call('book.add', { name, address: A })).toMatchObject({
        ok: false,
        error: { code: 'invalid-name' },
      });
    }
    expect(await t.call('book.add', { name: 'x'.repeat(32), address: A })).toMatchObject({
      ok: true,
    });
  });

  it('rejects an invalid address', async () => {
    const t = setup();
    expect(await t.call('book.add', { name: 'Alex', address: 'bze1nope' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-address' },
    });
  });

  it('refuses a duplicate address and names the existing contact', async () => {
    const t = setup({ addressBook: [{ name: 'Alex', address: A }] });
    const r = await t.call('book.add', { name: 'Other', address: A });
    expect(r).toMatchObject({ ok: false, error: { code: 'duplicate-contact' } });
    expect(!r.ok && r.error.message).toContain('Alex');
    expect(t.stored()).toHaveLength(1);
  });

  it('refuses an own address', async () => {
    const t = setup();
    expect(await t.call('book.add', { name: 'Me', address: OWN2 })).toMatchObject({
      ok: false,
      error: { code: 'own-address' },
    });
    expect(t.stored()).toEqual([]);
  });

  it('needs the wallet unlocked', async () => {
    expect(await setup({ weak: true }).call('book.add', { name: 'A', address: A })).toMatchObject({
      ok: false,
      error: { code: 'needs-password' },
    });
    expect(await setup({ locked: true }).call('book.add', { name: 'A', address: A })).toMatchObject(
      {
        ok: false,
        error: { code: 'wallet_locked' },
      },
    );
  });

  it('answers bad_request for a malformed payload', async () => {
    expect(await setup().call('book.add', { name: 1 })).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
  });
});

describe('book.update / book.remove', () => {
  it('renames by address', async () => {
    const t = setup({ addressBook: [{ name: 'Alex', address: A }] });
    expect(await t.call('book.update', { name: ' Alexa ', address: A })).toEqual({
      ok: true,
      value: { contacts: [{ name: 'Alexa', address: A }] },
    });
    expect(await t.call('book.update', { name: '', address: A })).toMatchObject({
      ok: false,
      error: { code: 'invalid-name' },
    });
    expect(await t.call('book.update', { name: 'X', address: B })).toMatchObject({
      ok: false,
      error: { code: 'unknown-contact' },
    });
  });

  it('removes by address', async () => {
    const t = setup({
      addressBook: [
        { name: 'Alex', address: A },
        { name: 'Bo', address: B },
      ],
    });
    expect(await t.call('book.remove', { address: A })).toEqual({
      ok: true,
      value: { contacts: [{ name: 'Bo', address: B }] },
    });
    expect(await t.call('book.remove', { address: A })).toMatchObject({
      ok: false,
      error: { code: 'unknown-contact' },
    });
  });
});

describe('book.list', () => {
  it('sorts by name ignoring case, keeping the order of equal names', async () => {
    const t = setup({
      addressBook: [
        { name: 'bob', address: A },
        { name: 'Alex', address: B },
        { name: 'Bob', address: C },
      ],
    });
    const r = await t.call('book.list');
    expect(r.ok && r.value.contacts).toEqual([
      { name: 'Alex', address: B },
      { name: 'bob', address: A },
      { name: 'Bob', address: C },
    ]);
    expect(await names(t)).toEqual(['Alex', 'bob', 'Bob']);
  });

  it('lists the own addresses with their labels and skips damaged entries', async () => {
    const t = setup({ addressBook: [{ name: 'Alex', address: A }, 7, { name: 1 }] });
    const r = await t.call('book.list');
    expect(r).toEqual({
      ok: true,
      value: {
        contacts: [{ name: 'Alex', address: A }],
        own: [
          { label: 'Main', address: OWN },
          { label: 'Savings', address: OWN2 },
        ],
      },
    });
  });

  it('is readable weak locked but not locked', async () => {
    expect(await setup({ weak: true }).call('book.list')).toMatchObject({ ok: true });
    expect(await setup({ locked: true }).call('book.list')).toMatchObject({ ok: false });
  });
});

describe('book.match', () => {
  const t = () => setup({ addressBook: [{ name: 'Alex', address: A }] });
  it('knows the four kinds', async () => {
    const s = t();
    const kind = (input: string) => s.call('book.match', { input });
    expect(await kind(A)).toEqual({ ok: true, value: { kind: 'contact', name: 'Alex' } });
    expect(await kind(` ${OWN2} `)).toEqual({ ok: true, value: { kind: 'own', label: 'Savings' } });
    expect(await kind(B)).toEqual({ ok: true, value: { kind: 'unknown' } });
    expect(await kind('bze1nope')).toEqual({ ok: true, value: { kind: 'invalid' } });
    expect(await kind('')).toEqual({ ok: true, value: { kind: 'invalid' } });
  });

  it('calls a valid address unknown while the wallet is locked', async () => {
    expect(await setup({ locked: true }).call('book.match', { input: A })).toEqual({
      ok: true,
      value: { kind: 'unknown' },
    });
  });
});

describe('normalisation and stored data', () => {
  it('drops stored entries that break the rules, so a picker never returns them', async () => {
    const t = setup({
      addressBook: [
        { name: 'Good', address: A },
        { name: 'Bad', address: 'cosmos1abc' },
        { name: '', address: B },
        { name: 'Shout', address: A.toUpperCase() },
      ],
    });
    const r = await t.call('book.list');
    expect(r.ok && r.value.contacts).toEqual([{ name: 'Good', address: A }]);
  });

  it('treats an upper-case address as the same address everywhere', async () => {
    const t = setup({ addressBook: [{ name: 'Alex', address: A }] });
    expect(await t.call('book.add', { name: 'Again', address: A.toUpperCase() })).toMatchObject({
      ok: false,
      error: { code: 'duplicate-contact' },
    });
    expect(await t.call('book.add', { name: 'Me', address: OWN2.toUpperCase() })).toMatchObject({
      ok: false,
      error: { code: 'own-address' },
    });
    expect(await t.call('book.match', { input: OWN2.toUpperCase() })).toEqual({
      ok: true,
      value: { kind: 'own', label: 'Savings' },
    });
    expect(await t.call('book.match', { input: A.toUpperCase() })).toEqual({
      ok: true,
      value: { kind: 'contact', name: 'Alex' },
    });
    expect(await t.call('book.update', { name: 'Alexa', address: A.toUpperCase() })).toMatchObject({
      ok: true,
    });
    expect(await t.call('book.remove', { address: A.toUpperCase() })).toEqual({
      ok: true,
      value: { contacts: [] },
    });
    const added = await t.call('book.add', { name: 'Bo', address: B.toUpperCase() });
    expect(added).toEqual({ ok: true, value: { contacts: [{ name: 'Bo', address: B }] } });
  });

  it('counts code points, strips format characters and needs a visible character', async () => {
    const t = setup();
    expect(await t.call('book.add', { name: '😀'.repeat(32), address: A })).toMatchObject({
      ok: true,
    });
    expect(await t.call('book.add', { name: '😀'.repeat(33), address: B })).toMatchObject({
      ok: false,
      error: { code: 'invalid-name' },
    });
    expect(await t.call('book.add', { name: '\u200b\u202e \u2060', address: B })).toMatchObject({
      ok: false,
      error: { code: 'invalid-name' },
    });
    const r = await t.call('book.add', { name: 'Al\u202eex', address: B });
    expect(r.ok && r.value.contacts).toContainEqual({ name: 'Alex', address: B });
  });

  it('refuses a name another contact has, ignoring case', async () => {
    const t = setup({
      addressBook: [
        { name: 'Alex', address: A },
        { name: 'Bo', address: B },
      ],
    });
    expect(await t.call('book.add', { name: 'ALEX', address: C })).toMatchObject({
      ok: false,
      error: { code: 'duplicate-name' },
    });
    expect(await t.call('book.update', { name: 'alex', address: B })).toMatchObject({
      ok: false,
      error: { code: 'duplicate-name' },
    });
    expect(await t.call('book.update', { name: 'ALEX', address: A })).toMatchObject({ ok: true });
  });
});
