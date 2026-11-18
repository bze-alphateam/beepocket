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
  RestChainClient,
  SimulationError,
  signDocBytes,
  txRawBytes,
  Vault,
  WebCryptoCipher,
  withSignal,
  type ChainClient,
  type EstimateParams,
  type FeeData,
  type FeeEstimate,
  type HttpRequest,
  type HttpTransport,
  type Random,
  type ScanClient,
} from '@beepocket/core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import type { Services } from '../background/services';
import { ChromeSessionStorage, ChromeStorage, StorageCache } from '../platform';
import { FakeArea, itemBytes } from '../platform/test-support';
import { createTokenResolver } from '../features/tokens/resolver';
import { FULL_LOCK_ALARM, WEAK_LOCK_ALARM } from '../features/wallet/alarms';
import { WalletService } from '../features/wallet/service';
import { AccountChanges } from './account-changes';
import { Deliverer } from './deliver';
import { DocumentLog } from './documents';
import { registerDappHandlers } from './handlers';
import type { ChainEnv } from './handlers/env';
import { DappRegistry, type UserAnswer } from './registry';
import { execMsg, grantMsg, nothingMsg, sendGrantMsg, vestingMsg } from './test-support';
import { MAX_PER_ORIGIN, MAX_PREPARING, RequestStore } from './requests';
import { Cancellations } from './cancellations';
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
  /** What each estimate was asked for. */
  estimates: EstimateParams[];
  balances: Map<string, bigint>;
  feeData: FeeData;
  broadcast: Mock<ChainClient['broadcast']>;
  /** When set, requests reach the node through this transport instead of the canned answers. */
  transport: HttpTransport | null;
}

/** The simulation with a BZE fee used 150,000 gas, the one with a fee in another token 200,000. */
const FEES: FeeEstimate = {
  options: [
    { denom: 'ubze', amount: 2000n, gasLimit: 200_000n, gasUsed: 150_000n },
    // A fee in another token has its own simulation: a larger gas limit.
    { denom: 'uother', amount: 500n, gasLimit: 300_000n, gasUsed: 200_000n },
  ],
  default: 'ubze',
  simulated: { native: 150_000n, foreign: 200_000n },
};

const NO_OPTIONS: FeeEstimate = {
  options: [],
  default: null,
  simulated: { native: 150_000n, foreign: null },
};

/** 0.01 ubze per gas; 6 ubze per uother at the pool's spot ratio. */
const FEE_DATA: FeeData = {
  nativeDenom: 'ubze',
  rates: new Map([
    ['ubze', { num: 1n, den: 100n }],
    ['uother', { num: 1n, den: 600n }],
  ]),
};

async function rig(options: { local?: FakeArea } = {}) {
  const local = options.local ?? new FakeArea();
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
    estimates: [],
    balances: new Map([['ubze', 100_000_000n]]),
    feeData: FEE_DATA,
    broadcast: vi.fn<ChainClient['broadcast']>(() => Promise.resolve({ txHash: HASH })),
    transport: null,
  };
  const env: ChainEnv = {
    network: NETWORKS.mainnet,
    chain: {
      account: () => Promise.resolve(node.account),
      balances: () => Promise.resolve(node.balances),
      balance: (_address, denom) => Promise.resolve(node.balances.get(denom) ?? 0n),
      broadcast: (bytes) => node.broadcast(bytes),
      markets: () => Promise.resolve([]),
      liquidityPools: () => Promise.resolve([]),
      marketOrder: () => Promise.resolve(null),
    },
    fees: {
      estimate: (params) => {
        node.estimates.push(params);
        return node.estimate();
      },
      feeData: () => Promise.resolve(node.feeData),
    },
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
  const cancellations = new Cancellations(session, clock);
  registerDappHandlers(registry, {
    wallet,
    services,
    clock,
    env: (signal) => {
      const { transport } = node;
      if (!transport) return Promise.resolve(env);
      const wired = signal ? withSignal(transport, signal) : transport;
      return Promise.resolve({ ...env, chain: new RestChainClient(wired, NETWORKS.mainnet) });
    },
    cancelled: cancellations,
  });
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
    cancellations,
    clock,
  });

  let n = 0;
  const from: DappSender = { origin: ORIGIN, tabId: 1, documentId: 'doc-1' };
  const ask = async (method: string, params: unknown, sender: DappSender = from) => {
    const id = (++n).toString(16).padStart(32, '0');
    const received = await dapp.receive(sender, { id, method, params });
    await received.after();
    return { id, ack: received.ack };
  };
  const answerOf = (id: string) =>
    delivered.map((d) => (d.message as { dapp: { id: string } }).dapp).find((m) => m.id === id) as
      { result?: unknown; error?: { code: string; message: string } } | undefined;
  const signedOf = (id: string) => answerOf(id)?.result as SignedAnswer;

  /**
   * The window's answer to the request at the head of the queue, naming it as the window does:
   * its id, the ticket it was shown with and, for a connect, its site.
   */
  const answer = async (id: string, user: Omit<UserAnswer, 'ticket'>) => {
    const { head, headId, headTicket } = await dapp.queue();
    const named = headId === id;
    return dapp.answer(id, {
      ticket: named ? (headTicket ?? '') : '',
      ...(named && head !== null ? { origin: head } : {}),
      ...user,
    });
  };

  await wallet.createWallet(PASSWORD, PHRASE);
  await wallet.deriveNext();
  const connect = async (sender: DappSender = from) => {
    const a = await ask('connect', { chainId: CHAIN_ID }, sender);
    await dapp.current();
    await answer(a.id, { approve: true, index: 0 });
  };
  return {
    wallet,
    dapp,
    answer,
    from,
    clock,
    ask,
    answerOf,
    signedOf,
    node,
    env,
    alarms,
    created,
    delivered,
    connect,
  };
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
    t.node.estimate = () => Promise.resolve(NO_OPTIONS);
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
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
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
      await t.answer(r.id, {
        approve: true,
        fee: { denom: 'uother', amount: '500', gasLimit: r.view.fee.gasLimit },
      }),
    ).toMatchObject({ ok: false, error: { code: 'review-changed' } });
    await t.answer(r.id, {
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
    const res = await t.answer(r.id, {
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
    expect(await t.answer(r.id, { approve: true })).toMatchObject({ ok: false });
    expect(
      await t.answer(r.id, {
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
    await t.answer(r.id, { approve: false });
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'rejected' } });
  });

  it('re-arms both lock timers after signing', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    t.alarms.length = 0;
    await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(t.alarms).toEqual(expect.arrayContaining([WEAK_LOCK_ALARM, FULL_LOCK_ALARM]));
  });

  it('shows an unknown message with its own raw JSON, and signs it only with the tick', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, { messages: [nothingMsg()] });
    expect(r.view.summary.level).toBe('unknown');
    expect(r.view.messageJson[0]).toContain('/test.v1.MsgNothing');
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view), trusted: true });
    expect(res.ok).toBe(true);
    expect(t.signedOf(r.id)).toBeDefined();
  });

  it('refuses a message it cannot read without the tick, even when the screen is bypassed', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, { messages: [nothingMsg()] });
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(res.ok).toBe(true);
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.signedOf(r.id)).toBeUndefined();
  });

  it('refuses a send next to a message it cannot read without the tick', async () => {
    const t = await rig();
    await t.connect();
    const send = encodeMsgSend({
      fromAddress: MAIN.address,
      toAddress: OTHER.address,
      amount: [{ denom: 'ubze', amount: '1' }],
    });
    const r = await review(t, { messages: [send, nothingMsg()] });
    expect(r.view.summary.level).toBe('unknown');
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view), trusted: false });
    expect(res.ok).toBe(true);
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.signedOf(r.id)).toBeUndefined();
  });

  it('refuses an exec of a message it cannot read without the tick', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, { messages: [execMsg(MAIN.address, nothingMsg())] });
    expect(r.view.summary.level).toBe('dangerous');
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(res.ok).toBe(true);
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.signedOf(r.id)).toBeUndefined();
  });

  it('does not sign a vesting account for another address on a plain Approve', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, {
      messages: [vestingMsg(MAIN.address, OTHER.address, '1000000000000')],
    });
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(res.ok).toBe(true);
    expect(t.answerOf(r.id)).toMatchObject({ error: { code: 'invalid-request' } });
    expect(t.signedOf(r.id)).toBeUndefined();
  });

  it('refuses a dangerous request without the tick and answers the page', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, {
      messages: [grantMsg(MAIN.address, OTHER.address, '/cosmos.bank.v1beta1.MsgSend')],
    });
    expect(r.view.summary.level).toBe('dangerous');
    expect(r.view.summary.messages[0]?.danger).not.toBeNull();
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
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
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view), trusted: true });
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
    const res = await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
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
    await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
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

    const early = await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(early).toMatchObject({ ok: false, error: { code: 'needs-password' } });
    expect(t.answerOf(r.id)).toBeUndefined();

    const wrong = await t.wallet.reauth('not the password');
    expect(wrong).toMatchObject({ ok: true, value: { status: 'wrong-password' } });
    expect(await t.dapp.current()).toMatchObject({ status: 'sign', locked: true });

    const right = await t.wallet.reauth(PASSWORD);
    expect(right).toMatchObject({ ok: true, value: { status: 'ok' } });
    const view = await t.dapp.current();
    expect(view).toMatchObject({ status: 'sign', locked: false });
    await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
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

  it('broadcasts nothing for a request that arrives after the page gave up on it', async () => {
    const t = await rig();
    await t.connect();
    const received = await t.dapp.receive(t.from, {
      id: 'e'.repeat(32),
      method: 'sendTx',
      params: params(),
      sentAt: t.clock.now() - 10_000,
    });
    expect(received.ack).toEqual({
      error: { code: 'unavailable', message: 'BeePocket is not responding. Reload this page.' },
    });
    await received.after();
    expect(t.node.broadcast).not.toHaveBeenCalled();
    expect(t.answerOf('e'.repeat(32))).toBeUndefined();
  });

  it('broadcasts nothing when the page cancels before the broadcast', async () => {
    const t = await rig();
    await t.connect();
    const id = 'e'.repeat(32);
    const received = await t.dapp.receive(t.from, {
      id,
      method: 'sendTx',
      params: params(),
      sentAt: t.clock.now(),
    });
    expect(received.ack).toEqual({ accepted: true });
    // The page's ack timer ran out first: its cancel is handled before the request is.
    const cancel = await t.dapp.receive(t.from, { id, cancel: true });
    await cancel.after();
    await received.after();
    expect(t.node.broadcast).not.toHaveBeenCalled();
    expect(t.answerOf(id)).toBeUndefined();
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

    await t.answer(first.id, { approve: false });
    expect(await t.dapp.sites.disconnect(ORIGIN, 'mainnet')).toEqual({ ok: true, value: {} });
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
    expect((await t.answer(r.id, { approve: true, fee: feeFor(r.view) })).ok).toBe(true);
    expect(signedFee(t, r.id)).toMatchObject({
      amount: [{ denom: 'ubze', amount: '5000' }],
      gasLimit: '250000',
    });
  });

  it('signs the wallets option in the same token when the user picks it instead', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, site([['ubze', 5_000n]], 250_000n));
    await t.answer(r.id, {
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
      await t.answer(r.id, {
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
    await t.answer(at.id, { approve: false });
    const below = await review(t, site([['ubze', 2_499n]], 250_000n));
    expect(below.view.siteFee).toEqual({ status: 'low' });
    expect(below.view.fee).toMatchObject({ amount: '2499', setBy: ORIGIN });
    await t.answer(below.id, { approve: true, fee: feeFor(below.view) });
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
    await t.answer(three.id, { approve: false });
    const over = await review(t, site([['ubze', 6_001n]], 200_000n));
    expect(over.view.siteFee).toEqual({ status: 'high', times: 3 });
    await t.answer(over.id, { approve: false });
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
    await t.answer(below.id, { approve: false });
    const at = await review(t, site([['ubze', 1_500n]], 150_000n));
    expect(at.view.siteFee).toEqual({ status: 'ok' });
  });

  it('checks the gas of a fee in another token against the simulation in another token', async () => {
    const t = await rig();
    await t.connect();
    t.node.balances = new Map([
      ['ubze', 100_000_000n],
      ['uother', 10_000n],
    ]);
    // Above the BZE simulation (150,000) but below the one in another token (200,000).
    const below = await review(t, site([['uother', 400n]], 180_000n));
    expect(below.view.siteFee).toEqual({ status: 'gas' });
    expect(below.view.fee).toMatchObject({ denom: 'uother', gasUsed: '200000', setBy: ORIGIN });
    // The site's token is the one the estimate simulates a fee in another token with.
    expect(t.node.estimates.at(-1)?.preferred).toBe('uother');
    await t.answer(below.id, { approve: false });
    const at = await review(t, site([['uother', 400n]], 200_000n));
    expect(at.view.siteFee).toEqual({ status: 'ok' });
    await t.answer(at.id, { approve: false });
    // A BZE fee is still checked against the BZE simulation.
    const bze = await review(t, site([['ubze', 1_800n]], 180_000n));
    expect(bze.view.siteFee).toEqual({ status: 'ok' });
    expect(bze.view.fee).toMatchObject({ gasUsed: '150000' });
  });

  it('drops a site fee in another token when no simulation in another token passed', async () => {
    const t = await rig();
    await t.connect();
    t.node.balances = new Map([
      ['ubze', 100_000_000n],
      ['uother', 10_000n],
    ]);
    t.node.estimate = () =>
      Promise.resolve({
        ...FEES,
        options: FEES.options.slice(0, 1),
        simulated: { native: 150_000n, foreign: null },
      });
    // Enough gas for the BZE simulation, but nothing measured a fee in another token.
    const r = await review(t, site([['uother', 400n]], 180_000n));
    expect(r.view.siteFee).toEqual({ status: 'unusable' });
    expect(r.view.fee).toMatchObject({ denom: 'ubze', amount: '2000', gasLimit: '200000' });
    expect(r.view.options.every((o) => o.setBy === undefined)).toBe(true);
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
        options: [{ denom: 'ubze', amount: 0n, gasLimit: 225_000n, gasUsed: 150_000n }],
        default: 'ubze',
        simulated: { native: 150_000n, foreign: null },
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
    await t.answer(ok.id, { approve: true, fee: feeFor(ok.view) });
    expect(signedFee(t, ok.id)).toMatchObject({
      amount: [{ denom: 'uother', amount: '500' }],
      gasLimit: '300000',
    });
    const low = await review(t, site([['uother', 499n]], 300_000n));
    expect(low.view.siteFee).toEqual({ status: 'low' });
    await t.answer(low.id, { approve: false });
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
      await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
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
    t.node.estimate = () => Promise.resolve(NO_OPTIONS);
    const r = await review(t, site([['ubze', 2_500n]], 250_000n));
    expect(r.view.options).toHaveLength(1);
    expect(r.view.siteFee).toEqual({ status: 'ok' });
    await t.answer(r.id, { approve: true, fee: feeFor(r.view) });
    expect(signedFee(t, r.id)).toMatchObject({ amount: [{ denom: 'ubze', amount: '2500' }] });
  });
});

describe('signDirect with Advanced gas limit and price', () => {
  const site = (coins: [string, bigint][], gasLimit: bigint): DocOptions => ({
    requestFee: { coins, gasLimit },
  });
  const signedFee = (t: Rig, id: string) =>
    decodeAuthInfo(bytesFromWire(t.signedOf(id).signed.authInfoBytes)).fee;
  // The rig simulates 150,000 gas with a BZE fee at 0.01 ubze per gas: the BZE bounds are
  // 150,000 (the simulation), 180,000 (the estimate) and 1,800,000 (ten times it).
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
    expect(r.view.options[0]).toMatchObject({
      denom: 'ubze',
      gasUsed: '150000',
      balance: '100000000',
      pricing: { native: true, nativePrice: { num: '1', den: '100' } },
    });
  });

  it('signs the settings when they price to exactly the reviewed fee', async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t);
    // 300,000 gas x 0.02 = 6,000 ubze.
    const res = await t.answer(r.id, { approve: true, fee: custom('6000', '300000', 2) });
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
    await t.answer(r.id, { approve: true, fee: custom('1500', '150000') });
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
      custom('18001', '1800001'),
      { ...custom('6000', '300000', 2), gasLimit: '300001' },
      { ...custom('6000', '300000', 2), denom: 'ufree' },
    ];
    for (const fee of refused) {
      expect(await t.answer(r.id, { approve: true, fee })).toMatchObject({
        ok: false,
        error: { code: 'review-changed' },
      });
    }
    t.node.balances = new Map([['ubze', 5_999n]]);
    expect(await t.answer(r.id, { approve: true, fee: custom('6000', '300000', 2) })).toMatchObject(
      { ok: false, error: { code: 'review-changed' } },
    );
  });

  it("replaces a site's fee with one priced for the user's settings", async () => {
    const t = await rig();
    await t.connect();
    const r = await review(t, site([['ubze', 1_200n]], 120_000n));
    expect(r.view.siteFee).toEqual({ status: 'gas' });
    await t.answer(r.id, { approve: true, fee: custom('2250', '225000') });
    expect(signedFee(t, r.id)).toEqual({
      amount: [{ denom: 'ubze', amount: '2250' }],
      gasLimit: '225000',
      payer: '',
      granter: '',
    });
  });

  it('bounds settings for a fee in another token by the simulation in another token', async () => {
    const t = await rig();
    await t.connect();
    t.node.balances = new Map([
      ['ubze', 100_000_000n],
      ['uother', 10_000n],
    ]);
    const r = await review(t);
    // 200,000 gas is 2,000 ubze, 333.3 uother at 6 ubze each, 367 with the 10% margin; one gas
    // less prices the same but is below the simulation in another token.
    const fee = (gasLimit: string) => ({ ...custom('367', gasLimit), denom: 'uother' });
    expect(await t.answer(r.id, { approve: true, fee: fee('199999') })).toMatchObject({
      ok: false,
      error: { code: 'review-changed' },
    });
    expect((await t.answer(r.id, { approve: true, fee: fee('200000') })).ok).toBe(true);
    expect(signedFee(t, r.id)).toMatchObject({
      amount: [{ denom: 'uother', amount: '367' }],
      gasLimit: '200000',
    });
  });
});

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('an approval is bound to the request on screen', () => {
  const ID = 'a1'.repeat(16);
  const pageA: DappSender = { origin: ORIGIN, tabId: 1, documentId: 'doc-a' };
  const pageB: DappSender = { origin: ORIGIN, tabId: 2, documentId: 'doc-b' };
  const SITE_FEE = { coins: [['ubze', 3000n]] as [string, bigint][], gasLimit: 200_000n };
  const small = () => request({ requestFee: SITE_FEE });
  const large = () =>
    request({
      requestFee: SITE_FEE,
      messages: [
        encodeMsgSend({
          fromAddress: MAIN.address,
          toAddress: OTHER.address,
          amount: [{ denom: 'ubze', amount: '90000000' }],
        }),
      ],
    });

  /** Well-formed ids no page sent. */
  const junk = (i: number) => (i + 1).toString(16).padStart(32, 'f');
  const send = async (t: Rig, from: DappSender, id: string, params: unknown) => {
    const received = await t.dapp.receive(from, { id, method: 'signDirect', params });
    await received.after();
  };
  const cancel = async (t: Rig, from: DappSender, id: string) => {
    const received = await t.dapp.receive(from, { id, cancel: true });
    await received.after();
  };
  /** Every signed answer any page received, as the body bytes that were signed. */
  const signedBodies = (t: Rig) =>
    t.delivered
      .map((d) => (d.message as { dapp: { result?: { signed?: { bodyBytes: string } } } }).dapp)
      .flatMap((m) => (m.result?.signed ? [bytesFromWire(m.result.signed.bodyBytes)] : []));
  const answersTo = (t: Rig, documentId: string) =>
    t.delivered
      .filter((d) => d.documentId === documentId)
      .map((d) => (d.message as { dapp: { id: string; error?: { message: string } } }).dapp);
  const reviewOn = async (t: Rig) => {
    const view = await t.dapp.current();
    if (view.status !== 'sign') throw new Error(`expected the sign screen, got ${view.status}`);
    return view;
  };

  it.each([
    ['cancelled, then sent again from another tab', 'cancel', pageB],
    ['cancelled, then sent again by the same page after many cancels', 'flood', pageA],
    ['its tab closed, then sent again from another tab', 'tab', pageB],
  ] as const)('signs nothing when the request on screen is %s', async (_name, removal, again) => {
    const t = await rig();
    await t.connect();
    const shown = small();
    await send(t, pageA, ID, shown.params);
    const view = await reviewOn(t);
    expect(view.summary.hero).toContain('1.00 BZE');

    if (removal === 'tab') {
      await t.dapp.onTabRemoved(pageA.tabId);
    } else {
      await cancel(t, pageA, ID);
      if (removal === 'flood') {
        for (let i = 0; i < 100; i++) await cancel(t, pageA, junk(i));
      }
    }
    await send(t, again, ID, large().params);

    const res = await t.dapp.answer(ID, {
      approve: true,
      fee: feeFor(view),
      ticket: view.ticket,
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'unknown-request' } });
    expect(signedBodies(t)).toEqual([]);
    expect(answersTo(t, again.documentId).at(-1)).toMatchObject({
      id: ID,
      error: { message: 'Duplicate request.' },
    });
    expect((await t.dapp.queue()).count).toBe(0);
  });

  it('refuses an approval for another instance of the request than the one on screen', async () => {
    const t = await rig();
    await t.connect();
    await send(t, pageA, ID, small().params);
    const view = await reviewOn(t);
    const res = await t.dapp.answer(ID, {
      approve: true,
      fee: feeFor(view),
      ticket: `${view.ticket}-other`,
    });
    expect(res).toMatchObject({ ok: false, error: { code: 'unknown-request' } });
    expect(signedBodies(t)).toEqual([]);
    expect(await t.dapp.current()).toMatchObject({ status: 'sign', id: ID });
  });

  it('refuses the same id sent again while its approval is being completed', async () => {
    const t = await rig();
    await t.connect();
    const shown = small();
    await send(t, pageA, ID, shown.params);
    const view = await reviewOn(t);
    const gate = deferred();
    let held = false;
    t.node.estimate = () => {
      if (held) return Promise.resolve(FEES);
      held = true;
      return gate.promise.then(() => FEES);
    };
    const approving = t.dapp.answer(ID, {
      approve: true,
      fee: feeFor(view),
      ticket: view.ticket,
    });
    await vi.waitFor(() => {
      expect(held).toBe(true);
    });
    await send(t, pageA, ID, large().params);
    gate.resolve();
    expect(await approving).toEqual({ ok: true, value: {} });

    expect(await t.dapp.queue()).toMatchObject({ count: 0 });
    expect((await t.dapp.queue()).headId).toBeUndefined();
    const second = await t.dapp.answer(ID, {
      approve: true,
      fee: feeFor(view),
      ticket: view.ticket,
    });
    expect(second).toMatchObject({ ok: false, error: { code: 'unknown-request' } });
    expect(signedBodies(t)).toEqual([shown.bodyBytes]);
  });

  it('keeps the reviewed request, and signs only it, when its signing fails while the id is sent again', async () => {
    const t = await rig();
    await t.connect();
    const shown = small();
    const swapped = large();
    await send(t, pageA, ID, shown.params);
    const view = await reviewOn(t);
    const gate = deferred();
    let held = false;
    t.node.estimate = () => {
      if (held) return Promise.resolve(FEES);
      held = true;
      return gate.promise.then(() => FEES);
    };
    vi.spyOn(t.wallet, 'signDirect').mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal', message: 'The wallet could not sign.' },
    });
    const approving = t.dapp.answer(ID, {
      approve: true,
      fee: feeFor(view),
      ticket: view.ticket,
    });
    await vi.waitFor(() => {
      expect(held).toBe(true);
    });
    await send(t, pageA, ID, swapped.params);
    gate.resolve();
    expect(await approving).toMatchObject({ ok: false, error: { code: 'internal' } });

    // The reviewed request is still the one waiting, with what the user read.
    const again = await reviewOn(t);
    expect(again.summary.hero).toContain('1.00 BZE');
    expect(again).toMatchObject({ id: ID, ticket: view.ticket });
    expect(answersTo(t, pageA.documentId).at(-1)).toMatchObject({
      id: ID,
      error: { message: 'Duplicate request.' },
    });

    await t.dapp.answer(ID, { approve: true, fee: feeFor(again), ticket: again.ticket });
    expect(signedBodies(t)).toEqual([shown.bodyBytes]);
    expect(signedBodies(t)).not.toContainEqual(swapped.bodyBytes);
  });

  it('broadcasts nothing that its page cancelled, whatever another page cancels meanwhile', async () => {
    const t = await rig();
    await t.connect();
    const id = 'e'.repeat(32);
    const received = await t.dapp.receive(pageA, {
      id,
      method: 'sendTx',
      params: {
        chainId: CHAIN_ID,
        txBytes: bytesToWire(
          txRawBytes({
            bodyBytes: Uint8Array.from([1]),
            authInfoBytes: Uint8Array.from([2]),
            signatures: [new Uint8Array(64).fill(1)],
          }),
        ),
        mode: 'sync',
      },
      sentAt: t.clock.now(),
    });
    await cancel(t, pageA, id);
    for (let i = 0; i < 100; i++) await cancel(t, pageB, junk(i));
    await received.after();
    expect(t.node.broadcast).not.toHaveBeenCalled();
    expect(t.answerOf(id)).toBeUndefined();
  });

  it('broadcasts nothing that its page cancels while the request is being handled', async () => {
    const t = await rig();
    await t.connect();
    const id = 'e'.repeat(32);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const profile = await t.wallet.getProfile();
    const slow = vi
      .spyOn(t.wallet, 'getProfile')
      .mockImplementationOnce(() => gate.then(() => profile));
    const received = await t.dapp.receive(pageA, {
      id,
      method: 'sendTx',
      params: {
        chainId: CHAIN_ID,
        txBytes: bytesToWire(
          txRawBytes({
            bodyBytes: Uint8Array.from([1]),
            authInfoBytes: Uint8Array.from([2]),
            signatures: [new Uint8Array(64).fill(1)],
          }),
        ),
        mode: 'sync',
      },
      sentAt: t.clock.now(),
    });
    const handling = received.after();
    await vi.waitFor(() => {
      expect(slow).toHaveBeenCalled();
    });
    await cancel(t, pageA, id);
    release();
    await handling;
    expect(t.node.broadcast).not.toHaveBeenCalled();
    expect(t.answerOf(id)).toBeUndefined();
  });
});

describe('token lookups of sign requests', () => {
  const CACHE_BYTES = 32 * 1024;
  const cacheBytes = (area: FakeArea) =>
    [...area.data]
      .filter(([key]) => key.startsWith('cache:'))
      .reduce((n, [key, value]) => n + itemBytes(key, value), 0);

  it('keep the token cache bounded, so the wallet can still store its own data', async () => {
    const local = new FakeArea({ quotaBytes: 256 * 1024 });
    const t = await rig({ local });
    await t.connect();
    // Every denom is known to the chain, so each lookup is worth keeping.
    const chain = {
      denomMetadata: () =>
        Promise.resolve({
          name: 'Token',
          symbol: 'TKN',
          display: 'TKN',
          exponent: 6,
          description: '',
        }),
      denomBranding: () => Promise.resolve(null),
    } as unknown as ChainClient;
    const scan = {
      asset: () => Promise.resolve(null),
      token: () => Promise.resolve(null),
    } as unknown as ScanClient;
    const cache = new StorageCache(new ChromeStorage(local), t.clock, {
      maxBytes: CACHE_BYTES,
      reserveBytes: 16 * 1024,
    });
    t.env.tokens = createTokenResolver({ chain, scan, cache }, 'mainnet');

    for (let r = 0; r < 20; r++) {
      const spendLimit = Array.from({ length: 100 }, (_, i): [string, string] => [
        `factory/${MAIN.address}/r${String(r)}d${String(i)}`,
        '1',
      ]);
      const a = await t.ask(
        'signDirect',
        request({
          messages: [sendGrantMsg(MAIN.address, OTHER.address, spendLimit)],
          requestFee: {
            coins: [[`factory/${MAIN.address}/fee${String(r)}`, 5000n]],
            gasLimit: 300_000n,
          },
        }).params,
      );
      // Each one is rejected, so the next one is prepared as well.
      await t.answer(a.id, { approve: false });
    }

    expect(cacheBytes(local)).toBeGreaterThan(0);
    expect(cacheBytes(local)).toBeLessThanOrEqual(CACHE_BYTES);
    // The profile and the password throttle can still be written.
    expect((await t.wallet.deriveNext()).ok).toBe(true);
    await t.wallet.lock();
    expect(await t.wallet.unlock('not the password')).toEqual({
      ok: true,
      value: { status: 'wrong-password', retryAt: null },
    });
    expect(local.data.get('throttle')).toMatchObject({ failures: 1 });
  });
});

/** A node that never answers: each request waits until its signal aborts. */
function silentNode() {
  const requests: HttpRequest[] = [];
  const aborted: HttpRequest[] = [];
  const transport: HttpTransport = {
    request(req) {
      requests.push(req);
      return new Promise((_, reject) => {
        req.signal?.addEventListener(
          'abort',
          () => {
            aborted.push(req);
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
    },
  };
  const accountReads = () =>
    requests.filter((r) => r.url.includes('/cosmos/auth/v1beta1/accounts/'));
  return { transport, requests, aborted, accountReads };
}

describe('sign requests being prepared', () => {
  const idOf = (i: number) => (0x1000 + i).toString(16).padStart(32, '0');
  const TOO_MANY = 'Too many requests waiting';

  it('reach the node at most a site share at a time; the rest are refused', async () => {
    const t = await rig();
    await t.connect();
    const node = silentNode();
    t.node.transport = node.transport;
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = idOf(i);
      const received = await t.dapp.receive(t.from, {
        id,
        method: 'signDirect',
        params: request().params,
      });
      expect(received.ack).toEqual({ accepted: true });
      ids.push(id);
      // Never awaited: the requests that reach the node wait on it for good.
      void received.after();
    }
    await vi.waitFor(() => {
      const refused = ids.filter((id) => t.answerOf(id)?.error?.message === TOO_MANY);
      expect(refused).toHaveLength(50 - MAX_PER_ORIGIN);
    });
    expect(node.accountReads()).toHaveLength(MAX_PER_ORIGIN);
  });

  it('count together with the site requests already waiting in the queue', async () => {
    const t = await rig();
    await t.connect();
    for (let i = 0; i < 3; i++) await t.ask('signDirect', request().params);
    expect((await t.dapp.queue()).count).toBe(3);
    const node = silentNode();
    t.node.transport = node.transport;
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = idOf(i);
      const received = await t.dapp.receive(t.from, {
        id,
        method: 'signDirect',
        params: request().params,
      });
      ids.push(id);
      void received.after();
    }
    await vi.waitFor(() => {
      const refused = ids.filter((id) => t.answerOf(id)?.error?.message === TOO_MANY);
      expect(refused).toHaveLength(5 - (MAX_PER_ORIGIN - 3));
    });
    expect(node.accountReads()).toHaveLength(MAX_PER_ORIGIN - 3);
  });

  it('stop at the node when the page gives up, and are never queued or answered', async () => {
    const t = await rig();
    await t.connect();
    const windows = t.created.length;
    const node = silentNode();
    t.node.transport = node.transport;
    const id = 'd'.repeat(32);
    const received = await t.dapp.receive(t.from, {
      id,
      method: 'signDirect',
      params: request().params,
      sentAt: t.clock.now(),
    });
    const handling = received.after();
    await vi.waitFor(() => {
      expect(node.requests.length).toBeGreaterThan(0);
    });
    const cancel = await t.dapp.receive(t.from, { id, cancel: true });
    await cancel.after();
    await handling;
    expect(node.aborted).toHaveLength(node.requests.length);
    expect((await t.dapp.queue()).count).toBe(0);
    expect(t.answerOf(id)).toBeUndefined();
    expect(t.created).toHaveLength(windows);
  });

  it('free their place once given up on: the site is served again', async () => {
    const t = await rig();
    await t.connect();
    const node = silentNode();
    t.node.transport = node.transport;
    for (let i = 0; i < MAX_PER_ORIGIN; i++) {
      const id = idOf(i);
      const received = await t.dapp.receive(t.from, {
        id,
        method: 'signDirect',
        params: request().params,
      });
      const handling = received.after();
      await vi.waitFor(() => {
        expect(node.accountReads()).toHaveLength(i + 1);
      });
      const cancel = await t.dapp.receive(t.from, { id, cancel: true });
      await cancel.after();
      await handling;
    }
    t.node.transport = null;
    const a = await t.ask('signDirect', request().params);
    expect(t.answerOf(a.id)).toBeUndefined();
    expect((await t.dapp.queue()).count).toBe(1);
  });

  it('are counted only past the checks that need no node, so unconnected sites hold no place', async () => {
    const t = await rig();
    await t.connect();
    // The wallet answers slowly: every request is in hand at once while it waits.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const profile = await t.wallet.getProfile();
    vi.spyOn(t.wallet, 'getProfile').mockImplementation(() => gate.then(() => profile));
    const handling: Promise<void>[] = [];
    for (let i = 0; i < MAX_PREPARING + 10; i++) {
      const stranger: DappSender = {
        origin: `https://site${String(i % 6)}.example`,
        tabId: 100 + i,
        documentId: `doc-s${String(i)}`,
      };
      const received = await t.dapp.receive(stranger, {
        id: idOf(100 + i),
        method: 'signDirect',
        params: request().params,
      });
      handling.push(received.after());
    }
    const mine = await t.dapp.receive(t.from, {
      id: idOf(999),
      method: 'signDirect',
      params: request().params,
    });
    handling.push(mine.after());
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all(handling);
    expect(t.answerOf(idOf(100))).toMatchObject({ error: { code: 'not-connected' } });
    expect(t.answerOf(idOf(999))).toBeUndefined();
    expect((await t.dapp.queue()).count).toBe(1);
  });

  it('reach the node at most MAX_PREPARING at a time across all sites', async () => {
    const t = await rig();
    const sites: DappSender[] = [t.from];
    for (let k = 1; k < 5; k++) {
      sites.push({
        origin: `https://dapp${String(k)}.example`,
        tabId: 10 + k,
        documentId: `d${String(k)}`,
      });
    }
    for (const site of sites) await t.connect(site);
    const node = silentNode();
    t.node.transport = node.transport;
    const ids: string[] = [];
    for (const [k, site] of sites.entries()) {
      for (let i = 0; i < MAX_PER_ORIGIN; i++) {
        const id = idOf(k * 10 + i);
        const received = await t.dapp.receive(site, {
          id,
          method: 'signDirect',
          params: request().params,
        });
        ids.push(id);
        void received.after();
      }
    }
    expect(ids.length).toBeGreaterThan(MAX_PREPARING);
    await vi.waitFor(() => {
      const refused = ids.filter((id) => t.answerOf(id)?.error?.message === TOO_MANY);
      expect(refused).toHaveLength(ids.length - MAX_PREPARING);
    });
    expect(node.accountReads()).toHaveLength(MAX_PREPARING);
  });

  it('include broadcasts: at most a site share of sendTx reach the node at once', async () => {
    const t = await rig();
    await t.connect();
    const node = silentNode();
    t.node.transport = node.transport;
    const txBytes = bytesToWire(
      txRawBytes({
        bodyBytes: Uint8Array.from([1]),
        authInfoBytes: Uint8Array.from([2]),
        signatures: [new Uint8Array(64).fill(1)],
      }),
    );
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = idOf(i);
      const received = await t.dapp.receive(t.from, {
        id,
        method: 'sendTx',
        params: { chainId: CHAIN_ID, txBytes, mode: 'sync' },
      });
      ids.push(id);
      void received.after();
    }
    await vi.waitFor(() => {
      const refused = ids.filter((id) => t.answerOf(id)?.error?.message === TOO_MANY);
      expect(refused).toHaveLength(50 - MAX_PER_ORIGIN);
    });
    const broadcasts = node.requests.filter((r) => r.url.endsWith('/cosmos/tx/v1beta1/txs'));
    expect(broadcasts).toHaveLength(MAX_PER_ORIGIN);
  });

  it('do not hold back requests that never reach the node', async () => {
    const t = await rig();
    await t.connect();
    const node = silentNode();
    t.node.transport = node.transport;
    for (let i = 0; i < MAX_PER_ORIGIN; i++) {
      const received = await t.dapp.receive(t.from, {
        id: idOf(i),
        method: 'signDirect',
        params: request().params,
      });
      void received.after();
    }
    await vi.waitFor(() => {
      expect(node.accountReads()).toHaveLength(MAX_PER_ORIGIN);
    });
    const key = await t.ask('getKey', { chainId: CHAIN_ID });
    expect(t.answerOf(key.id)).toMatchObject({ result: { bech32Address: MAIN.address } });
  });
});
