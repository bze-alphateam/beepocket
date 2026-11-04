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
  type FeeData,
  type FeeEstimate,
  type Random,
} from '@beepocket/core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Services } from '../background/services';
import { ChromeSessionStorage, ChromeStorage } from '../platform';
import { FakeArea } from '../platform/test-support';
import { FULL_LOCK_ALARM, WEAK_LOCK_ALARM } from '../features/wallet/alarms';
import { WalletService } from '../features/wallet/service';
import { AccountChanges } from './account-changes';
import { Deliverer } from './deliver';
import { DocumentLog } from './documents';
import { registerDappHandlers } from './handlers';
import type { ChainEnv } from './handlers/env';
import { DappRegistry } from './registry';
import { grantMsg, nothingMsg } from './test-support';
import { RequestStore } from './requests';
import { DappService } from './service';
import { SitesService } from './sites';
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
  // Known to the wallet, but no pool makes it a fee token.
  ufree: { symbol: 'FRE', decimals: 6 },
};

interface Node {
  account: { accountNumber: bigint; sequence: bigint; pubKey: null } | null;
  estimate: () => Promise<FeeEstimate>;
  balances: Map<string, bigint>;
  feeData: FeeData;
  broadcast: Mock<ChainClient['broadcast']>;
}

const FEES: FeeEstimate = {
  options: [
    { denom: 'ubze', amount: 2000n, gasLimit: 200_000n },
    // A fee in another token pays for its swap: a larger gas limit.
    { denom: 'uother', amount: 500n, gasLimit: 300_000n },
  ],
  default: 'ubze',
  gasUsed: 150_000n,
};

/** 0.01 ubze per gas; 6 ubze per uother at the pool's spot ratio. */
const FEE_DATA: FeeData = {
  nativeDenom: 'ubze',
  rates: new Map([
    ['ubze', { num: 1n, den: 100n }],
    ['uother', { num: 1n, den: 600n }],
  ]),
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
    balances: new Map([['ubze', 100_000_000n]]),
    feeData: FEE_DATA,
    broadcast: vi.fn<ChainClient['broadcast']>(() => Promise.resolve({ txHash: HASH })),
  };
  const env: ChainEnv = {
    network: NETWORKS.mainnet,
    chain: {
      account: () => Promise.resolve(node.account),
      balances: () => Promise.resolve(node.balances),
      broadcast: (bytes) => node.broadcast(bytes),
      markets: () => Promise.resolve([]),
      liquidityPools: () => Promise.resolve([]),
      marketOrder: () => Promise.resolve(null),
    },
    fees: { estimate: () => node.estimate(), feeData: () => Promise.resolve(node.feeData) },
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
              logo: null,
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
  const deliverer = new Deliverer({
    sendMessage: (_tab, message, options) => {
      delivered.push({ documentId: options?.documentId, message });
      return Promise.resolve();
    },
  });
  const documents = new DocumentLog(session);
  const changes = new AccountChanges({ documents, deliverer });
  const dapp = new DappService({
    registry,
    requests: new RequestStore(
      session,
      { set: () => Promise.resolve(), clear: () => Promise.resolve() },
      clock,
    ),
    window: new RequestWindow(
      {
        create: () => {
          created.push(1);
          open.add(created.length);
          return Promise.resolve({ id: created.length });
        },
        get: (id) => (open.has(id) ? Promise.resolve({}) : Promise.reject(new Error('gone'))),
        getLastFocused: () => Promise.resolve({}),
        update: () => Promise.resolve({}),
      },
      session,
    ),
    deliverer,
    documents,
    changes,
    sites: new SitesService({
      wallet,
      services,
      changes,
      tabs: { query: () => Promise.resolve([]) },
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
    delivered.map((d) => (d.message as { dapp: { id: string } }).dapp).find((m) => m.id === id) as
      { result?: unknown; error?: { code: string; message: string } } | undefined;
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
  /** The fee the site puts in the auth info; none (gas only) by default. */
  requestFee?: { coins: [string, bigint][]; gasLimit: bigint };
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
    fee: {
      amount: (options.requestFee?.coins ?? []).map(([denom, amount]) => ({
        denom,
        amount: amount.toString(),
      })),
      gasLimit: options.requestFee?.gasLimit ?? 1n,
    },
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

const feeFor = (view: { fee: { denom: string; amount: string; gasLimit: string } }) => ({
  denom: view.fee.denom,
  amount: view.fee.amount,
  gasLimit: view.fee.gasLimit,
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
    t.node.estimate = () => Promise.resolve({ options: [], default: null, gasUsed: 150_000n });
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
      locked: false,
      signer: { label: 'Main', address: MAIN.address },
      fee: { denom: 'ubze', amount: '2000', gasLimit: '200000', symbol: 'BZE' },
    });
    expect(r.view.summary.hero).toContain('1.00 BZE');
    expect(r.view.summary.memo).toBe('thanks');
    expect(r.view.options.map((o) => o.denom)).toEqual(['ubze', 'uother']);
    expect(JSON.parse(r.view.rawJson)).toHaveLength(1);
    expect(r.view.messageJson).toHaveLength(1);
    expect(JSON.parse(r.view.messageJson[0] ?? '')).toMatchObject({
      value: { toAddress: OTHER.address },
    });
  });

  it('signs the requests body untouched with the wallets own fee when the site set none', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    expect(r.view.siteFee).toBeUndefined();
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
    expect(other?.gasLimit).toBe('300000');
    // The native fee's gas limit does not pay for the swap: signing it is refused.
    expect(
      await t.dapp.answer(r.id, {
        approve: true,
        fee: { denom: 'uother', amount: '500', gasLimit: r.view.fee.gasLimit },
      }),
    ).toMatchObject({ ok: false, error: { code: 'review-changed' } });
    await t.dapp.answer(r.id, {
      approve: true,
      fee: { denom: 'uother', amount: '500', gasLimit: '300000' },
    });
    const { signed } = t.signedOf(r.id);
    expect(decodeAuthInfo(bytesFromWire(signed.authInfoBytes))).toMatchObject({
      fee: { amount: [{ denom: 'uother', amount: '500' }], gasLimit: '300000' },
    });
  });

  it('refuses a fee that is not what was reviewed and keeps the request waiting', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    const res = await t.dapp.answer(r.id, {
      approve: true,
      fee: { denom: 'ubze', amount: '1', gasLimit: r.view.fee.gasLimit },
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
        fee: { denom: 'unope', amount: '1', gasLimit: r.view.fee.gasLimit },
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

  it('shows an unknown message with its own raw JSON, and signs it on Approve', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, { messages: [nothingMsg()] });
    expect(r.view.summary.level).toBe('unknown');
    expect(r.view.messageJson[0]).toContain('/test.v1.MsgNothing');
    const res = await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(res.ok).toBe(true);
    expect(t.signedOf(r.id)).toBeDefined();
  });

  it('refuses a dangerous request without the tick and answers the page', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, {
      messages: [grantMsg(MAIN.address, OTHER.address, '/cosmos.bank.v1beta1.MsgSend')],
    });
    expect(r.view.summary.level).toBe('dangerous');
    expect(r.view.summary.messages[0]?.danger).not.toBeNull();
    const res = await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(res.ok).toBe(true);
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.signedOf(r.id)).toBeUndefined();
  });

  it('signs a dangerous request once the tick is sent', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, {
      messages: [grantMsg(MAIN.address, OTHER.address, '/cosmos.bank.v1beta1.MsgSend')],
    });
    const res = await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view), trusted: true });
    expect(res.ok).toBe(true);
    expect(t.signedOf(r.id)).toBeDefined();
  });

  it('lets the riskiest message decide when several are signed together', async () => {
    const t = await rig();
    await t.connect();
    const send = encodeMsgSend({
      fromAddress: MAIN.address,
      toAddress: OTHER.address,
      amount: [{ denom: 'ubze', amount: '1' }],
    });
    const r = await review(t, {
      messages: [send, grantMsg(MAIN.address, OTHER.address, '/cosmos.bank.v1beta1.MsgSend')],
    });
    expect(r.view.summary.level).toBe('dangerous');
    expect(r.view.summary.messages.map((m) => m.level)).toEqual(['normal', 'dangerous']);
    expect(r.view.messageJson).toHaveLength(2);
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
      params(
        txRawBytes({
          bodyBytes: Uint8Array.from([1]),
          authInfoBytes: Uint8Array.from([2]),
          signatures: [],
        }),
      ),
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

describe('a sign request waiting in the queue', () => {
  it('is skipped with not-connected when its site was disconnected before it reached the head', async () => {
    const t = await rig();
    await t.connect();
    const first = await t.ask('signDirect', request().params);
    const second = await t.ask('signDirect', request().params);
    expect(await t.dapp.current()).toMatchObject({ status: 'sign', id: first.id, count: 2 });

    await t.dapp.answer(first.id, { approve: false });
    expect(await t.dapp.sites.disconnect(ORIGIN)).toEqual({ ok: true, value: {} });
    expect(await t.dapp.current()).toEqual({ status: 'none' });
    expect(t.answerOf(second.id)).toMatchObject({ error: { code: 'not-connected' } });
  });
});

describe('signDirect with a fee the site set', () => {
  const site = (coins: [string, bigint][], gasLimit: bigint): DocOptions => ({
    requestFee: { coins, gasLimit },
  });
  const signedFee = (t: Rig, id: string) =>
    decodeAuthInfo(bytesFromWire(t.signedOf(id).signed.authInfoBytes)).fee;

  it('pre-selects the sites fee, offers it first on the sheet and signs exactly it', async () => {
    const t = await rig();
    await t.connect();
    // 250,000 gas at 0.01 needs 2,500 ubze; 5,000 is 2.5x the wallet's 2,000.
    const r = await review(t, site([['ubze', 5_000n]], 250_000n));
    expect(r.view.fee).toMatchObject({
      denom: 'ubze',
      amount: '5000',
      gasLimit: '250000',
      symbol: 'BZE',
      setBy: ORIGIN,
    });
    expect(r.view.siteFee).toEqual({ status: 'ok' });
    expect(r.view.options.map((o) => [o.denom, o.amount, o.setBy])).toEqual([
      ['ubze', '5000', ORIGIN],
      ['ubze', '2000', undefined],
      ['uother', '500', undefined],
    ]);
    expect((await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) })).ok).toBe(true);
    expect(signedFee(t, r.id)).toMatchObject({
      amount: [{ denom: 'ubze', amount: '5000' }],
      gasLimit: '250000',
    });
  });

  it('signs the wallets option in the same token when the user picks it instead', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, site([['ubze', 5_000n]], 250_000n));
    await t.dapp.answer(r.id, {
      approve: true,
      fee: { denom: 'ubze', amount: '2000', gasLimit: '200000' },
    });
    expect(signedFee(t, r.id)).toMatchObject({
      amount: [{ denom: 'ubze', amount: '2000' }],
      gasLimit: '200000',
    });
  });

  it('refuses the sites amount with another gas limit: only what was shown is signed', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, site([['ubze', 5_000n]], 250_000n));
    expect(
      await t.dapp.answer(r.id, {
        approve: true,
        fee: { denom: 'ubze', amount: '5000', gasLimit: '200000' },
      }),
    ).toMatchObject({ ok: false, error: { code: 'review-changed' } });
    expect(t.answerOf(r.id)).toBeUndefined();
  });

  it('warns about a fee below the chains minimum for its gas limit, and keeps it selected', async () => {
    const t = await rig();
    await t.connect();
    const at = await review(t, site([['ubze', 2_500n]], 250_000n));
    expect(at.view.siteFee).toEqual({ status: 'ok' });
    await t.dapp.answer(at.id, { approve: false });
    const below = await review(t, site([['ubze', 2_499n]], 250_000n));
    expect(below.view.siteFee).toEqual({ status: 'low' });
    expect(below.view.fee).toMatchObject({ amount: '2499', setBy: ORIGIN });
    await t.dapp.answer(below.id, { approve: true, fee: feeFor(below.view) });
    expect(signedFee(t, below.id)).toMatchObject({
      amount: [{ denom: 'ubze', amount: '2499' }],
      gasLimit: '250000',
    });
  });

  it('warns about a fee more than three times the wallets estimate, with the rounded ratio', async () => {
    const t = await rig();
    await t.connect();
    const three = await review(t, site([['ubze', 6_000n]], 200_000n));
    expect(three.view.siteFee).toEqual({ status: 'ok' });
    await t.dapp.answer(three.id, { approve: false });
    const over = await review(t, site([['ubze', 6_001n]], 200_000n));
    expect(over.view.siteFee).toEqual({ status: 'high', times: 3 });
    await t.dapp.answer(over.id, { approve: false });
    const many = await review(t, site([['ubze', 9_000n]], 200_000n));
    expect(many.view.siteFee).toEqual({ status: 'high', times: 5 });
    expect(many.view.fee).toMatchObject({ amount: '9000', setBy: ORIGIN });
  });

  it('warns about a gas limit below what the simulation used, even with fee to spare', async () => {
    const t = await rig();
    await t.connect();
    // The simulation used 150,000 gas.
    const below = await review(t, site([['ubze', 5_000n]], 149_999n));
    expect(below.view.siteFee).toEqual({ status: 'gas' });
    expect(below.view.fee).toMatchObject({ gasLimit: '149999', setBy: ORIGIN });
    await t.dapp.answer(below.id, { approve: false });
    const at = await review(t, site([['ubze', 1_500n]], 150_000n));
    expect(at.view.siteFee).toEqual({ status: 'ok' });
  });

  it('calls any fee high when the wallets own estimate is zero', async () => {
    const t = await rig();
    await t.connect();
    t.node.feeData = {
      nativeDenom: 'ubze',
      rates: new Map([['ubze', { num: 0n, den: 1n }]]),
    };
    t.node.estimate = () =>
      Promise.resolve({
        options: [{ denom: 'ubze', amount: 0n, gasLimit: 225_000n }],
        default: 'ubze',
        gasUsed: 150_000n,
      });
    const r = await review(t, site([['ubze', 1_000_000n]], 225_000n));
    expect(r.view.siteFee).toEqual({ status: 'high', times: null });
    expect(r.view.fee).toMatchObject({ amount: '1000000', setBy: ORIGIN });
  });

  it('checks a fee in another token at the spot ratio, without the wallets margin', async () => {
    const t = await rig();
    await t.connect();
    t.node.balances = new Map([
      ['ubze', 100_000_000n],
      ['uother', 10_000n],
    ]);
    // 300,000 gas is 3,000 ubze, 500 uother at 6 ubze each.
    const ok = await review(t, site([['uother', 500n]], 300_000n));
    expect(ok.view.siteFee).toEqual({ status: 'ok' });
    expect(ok.view.fee).toMatchObject({ denom: 'uother', symbol: 'OTH', setBy: ORIGIN });
    await t.dapp.answer(ok.id, { approve: true, fee: feeFor(ok.view) });
    expect(signedFee(t, ok.id)).toMatchObject({
      amount: [{ denom: 'uother', amount: '500' }],
      gasLimit: '300000',
    });
    const low = await review(t, site([['uother', 499n]], 300_000n));
    expect(low.view.siteFee).toEqual({ status: 'low' });
    await t.dapp.answer(low.id, { approve: false });
    // The wallet's own estimate in uother is 500.
    const high = await review(t, site([['uother', 2_000n]], 300_000n));
    expect(high.view.siteFee).toEqual({ status: 'high', times: 4 });
  });

  const unusable: [string, DocOptions, [string, bigint][]][] = [
    [
      'a token that cannot pay fees on BZE',
      site([['ufree', 100n]], 200_000n),
      [['ufree', 10n ** 9n]],
    ],
    ['a token the wallet cannot show', site([['unope', 100n]], 200_000n), [['unope', 10n ** 9n]]],
    ['more than the address holds', site([['uother', 600n]], 300_000n), [['uother', 599n]]],
    [
      'more than one coin',
      site(
        [
          ['ubze', 3_000n],
          ['uother', 1n],
        ],
        300_000n,
      ),
      [['uother', 10n]],
    ],
  ];
  for (const [name, options, held] of unusable) {
    it(`falls back to the wallets own fee for ${name}`, async () => {
      const t = await rig();
      await t.connect();
      t.node.balances = new Map([['ubze', 100_000_000n], ...held]);
      const r = await review(t, options);
      expect(r.view.siteFee).toEqual({ status: 'unusable' });
      expect(r.view.fee).toMatchObject({ denom: 'ubze', amount: '2000', gasLimit: '200000' });
      expect(r.view.fee.setBy).toBeUndefined();
      expect(r.view.options.every((o) => o.setBy === undefined)).toBe(true);
      await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
      expect(signedFee(t, r.id)).toMatchObject({
        amount: [{ denom: 'ubze', amount: '2000' }],
        gasLimit: '200000',
      });
    });
  }

  it('treats a zero fee like no fee', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, site([['ubze', 0n]], 200_000n));
    expect(r.view.siteFee).toBeUndefined();
    expect(r.view.fee).toMatchObject({ denom: 'ubze', amount: '2000', gasLimit: '200000' });
    expect(r.view.options).toHaveLength(2);
  });

  it('signs a usable site fee even when the wallets own options are all out of reach', async () => {
    const t = await rig();
    await t.connect();
    t.node.estimate = () => Promise.resolve({ options: [], default: null, gasUsed: 150_000n });
    const r = await review(t, site([['ubze', 2_500n]], 250_000n));
    expect(r.view.options).toHaveLength(1);
    expect(r.view.siteFee).toEqual({ status: 'ok' });
    await t.dapp.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(signedFee(t, r.id)).toMatchObject({ amount: [{ denom: 'ubze', amount: '2500' }] });
  });
});

describe('signDirect with Advanced gas limit and price', () => {
  const site = (coins: [string, bigint][], gasLimit: bigint): DocOptions => ({
    requestFee: { coins, gasLimit },
  });
  const signedFee = (t: Rig, id: string) =>
    decodeAuthInfo(bytesFromWire(t.signedOf(id).signed.authInfoBytes)).fee;
  // The rig simulates 150,000 gas at 0.01 ubze per gas: the BZE bounds are 150,000 (the
  // simulation), 225,000 (the estimate) and 2,250,000 (ten times it).
  const custom = (amount: string, gasLimit: string, gasPrice: 1 | 2 | 3 = 1) => ({
    denom: 'ubze',
    amount,
    gasLimit,
    override: { gasLimit, gasPrice },
  });

  it('gives the screen what Advanced needs: the simulation, pricing and balances', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    expect(r.view.gasUsed).toBe('150000');
    expect(r.view.options[0]).toMatchObject({
      denom: 'ubze',
      balance: '100000000',
      pricing: { native: true, nativePrice: { num: '1', den: '100' } },
    });
  });

  it('signs the settings when they price to exactly the reviewed fee', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    // 300,000 gas x 0.02 = 6,000 ubze.
    const res = await t.dapp.answer(r.id, { approve: true, fee: custom('6000', '300000', 2) });
    expect(res.ok).toBe(true);
    expect(signedFee(t, r.id)).toEqual({
      amount: [{ denom: 'ubze', amount: '6000' }],
      gasLimit: '300000',
      payer: '',
      granter: '',
    });
  });

  it('allows a limit between the simulation and the estimate', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    await t.dapp.answer(r.id, { approve: true, fee: custom('1500', '150000') });
    expect(signedFee(t, r.id)).toMatchObject({ gasLimit: '150000' });
  });

  it('refuses settings that do not price to the fee, or fall outside the bounds or the balance', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    const refused = [
      custom('5999', '300000', 2),
      custom('6000', '300000', 3),
      // One below the simulation and one above ten times the estimate, both priced right.
      custom('1500', '149999'),
      custom('22501', '2250001'),
      { ...custom('6000', '300000', 2), gasLimit: '300001' },
      { ...custom('6000', '300000', 2), denom: 'ufree' },
    ];
    for (const fee of refused) {
      expect(await t.dapp.answer(r.id, { approve: true, fee })).toMatchObject({
        ok: false,
        error: { code: 'review-changed' },
      });
    }
    t.node.balances = new Map([['ubze', 5_999n]]);
    expect(
      await t.dapp.answer(r.id, { approve: true, fee: custom('6000', '300000', 2) }),
    ).toMatchObject({ ok: false, error: { code: 'review-changed' } });
  });

  it("replaces a site's fee with one priced for the user's settings", async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, site([['ubze', 1_200n]], 120_000n));
    expect(r.view.siteFee).toEqual({ status: 'gas' });
    await t.dapp.answer(r.id, { approve: true, fee: custom('2250', '225000') });
    expect(signedFee(t, r.id)).toEqual({
      amount: [{ denom: 'ubze', amount: '2250' }],
      gasLimit: '225000',
      payer: '',
      granter: '',
    });
  });
});
