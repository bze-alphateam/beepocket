import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  Argon2idKdf,
  BroadcastError,
  buildAuthInfo,
  buildBody,
  decodeAuthInfo,
  deriveAccount,
  encodeMsgSend,
  NETWORKS,
  SimulationError,
  signDocBytes,
  txRawBytes,
  Vault,
  WebCryptoCipher,
  type ChainClient,
  type FeeEstimate,
  type Random,
} from '@beepocket/core';
import { describe, expect, it, vi } from 'vitest';
import type { Services } from '../background/services';
import { ChromeSessionStorage, ChromeStorage } from '../platform';
import { FakeArea } from '../platform/test-support';
import { FULL_LOCK_ALARM, WEAK_LOCK_ALARM } from '../features/wallet/alarms';
import { WalletService } from '../features/wallet/service';
import { Deliverer } from './deliver';
import { registerDappHandlers } from './handlers';
import type { ChainEnv } from './handlers/env';
import { DappRegistry } from './registry';
import { RequestStore } from './requests';
import { DappService } from './service';
import type { DappSender } from './types';
import { RequestWindow } from './window';
import { bytesFromWire, bytesToWire } from './wire';

const PHRASE = `${'abandon '.repeat(23)}art`;
const PASSWORD = 'correct horse';
const ORIGIN = 'https://dex.getbze.com';
const MAIN = deriveAccount(PHRASE, 0);
const OTHER = deriveAccount(PHRASE, 1);
const CHAIN_ID = NETWORKS.mainnet.chainId;
const ACCOUNT_NUMBER = 7n;
const SEQUENCE = 3n;
const HASH = 'AB'.repeat(32);

const counterRandom = (): Random => {
  let n = 0;
  return {
    bytes(len) {
      n++;
      return Uint8Array.from({ length: len }, (_, i) => (n * 31 + i * 7 + (n >> 8)) % 256);
    },
  };
};

interface SignedAnswer {
  signed: { bodyBytes: string; authInfoBytes: string; chainId: string; accountNumber: string };
  signature: { pub_key: { type: string; value: string }; signature: string };
}

const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  ubze: { symbol: 'BZE', decimals: 6 },
  uother: { symbol: 'OTH', decimals: 6 },
};

interface Node {
  account: { accountNumber: bigint; sequence: bigint; pubKey: null } | null;
  estimate: () => Promise<FeeEstimate>;
  broadcast: ReturnType<typeof vi.fn>;
}

const FEES: FeeEstimate = {
  gasLimit: 200_000n,
  options: [
    { denom: 'ubze', amount: 2000n },
    { denom: 'uother', amount: 500n },
  ],
  default: 'ubze',
};

async function rig() {
  const local = new FakeArea();
  const session = await ChromeSessionStorage.open(new FakeArea());
  const random = counterRandom();
  const vault = new Vault({
    random,
    cipher: new WebCryptoCipher(globalThis.crypto.subtle),
    kdf: new Argon2idKdf(),
    params: { alg: 'argon2id', m: 8, t: 1, p: 1 },
  });
  const clock = { now: () => 5_000, sleep: () => Promise.resolve() };
  const alarms: string[] = [];
  const wallet = new WalletService({
    storage: new ChromeStorage(local),
    session,
    vault,
    random,
    clock,
    alarms: {
      set: (name: string) => {
        alarms.push(name);
        return Promise.resolve();
      },
      clear: () => Promise.resolve(),
    },
    chain: () =>
      Promise.resolve({
        balances: () => Promise.resolve(new Map()),
        account: () => Promise.resolve(null),
      } as unknown as ChainClient),
  });
  const node: Node = {
    account: { accountNumber: ACCOUNT_NUMBER, sequence: SEQUENCE, pubKey: null },
    estimate: () => Promise.resolve(FEES),
    broadcast: vi.fn(() => Promise.resolve({ txHash: HASH })),
  };
  const env: ChainEnv = {
    network: NETWORKS.mainnet,
    chain: {
      account: () => Promise.resolve(node.account),
      balances: () => Promise.resolve(new Map([['ubze', 100_000_000n]])),
      broadcast: (bytes: Uint8Array) => node.broadcast(bytes) as ReturnType<ChainClient['broadcast']>,
      markets: () => Promise.resolve([]),
      liquidityPools: () => Promise.resolve([]),
      marketOrder: () => Promise.resolve(null),
    },
    fees: { estimate: () => node.estimate() },
    tokens: {
      resolve: (denom) => {
        const known = TOKENS[denom];
        return known
          ? Promise.resolve({
              denom,
              name: known.symbol,
              kind: 'native',
              source: 'builtin',
              branding: null,
              ...known,
            })
          : Promise.reject(new Error('unknown token'));
      },
    },
  };
  const services = { activeNetwork: () => Promise.resolve(NETWORKS.mainnet) } as Services;
  const delivered: { documentId: string | undefined; message: unknown }[] = [];
  const created: unknown[] = [];
  const open = new Set<number>();
  const registry = new DappRegistry();
  registerDappHandlers(registry, { wallet, services, clock, env: () => Promise.resolve(env) });
  const dapp = new DappService({
    registry,
    requests: new RequestStore(session),
    window: new RequestWindow(
      {
        create: () => {
          created.push(1);
          open.add(created.length);
          return Promise.resolve({ id: created.length });
        },
        get: (id) => (open.has(id) ? Promise.resolve({}) : Promise.reject(new Error('gone'))),
        update: () => Promise.resolve({}),
      },
      session,
    ),
    deliverer: new Deliverer({
      sendMessage: (_tab, message, options) => {
        delivered.push({ documentId: options?.documentId, message });
        return Promise.resolve();
      },
    }),
    services,
    clock,
  });

  let n = 0;
  const from: DappSender = { origin: ORIGIN, tabId: 1, documentId: 'doc-1' };
  const ask = async (method: string, params: unknown) => {
    const id = (++n).toString(16).padStart(32, '0');
    const received = await dapp.receive(from, { id, method, params });
    await received.after();
    return { id, ack: received.ack };
  };
  const answerOf = (id: string) =>
    delivered
      .map((d) => (d.message as { dapp: { id: string } }).dapp)
      .find((m) => m.id === id) as
      | { result?: unknown; error?: { code: string; message: string } }
      | undefined;
  const signedOf = (id: string) => answerOf(id)?.result as SignedAnswer;

  await wallet.createWallet(PASSWORD, PHRASE);
  await wallet.deriveNext();
  const connect = async () => {
    const a = await ask('connect', { chainId: CHAIN_ID });
    await dapp.current();
    await dapp.answer(a.id, { approve: true, index: 0 });
  };
  return { wallet, dapp, ask, answerOf, signedOf, node, env, alarms, created, delivered, connect };
}

type Rig = Awaited<ReturnType<typeof rig>>;

interface DocOptions {
  signer?: string;
  chainId?: string;
  accountNumber?: bigint;
  sequence?: bigint;
  messages?: { typeUrl: string; value: Uint8Array }[];
  memo?: string;
  requestFee?: bigint;
}

/** What a dapp passes to `signDirect`, in wire form, plus the raw bytes for the checks. */
function request(options: DocOptions = {}) {
  const bodyBytes = buildBody({
    messages: options.messages ?? [
      encodeMsgSend({
        fromAddress: MAIN.address,
        toAddress: OTHER.address,
        amount: [{ denom: 'ubze', amount: '1000000' }],
      }),
    ],
    memo: options.memo ?? '',
  });
  const authInfoBytes = buildAuthInfo({
    pubKey: MAIN.pubKey,
    sequence: options.sequence ?? SEQUENCE,
    fee: { amount: [{ denom: 'ubze', amount: (options.requestFee ?? 1n).toString() }], gasLimit: 1n },
  });
  const chainId = options.chainId ?? CHAIN_ID;
  const accountNumber = options.accountNumber ?? ACCOUNT_NUMBER;
  return {
    bodyBytes,
    authInfoBytes,
    params: {
      chainId: CHAIN_ID,
      signer: options.signer ?? MAIN.address,
      signDoc: {
        bodyBytes: bytesToWire(bodyBytes),
        authInfoBytes: bytesToWire(authInfoBytes),
        chainId,
        accountNumber: accountNumber.toString(),
      },
    },
  };
}

const feeFor = (view: { fee: { denom: string; amount: string }; gasLimit: string }) => ({
  denom: view.fee.denom,
  amount: view.fee.amount,
  gasLimit: view.gasLimit,
});

async function review(t: Rig, options?: DocOptions) {
  const doc = request(options);
  const a = await t.ask('signDirect', doc.params);
  const view = await t.dapp.current();
  if (view.status !== 'sign') throw new Error(`expected the sign screen, got ${view.status}`);
  return { ...doc, id: a.id, view };
}

describe('signDirect refuses before any window opens', () => {
  const cases: [string, DocOptions, string][] = [
    ['another chain id in the signDoc', { chainId: 'other-1' }, 'wrong-chain'],
    ['a signer that is not the connected address', { signer: OTHER.address }, 'not-connected'],
    ['a stale sequence', { sequence: SEQUENCE + 1n }, 'invalid-request'],
    ['a wrong account number', { accountNumber: ACCOUNT_NUMBER + 1n }, 'invalid-request'],
  ];
  for (const [name, options, code] of cases) {
    it(`for ${name}`, async () => {
      const t = await rig();
      await t.connect();
      const windows = t.created.length;
      const a = await t.ask('signDirect', request(options).params);
      expect(t.answerOf(a.id)).toMatchObject({ error: { code } });
      expect(t.created).toHaveLength(windows);
    });
  }

  it('for a site that is not connected', async () => {
    const t = await rig();
    const a = await t.ask('signDirect', request().params);
    expect(t.answerOf(a.id)).toMatchObject({ error: { code: 'not-connected' } });
    expect(t.created).toHaveLength(0);
  });

  it('for a request made for the other network', async () => {
    const t = await rig();
    await t.connect();
    const a = await t.ask('signDirect', { ...request().params, chainId: NETWORKS.testnet.chainId });
    expect(t.answerOf(a.id)).toMatchObject({ error: { code: 'wrong-chain' } });
  });

  it('for an address that is not on chain yet', async () => {
    const t = await rig();
    await t.connect();
    t.node.account = null;
    const windows = t.created.length;
    const a = await t.ask('signDirect', request().params);
    expect(t.answerOf(a.id)).toMatchObject({
      error: { code: 'invalid-request', message: 'Fund this address first.' },
    });
    expect(t.created).toHaveLength(windows);
  });

  it('with the nodes words when the simulation fails', async () => {
    const t = await rig();
    await t.connect();
    t.node.estimate = () => Promise.reject(new SimulationError('insufficient funds', 400));
    const a = await t.ask('signDirect', request().params);
    expect(t.answerOf(a.id)).toMatchObject({
      error: { code: 'invalid-request', message: 'insufficient funds' },
    });
  });

  it('when no token can pay the fee', async () => {
    const t = await rig();
    await t.connect();
    t.node.estimate = () => Promise.resolve({ gasLimit: 1n, options: [], default: null });
    const a = await t.ask('signDirect', request().params);
    expect(t.answerOf(a.id)).toMatchObject({ error: { code: 'invalid-request' } });
  });

  it('for params that are not a signDoc', async () => {
    const t = await rig();
    const a = await t.ask('signDirect', { chainId: CHAIN_ID, signer: MAIN.address, signDoc: {} });
    expect(a.ack).toMatchObject({ error: { code: 'invalid-request' } });
  });
});

describe('signDirect review and approval', () => {
  it('shows the transaction in plain words with the wallet fee', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, { memo: 'thanks' });
    expect(r.view).toMatchObject({
      origin: ORIGIN,
      approvable: true,
      locked: false,
      signer: { label: 'Main', address: MAIN.address },
      fee: { denom: 'ubze', amount: '2000', symbol: 'BZE' },
      gasLimit: '200000',
    });
    expect(r.view.summary.hero).toContain('1 BZE');
    expect(r.view.summary.memo).toBe('thanks');
    expect(r.view.options.map((o) => o.denom)).toEqual(['ubze', 'uother']);
    expect(JSON.parse(r.view.rawJson)).toHaveLength(1);
  });

  it('signs the requests body untouched with the wallets own fee', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, { requestFee: 1n });
    const res = await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(res.ok).toBe(true);
    const { signed, signature } = t.signedOf(r.id);
    expect(bytesFromWire(signed.bodyBytes)).toEqual(r.bodyBytes);
    const authInfo = decodeAuthInfo(bytesFromWire(signed.authInfoBytes));
    expect(authInfo).toMatchObject({
      fee: { amount: [{ denom: 'ubze', amount: '2000' }], gasLimit: '200000' },
    });
    expect(signed).toMatchObject({ chainId: CHAIN_ID, accountNumber: '7' });
    expect(signature.pub_key).toEqual({
      type: 'tendermint/PubKeySecp256k1',
      value: bytesToWire(MAIN.pubKey),
    });
    // The signature covers exactly the SignDoc the dapp must rebuild from `signed`.
    const doc = signDocBytes({
      bodyBytes: bytesFromWire(signed.bodyBytes),
      authInfoBytes: bytesFromWire(signed.authInfoBytes),
      chainId: signed.chainId,
      accountNumber: BigInt(signed.accountNumber),
    });
    const sig = bytesFromWire(signature.signature);
    expect(sig).toHaveLength(64);
    expect(secp256k1.verify(sig, sha256(doc), MAIN.pubKey, { prehash: false })).toBe(true);
  });

  it('signs with the fee token the user picked', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    const other = r.view.options.find((o) => o.denom === 'uother');
    expect(other).toBeDefined();
    await t.dapp.answer(r.id, {
      approve: true,
      fee: { denom: 'uother', amount: '500', gasLimit: r.view.gasLimit },
    });
    const { signed } = t.signedOf(r.id);
    expect(decodeAuthInfo(bytesFromWire(signed.authInfoBytes))).toMatchObject({
      fee: { amount: [{ denom: 'uother', amount: '500' }] },
    });
  });

  it('refuses a fee that is not what was reviewed and keeps the request waiting', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    const res = await t.dapp.answer(r.id, {
      approve: true,
      fee: { denom: 'ubze', amount: '1', gasLimit: r.view.gasLimit },
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'review-changed' } });
    expect(t.answerOf(r.id)).toBeUndefined();
    expect((await t.dapp.current()).status).toBe('sign');
  });

  it('refuses an approval without a reviewed fee, or in a token that cannot pay', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    expect(await t.dapp.answer(r.id, { approve: true })).toMatchObject({ ok: false });
    expect(
      await t.dapp.answer(r.id, {
        approve: true,
        fee: { denom: 'unope', amount: '1', gasLimit: r.view.gasLimit },
      }),
    ).toMatchObject({ ok: false });
    expect(t.answerOf(r.id)).toBeUndefined();
  });

  it('answers rejected on Reject', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    await t.dapp.answer(r.id, { approve: false });
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'rejected' } });
  });

  it('re-arms both lock timers after signing', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    t.alarms.length = 0;
    await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(t.alarms).toEqual(expect.arrayContaining([WEAK_LOCK_ALARM, FULL_LOCK_ALARM]));
  });

  it('shows a request it cannot put in plain words, and answers the page instead of signing it', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, { messages: [{ typeUrl: '/foo.v1.MsgBar', value: new Uint8Array() }] });
    expect(r.view.approvable).toBe(false);
    const res = await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(res.ok).toBe(true);
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.signedOf(r.id)).toBeUndefined();
    expect((await t.dapp.current()).status).toBe('none');
  });

  it('refuses to sign once the site is no longer connected', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    await t.wallet.updateProfile((p) => {
      p.sites.mainnet = {};
      return p;
    });
    await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'not-connected' } });
  });
});

describe('signDirect in the weak lock', () => {
  it('asks for the password, refuses a wrong one, and signs after the right one', async () => {
    const t = await rig();
    await t.connect();
    await t.wallet.weakLock();
    const r = await review(t);
    expect(r.view.locked).toBe(true);

    const early = await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(early).toMatchObject({ ok: false, error: { code: 'needs-password' } });
    expect(t.answerOf(r.id)).toBeUndefined();

    const wrong = await t.wallet.reauth('not the password');
    expect(wrong).toMatchObject({ ok: true, value: { status: 'wrong-password' } });
    expect(await t.dapp.current()).toMatchObject({ status: 'sign', locked: true });

    const right = await t.wallet.reauth(PASSWORD);
    expect(right).toMatchObject({ ok: true, value: { status: 'ok' } });
    const view = await t.dapp.current();
    expect(view).toMatchObject({ status: 'sign', locked: false });
    await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(t.signedOf(r.id).signature.signature).toBeTypeOf('string');
  });
});

describe('sendTx', () => {
  const signedTx = () =>
    txRawBytes({
      bodyBytes: Uint8Array.from([1]),
      authInfoBytes: Uint8Array.from([2]),
      signatures: [new Uint8Array(64).fill(1)],
    });
  const params = (txBytes: Uint8Array = signedTx(), mode: unknown = 'sync') => ({
    chainId: CHAIN_ID,
    txBytes: bytesToWire(txBytes),
    mode,
  });

  it('broadcasts for a connected site without a window and answers the 32-byte hash', async () => {
    const t = await rig();
    await t.connect();
    const windows = t.created.length;
    const a = await t.ask('sendTx', params());
    expect(t.node.broadcast).toHaveBeenCalledWith(signedTx());
    const hash = bytesFromWire(t.answerOf(a.id)?.result as string);
    expect(hash).toHaveLength(32);
    expect(hash[0]).toBe(0xab);
    expect(t.created).toHaveLength(windows);
  });

  it('refuses any mode but sync', async () => {
    const t = await rig();
    await t.connect();
    const a = await t.ask('sendTx', params(signedTx(), 'async'));
    expect(a.ack).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.node.broadcast).not.toHaveBeenCalled();
  });

  it('refuses bytes over 512 KiB', async () => {
    const t = await rig();
    await t.connect();
    const a = await t.ask('sendTx', params(new Uint8Array(512 * 1024 + 1)));
    expect(a.ack).toMatchObject({ error: { code: 'invalid-request' } });
  });

  it('refuses bytes that are not a TxRaw, or not signed', async () => {
    const t = await rig();
    await t.connect();
    const garbage = await t.ask('sendTx', params(Uint8Array.from([0x0a, 0x05, 1])));
    expect(t.answerOf(garbage.id)).toMatchObject({ error: { code: 'invalid-request' } });
    const unsigned = await t.ask(
      'sendTx',
      params(txRawBytes({ bodyBytes: Uint8Array.from([1]), authInfoBytes: Uint8Array.from([2]), signatures: [] })),
    );
    expect(t.answerOf(unsigned.id)).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.node.broadcast).not.toHaveBeenCalled();
  });

  it('passes the nodes raw log on when it rejects the transaction', async () => {
    const t = await rig();
    await t.connect();
    t.node.broadcast.mockRejectedValueOnce(new BroadcastError(13, 'sdk', 'insufficient fee'));
    const a = await t.ask('sendTx', params());
    expect(t.answerOf(a.id)).toMatchObject({
      error: { code: 'invalid-request', message: 'insufficient fee' },
    });
  });

  it('refuses a node reply without a proper 32-byte hash', async () => {
    const t = await rig();
    await t.connect();
    for (const txHash of ['', 'zz', 'AB'.repeat(31), `${'AB'.repeat(31)}ZZ`]) {
      t.node.broadcast.mockResolvedValueOnce({ txHash });
      const a = await t.ask('sendTx', params());
      expect(t.answerOf(a.id)).toMatchObject({ error: { code: 'invalid-request' } });
    }
  });

  it('refuses a site that is not connected, and the wrong chain', async () => {
    const t = await rig();
    const a = await t.ask('sendTx', params());
    expect(t.answerOf(a.id)).toMatchObject({ error: { code: 'not-connected' } });
    const b = await t.ask('sendTx', { ...params(), chainId: NETWORKS.testnet.chainId });
    expect(t.answerOf(b.id)).toMatchObject({ error: { code: 'wrong-chain' } });
    expect(t.node.broadcast).not.toHaveBeenCalled();
  });

  it('answers locked-timeout at once for a fully locked wallet, without a window', async () => {
    const t = await rig();
    await t.connect();
    await t.wallet.lock();
    const windows = t.created.length;
    const a = await t.ask('sendTx', params());
    expect(t.answerOf(a.id)).toMatchObject({
      error: { code: 'locked-timeout', message: 'Unlock BeePocket' },
    });
    expect(t.created).toHaveLength(windows);
    expect(t.node.broadcast).not.toHaveBeenCalled();
  });

  it('still broadcasts in the weak lock: no key is needed', async () => {
    const t = await rig();
    await t.connect();
    await t.wallet.weakLock();
    const a = await t.ask('sendTx', params());
    expect(bytesFromWire(t.answerOf(a.id)?.result as string)).toHaveLength(32);
  });
});
