import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BroadcastError,
  HttpStatusError,
  decodeAuthInfo,
  decodeTxBody,
  decodeTxRaw,
  TransportError,
  txHash,
  MAX_BALANCES,
  NETWORKS,
  RestChainClient,
  SimulationError,
  TxTimeoutError,
  signDocBytes,
  txRawBytes,
  type HttpTransport,
  type Network,
  type TxResult,
} from '@beepocket/core';
import { describe, expect, it } from 'vitest';
import { HandlerRegistry } from '../../background/registry';
import type { Services } from '../../background/services';
import type { Platform } from '../../platform';
import { fail, ok, type Result } from '../../protocol';
import type { SendQuote } from '../../protocol/send';
import type { WalletService } from '../wallet';
import { registerSendHandlers } from './handlers';

const FACTORY = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl';
const OTHER = 'factory/bze1other/gold';
const NETWORK = NETWORKS.mainnet;

interface Golden {
  name: string;
  signer: string;
  pubKey: string;
  chainId: string;
  accountNumber: string;
  sequence: string;
  gasLimit: string;
  fee: { denom: string; amount: string }[];
  messages: { toAddress: string; amount: { denom: string; amount: string }[] }[];
  bodyBytes: string;
  authInfoBytes: string;
  signature: string;
  txRaw: string;
}

const golden = (name: string): Golden =>
  JSON.parse(
    readFileSync(
      resolve(import.meta.dirname, `../../../../core/test/fixtures/golden/${name}.json`),
      'utf8',
    ),
  ) as Golden;
const bytes = (b64: string): Uint8Array => Uint8Array.from(Buffer.from(b64, 'base64'));

const SIGNER = golden('send-ubze').signer;
const RECIPIENT = golden('send-ubze').messages[0]?.toAddress ?? '';
const PUBKEY = bytes(golden('send-ubze').pubKey);
const HASH = 'AB'.repeat(32);
/** The latest block height the fake node reports; wallet sends expire this many blocks later. */
const HEIGHT = 21_500_000n;
const TIMEOUT_BLOCKS = 30n;

/** Protobuf varint of an unsigned integer. */
function varint(n: bigint): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

/**
 * A body with no memo and no extensions, given a timeout height: field 3 (`timeout_height`)
 * follows the messages, so it is appended to the bytes without one.
 */
const withTimeout = (body: Uint8Array, height: bigint): Uint8Array =>
  Uint8Array.from([...body, 0x18, ...varint(height)]);

interface Options {
  state?: 'unlocked' | 'weakLocked' | 'locked';
  balances?: Record<string, bigint>;
  /** null: the address is not on chain yet. */
  account?: { accountNumber: bigint; sequence: bigint } | null;
  /** What a simulation with a fee in BZE (or none) uses. */
  gasUsed?: bigint;
  /** What a simulation with a fee in another token uses. */
  foreignGasUsed?: bigint;
  fallbackToken?: boolean;
  /** Pools pairing ubze with these tokens: [token, native reserve, token reserve]. */
  pools?: [string, bigint, bigint][];
  /**
   * Read balances from a node, a page of 100 at a time, where the address also holds this many
   * other denoms of one unit each.
   */
  otherDenoms?: number;
}

/** The node behind `Options.otherDenoms`: it lists `count` other denoms, then the address's own. */
function manyDenomsNode(count: number, held: () => Record<string, bigint>) {
  const requests: string[] = [];
  const PER_PAGE = 100;
  const transport: HttpTransport = {
    request(req) {
      requests.push(req.url);
      const url = new URL(req.url);
      const list = `/cosmos/bank/v1beta1/balances/${SIGNER}`;
      const reply = (body: unknown) => Promise.resolve({ status: 200, body: JSON.stringify(body) });
      if (url.pathname === `${list}/by_denom`) {
        const denom = url.searchParams.get('denom') ?? '';
        const amount = held()[denom] ?? (denom.startsWith('ibc/') ? 1n : 0n);
        return reply({ balance: { denom, amount: amount.toString() } });
      }
      if (url.pathname !== list) return Promise.reject(new Error(`unexpected ${req.url}`));
      const page = Number(url.searchParams.get('pagination.key') ?? '0');
      const from = page * PER_PAGE;
      const to = Math.min(from + PER_PAGE, count);
      const balances: Coin[] = [];
      for (let i = from; i < to; i++) {
        balances.push({ denom: `ibc/${i.toString(16).padStart(64, '0')}`, amount: '1' });
      }
      if (to >= count) {
        for (const [denom, amount] of Object.entries(held())) {
          balances.push({ denom, amount: amount.toString() });
        }
      }
      return reply({ balances, pagination: { next_key: to >= count ? null : String(page + 1) } });
    },
  };
  return { transport, requests };
}

function setup(opts: Options = {}) {
  const calls = {
    account: 0,
    balances: 0,
    balance: 0,
    simulate: 0,
    broadcast: 0,
    sign: 0,
    rearm: 0,
    height: 0,
  };
  const signed: Uint8Array[] = [];
  const signedFor: string[] = [];
  const sent: Uint8Array[] = [];
  const waits: { txHash: string; options: unknown }[] = [];
  /** The fee coins of each simulation, as `denom:amount`. */
  const simulatedFees: string[][] = [];
  /** The timeout height of each simulated body. */
  const simulatedTimeouts: string[] = [];
  const control = {
    // x 1.2 gives the golden transactions' 200,000 (BZE fee) and 300,000 (fee in VDL).
    gasUsed: opts.gasUsed ?? 166_666n,
    foreignGasUsed: opts.foreignGasUsed ?? 250_000n,
    balances: opts.balances ?? { ubze: 100_000_000n },
    broadcastError: null as Error | null,
    /** The hash the node answers a broadcast with; null answers the real hash of the bytes. */
    broadcastHash: null as string | null,
    /** null: the address is not on chain yet. */
    account:
      opts.account === undefined
        ? ({ accountNumber: 7n, sequence: 3n } as {
            accountNumber: bigint;
            sequence: bigint;
          } | null)
        : opts.account,
    height: HEIGHT as bigint | Error,
    now: 1_000_000,
    simulateError: null as Error | null,
    tx: { height: 10n, code: 0, rawLog: '', gasUsed: 150_000n } as TxResult | Error,
    state: opts.state ?? 'unlocked',
    accountPubKey: null as Uint8Array | null,
    signature: bytes(golden('send-ubze').signature),
    /** The active network: what the worker reads on every call. */
    network: NETWORK as Network,
    /** The wallet's addresses as the profile holds them right now. */
    addresses: [{ index: 0, label: 'Main', address: SIGNER }],
  };
  const pools = opts.pools ?? [[FACTORY, 21_000_000_000n, 50_000_000_000n]];
  const listing =
    opts.otherDenoms === undefined
      ? null
      : manyDenomsNode(opts.otherDenoms, () => control.balances);
  const node = listing && new RestChainClient(listing.transport, NETWORK);
  const chain = {
    account: () => {
      calls.account++;
      const account = control.account;
      return Promise.resolve(account && { ...account, pubKey: control.accountPubKey });
    },
    latestHeight: () => {
      calls.height++;
      return control.height instanceof Error
        ? Promise.reject(control.height)
        : Promise.resolve(control.height);
    },
    balances: (address: string) => {
      calls.balances++;
      return node
        ? node.balances(address)
        : Promise.resolve(new Map(Object.entries(control.balances)));
    },
    balance: (address: string, denom: string) => {
      calls.balance++;
      return node ? node.balance(address, denom) : Promise.resolve(control.balances[denom] ?? 0n);
    },
    simulate: (tx: Uint8Array) => {
      calls.simulate++;
      const raw = decodeTxRaw(tx);
      const fee = (decodeAuthInfo(raw.authInfoBytes) as unknown as { fee: { amount: Coin[] } }).fee
        .amount;
      simulatedFees.push(fee.map((c) => `${c.denom}:${c.amount}`));
      simulatedTimeouts.push(
        (decodeTxBody(raw.bodyBytes) as unknown as { timeoutHeight: string }).timeoutHeight,
      );
      if (control.simulateError) return Promise.reject(control.simulateError);
      // Like the chain: the fee coin is deducted before the send runs, so both must be held.
      const messages = (
        decodeTxBody(raw.bodyBytes) as unknown as {
          messages: { value: { amount: Coin[] } }[];
        }
      ).messages;
      const spent = new Map<string, bigint>();
      for (const c of [...fee, ...messages.flatMap((m) => m.value.amount)]) {
        spent.set(c.denom, (spent.get(c.denom) ?? 0n) + BigInt(c.amount));
      }
      for (const [denom, amount] of spent) {
        if (amount > (control.balances[denom] ?? 0n)) {
          return Promise.reject(new SimulationError('insufficient funds', 400));
        }
      }
      const foreign = fee.some((c) => c.denom !== 'ubze');
      return Promise.resolve({ gasUsed: foreign ? control.foreignGasUsed : control.gasUsed });
    },
    broadcast: (tx: Uint8Array) => {
      calls.broadcast++;
      sent.push(tx);
      return control.broadcastError
        ? Promise.reject(control.broadcastError)
        : Promise.resolve({ txHash: control.broadcastHash ?? txHash(tx) });
    },
    waitForTx: (txHash: string, options: unknown) => {
      waits.push({ txHash, options });
      return control.tx instanceof Error ? Promise.reject(control.tx) : Promise.resolve(control.tx);
    },
    feeParams: () => Promise.resolve({ minGasPrice: { denom: 'ubze', amount: '0.01' } }),
    tradebinParams: () =>
      Promise.resolve({ nativeDenom: 'ubze', minNativeLiquidityForModuleSwap: 1_000n }),
    liquidityPools: () =>
      Promise.resolve(
        pools.map(([quote, reserveBase, reserveQuote], i) => ({
          id: String(i),
          base: 'ubze',
          quote,
          reserveBase,
          reserveQuote,
        })),
      ),
    haltedDenoms: () => Promise.resolve([] as string[]),
    denomMetadata: (denom: string) =>
      denom === FACTORY || denom === OTHER
        ? Promise.resolve(
            opts.fallbackToken === true
              ? null
              : {
                  name: 'Token',
                  symbol: denom === FACTORY ? 'VDL' : 'GOLD',
                  display: 'x',
                  exponent: 6,
                  description: '',
                },
          )
        : Promise.resolve(null),
    denomBranding: () => Promise.resolve(null),
  };
  const services = {
    activeNetwork: () => Promise.resolve(control.network),
    clients: () => Promise.resolve({ network: control.network, chain, scan: {} }),
  } as unknown as Services;
  const cache = new Map<string, unknown>();
  const session = new Map<string, unknown>();
  const platform = {
    clock: { now: () => control.now, sleep: () => Promise.resolve() },
    session: {
      get: (k: string) => Promise.resolve(session.get(k)),
      set: (k: string, v: unknown) => Promise.resolve(void session.set(k, v)),
      setMany: (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) session.set(k, v);
        return Promise.resolve();
      },
      remove: (k: string) => Promise.resolve(void session.delete(k)),
    },
    cache: {
      get: (k: string) => Promise.resolve(cache.get(k)),
      set: (k: string, v: unknown) => Promise.resolve(void cache.set(k, v)),
    },
  } as unknown as Platform;
  const wallet = {
    state: () => Promise.resolve({ state: control.state, retryAt: null }),
    addresses: () => Promise.resolve(ok({ addresses: control.addresses })),
    pubKey: () =>
      Promise.resolve(control.state === 'unlocked' ? ok(PUBKEY) : fail('needs-password', 'locked')),
    signDirect: (address: string, doc: Uint8Array): Promise<Result<Uint8Array>> => {
      if (!control.addresses.some((a) => a.address === address)) {
        return Promise.resolve(fail('unknown_address', 'No such address.'));
      }
      calls.sign++;
      signedFor.push(address);
      signed.push(doc);
      return Promise.resolve(ok(control.signature));
    },
    rearm: () => {
      calls.rearm++;
      return Promise.resolve();
    },
  } as unknown as WalletService;

  const registry = new HandlerRegistry();
  registerSendHandlers(registry, { platform, services, wallet });
  const call = (method: string, payload: unknown) =>
    registry.dispatch({ method, payload }) as Promise<
      { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }
    >;
  return {
    call,
    calls,
    signed,
    signedFor,
    sent,
    waits,
    control,
    simulatedFees,
    simulatedTimeouts,
    nodeRequests: listing?.requests ?? [],
  };
}

interface Coin {
  denom: string;
  amount: string;
}

const prepareReq = (over: Record<string, unknown> = {}) => ({
  fromIndex: 0,
  to: RECIPIENT,
  denom: 'ubze',
  amount: '1',
  ...over,
});

const submitFrom = (q: SendQuote) => ({
  fromIndex: 0,
  fromAddress: q.from.address,
  network: q.network,
  to: q.to,
  denom: q.token.denom,
  amount: q.amount,
  feeDenom: q.fee.denom,
  feeAmount: q.fee.amount,
  gasLimit: q.gasLimit,
  ...(q.override === undefined ? {} : { override: q.override }),
});

/** The fee the broadcast transaction carries. */
const sentFee = (txRaw: Uint8Array | undefined) => {
  if (!txRaw) throw new Error('nothing was sent');
  return decodeAuthInfo(decodeTxRaw(txRaw).authInfoBytes).fee;
};

async function quoteOf(s: ReturnType<typeof setup>, over: Record<string, unknown> = {}) {
  const res = await s.call('send.prepare', prepareReq(over));
  if (!res.ok) throw new Error(res.error.code);
  return res.value as SendQuote;
}

describe('golden transactions', () => {
  const cases = [
    { name: 'send-ubze', denom: 'ubze', amount: '1', feeDenom: 'ubze' },
    { name: 'send-factory-denom', denom: FACTORY, amount: '0.25', feeDenom: 'ubze' },
    { name: 'fee-non-native', denom: 'ubze', amount: '1', feeDenom: FACTORY },
  ];
  for (const c of cases) {
    it(`${c.name}: the reviewed quote is what the signer gets, byte for byte`, async () => {
      const g = golden(c.name);
      const s = setup({ balances: { ubze: 100_000_000n, [FACTORY]: 100_000_000n } });
      // The signature bzed produced for the golden bytes; a stand-in here, since the body the
      // wallet signs now also carries a timeout height.
      s.control.signature = bytes(g.signature);
      const quote = await quoteOf(s, { denom: c.denom, amount: c.amount, feeDenom: c.feeDenom });
      expect(quote.fee).toMatchObject(g.fee[0] ?? {});
      expect(quote.gasLimit).toBe(g.gasLimit);
      expect(quote.amount).toBe(g.messages[0]?.amount[0]?.amount);

      // The golden body, which expires a fixed number of blocks after the latest one.
      const bodyBytes = withTimeout(bytes(g.bodyBytes), HEIGHT + TIMEOUT_BLOCKS);
      const txRaw = txRawBytes({
        bodyBytes,
        authInfoBytes: bytes(g.authInfoBytes),
        signatures: [bytes(g.signature)],
      });
      const sent = await s.call('send.submit', submitFrom(quote));
      expect(sent).toEqual({ ok: true, value: { txHash: txHash(txRaw) } });

      expect(s.signed).toEqual([
        signDocBytes({
          bodyBytes,
          authInfoBytes: bytes(g.authInfoBytes),
          chainId: g.chainId,
          accountNumber: BigInt(g.accountNumber),
        }),
      ]);
      expect(s.sent).toEqual([txRaw]);
    });
  }
});

describe('send.prepare', () => {
  it('sends max of a token paid for in the same token minus the fee', async () => {
    const s = setup({ balances: { ubze: 5_000_000n } });
    const quote = await quoteOf(s, { amount: '', max: true });
    expect(quote.fee.denom).toBe('ubze');
    expect(BigInt(quote.amount) + BigInt(quote.fee.amount)).toBe(5_000_000n);
    // The amount that is signed was the one simulated (the fee settled on it).
    expect(s.calls.simulate).toBeGreaterThanOrEqual(2);
  });

  it('prices each fee token on its own simulation, with a 1-unit fee coin', async () => {
    const s = setup({ balances: { ubze: 100_000_000n, [FACTORY]: 100_000_000n } });
    const quote = await quoteOf(s, { feeDenom: FACTORY });
    // Gas: 166,666 simulated with 1 ubze x 1.2 -> 200,000; 250,000 simulated with 1 uvdl x 1.2
    // -> 300,000. Fee: 300,000 x 0.01 = 3,000 ubze. The pool holds 21,000 ubze per 50,000
    // uvdl, so spot = 0.42 ubze per uvdl and 3,000 / 0.42 = 7,142.86 uvdl; x 1.1 slippage =
    // 7,857.14, rounded up to 7,858.
    expect(s.simulatedFees).toEqual([['ubze:1'], [`${FACTORY}:1`]]);
    expect(quote.options).toMatchObject([
      { denom: 'ubze', amount: '2000', gasLimit: '200000', gasUsed: '166666' },
      { denom: FACTORY, amount: '7858', gasLimit: '300000', gasUsed: '250000' },
    ]);
    expect(quote.fee).toMatchObject({ denom: FACTORY, amount: '7858', gasLimit: '300000' });
    expect(quote.gasLimit).toBe('300000');

    // What gets signed is pinned byte for byte by the fee-non-native golden transaction.
  });

  it('sends max of a token that pays its own fee, leaving the larger foreign fee', async () => {
    const s = setup({ balances: { [FACTORY]: 1_000_000n } });
    const quote = await quoteOf(s, { denom: FACTORY, amount: '', max: true });
    expect(quote.fee).toMatchObject({ denom: FACTORY, amount: '7858', gasLimit: '300000' });
    expect(BigInt(quote.amount) + BigInt(quote.fee.amount)).toBe(1_000_000n);
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });

    // One unit above the fee leaves exactly one to send; the fee itself leaves nothing.
    const edge = await quoteOf(setup({ balances: { [FACTORY]: 7_859n } }), {
      denom: FACTORY,
      amount: '',
      max: true,
    });
    expect(edge.amount).toBe('1');
    expect(
      await setup({ balances: { [FACTORY]: 7_858n } }).call(
        'send.prepare',
        prepareReq({ denom: FACTORY, amount: '', max: true }),
      ),
    ).toMatchObject({ ok: false });
  });

  it('sends the whole balance when the fee is paid in another token', async () => {
    const s = setup({ balances: { ubze: 5_000_000n, [FACTORY]: 2_000_000n } });
    const quote = await quoteOf(s, { amount: '', max: true, feeDenom: FACTORY });
    expect(quote.amount).toBe('5000000');
    expect(quote.fee.denom).toBe(FACTORY);
    // The whole BZE balance leaves nothing for a 1 ubze fee coin: BZE is simulated with no fee
    // (picking it sends max less the fee, simulated again), VDL with 1 uvdl.
    expect(quote.options.map((o) => o.denom)).toEqual(['ubze', FACTORY]);
    expect(s.simulatedFees.at(-2)).toEqual([]);
    expect(s.simulatedFees.at(-1)).toEqual([`${FACTORY}:1`]);
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
  });

  it('simulates the fee in another token with the picked token, at review and at submit', async () => {
    const s = setup({
      balances: { [FACTORY]: 1_000_000n, [OTHER]: 1_000_000n },
      pools: [
        [FACTORY, 21_000_000_000n, 50_000_000_000n],
        [OTHER, 21_000_000_000n, 50_000_000_000n],
      ],
    });
    // All of VDL is sent, so a VDL fee coin could never be simulated; GOLD pays.
    const quote = await quoteOf(s, { denom: FACTORY, amount: '', max: true, feeDenom: OTHER });
    expect(quote).toMatchObject({ amount: '1000000', fee: { denom: OTHER } });
    const reviewed = s.simulatedFees.length;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
    expect(s.simulatedFees.slice(reviewed)).toEqual([[], [`${OTHER}:1`]]);
  });

  it('keeps another token as the fee when the whole balance of the sent token goes', async () => {
    const s = setup({
      balances: { [FACTORY]: 1_000_000n, [OTHER]: 1_000_000n },
      pools: [
        [FACTORY, 21_000_000_000n, 50_000_000_000n],
        [OTHER, 21_000_000_000n, 50_000_000_000n],
      ],
    });
    // 1 VDL is the whole VDL balance: GOLD, not VDL, is simulated as the fee.
    const quote = await quoteOf(s, { denom: FACTORY, amount: '1' });
    expect(quote.options.map((o) => o.denom)).toEqual([OTHER]);
    expect(quote.fee.denom).toBe(OTHER);
    expect(s.simulatedFees).toEqual([[], [`${OTHER}:1`]]);
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
  });

  it('says the fee cannot be paid on a max send of a single unit, not the node error', async () => {
    const s = setup({ balances: { ubze: 1n } });
    expect(await s.call('send.prepare', prepareReq({ amount: '', max: true }))).toMatchObject({
      ok: false,
      error: { code: 'cannot-pay-fee' },
    });
  });

  it('simulates a max BZE send one unit short, so the 1 ubze fee coin fits', async () => {
    const s = setup({ balances: { ubze: 5_000_000n } });
    const quote = await quoteOf(s, { amount: '', max: true });
    expect(s.simulatedFees.every((f) => f.join() === 'ubze:1')).toBe(true);
    expect(quote.amount).toBe('4998000');
  });

  it('defaults to the sent token when it can pay, as BZE does for a BZE send', async () => {
    const both = await quoteOf(setup({ balances: { ubze: 9_000_000n, [FACTORY]: 9_000_000n } }));
    expect(both.fee.denom).toBe('ubze');
    expect(both.options.map((o: { denom: string }) => o.denom)).toEqual(['ubze', FACTORY]);
    // The fee sheet shows what the payer holds of each option.
    expect(both.options.map((o: { balance?: string }) => o.balance)).toEqual([
      '9000000',
      '9000000',
    ]);

    const sentToken = setup({
      balances: { [FACTORY]: 9_000_000n, [OTHER]: 9_000_000n },
      pools: [
        [FACTORY, 21_000_000_000n, 50_000_000_000n],
        [OTHER, 21_000_000_000n, 50_000_000_000n],
      ],
    });
    expect((await quoteOf(sentToken, { denom: OTHER })).fee.denom).toBe(OTHER);
    expect((await quoteOf(sentToken, { denom: FACTORY })).fee.denom).toBe(FACTORY);
  });

  it('defaults to the sent token when it can pay the fee, even with BZE held', async () => {
    const s = setup({ balances: { ubze: 9_000_000n, [FACTORY]: 9_000_000n } });
    const quote = await quoteOf(s, { denom: FACTORY });
    expect(quote.fee).toMatchObject({ denom: FACTORY, symbol: 'VDL' });
    // BZE stays an option, with the wallet's own logo.
    expect(quote.options).toMatchObject([
      { denom: 'ubze', symbol: 'BZE', logo: '/tokens/bze.png' },
      { denom: FACTORY },
    ]);
  });

  it('defaults to BZE when the sent token cannot pay the fee', async () => {
    const s = setup({ balances: { ubze: 9_000_000n, [OTHER]: 9_000_000n } });
    expect((await quoteOf(s, { denom: OTHER })).fee.denom).toBe('ubze');
    // Nor when the amount leaves too little of it for the fee.
    const whole = setup({ balances: { ubze: 9_000_000n, [FACTORY]: 9_000_000n } });
    expect((await quoteOf(whole, { denom: FACTORY, amount: '9' })).fee.denom).toBe('ubze');
  });

  it('keeps a fee token picked in the sheet over the default', async () => {
    const s = setup({ balances: { ubze: 9_000_000n, [FACTORY]: 9_000_000n } });
    expect((await quoteOf(s, { denom: FACTORY, feeDenom: 'ubze' })).fee.denom).toBe('ubze');
  });

  it('defaults to the first option when neither the sent token nor BZE can pay', async () => {
    const s = setup({ balances: { ubze: 100n, [FACTORY]: 9_000_000n, [OTHER]: 9_000_000n } });
    const quote = await quoteOf(s, { denom: OTHER });
    expect(quote.options.map((o) => o.denom)).toEqual([FACTORY]);
    expect(quote.fee.denom).toBe(FACTORY);
  });

  it('refuses with cannot-pay-fee when no eligible token covers the fee', async () => {
    const s = setup({ balances: { ubze: 100n, [OTHER]: 5_000_000n } });
    expect(await s.call('send.prepare', prepareReq({ denom: OTHER }))).toMatchObject({
      ok: false,
      error: { code: 'cannot-pay-fee' },
    });
  });

  it('checks the recipient, the amount and the balance', async () => {
    const s = setup({ balances: { ubze: 5_000_000n } });
    const code = async (over: Record<string, unknown>) => {
      const res = await s.call('send.prepare', prepareReq(over));
      return res.ok ? 'ok' : res.error.code;
    };
    expect(await code({ to: 'bze1nope' })).toBe('invalid-address');
    expect(await code({ amount: '0' })).toBe('invalid-amount');
    expect(await code({ amount: '1.0000001' })).toBe('invalid-amount');
    expect(await code({ amount: '1e3' })).toBe('invalid-amount');
    expect(await code({ amount: '5.000001' })).toBe('insufficient-funds');
    // Exactly the balance leaves nothing for the fee when BZE is the only fee token.
    expect(await code({ amount: '5' })).toBe('amount-leaves-no-fee');
    expect(await code({ amount: '0.000001' })).toBe('ok');
  });

  it('accepts one base unit and the balance minus the fee', async () => {
    const s = setup({ balances: { ubze: 5_000_000n } });
    expect((await quoteOf(s, { amount: '0.000001' })).amount).toBe('1');
    expect((await quoteOf(s, { amount: '4.998' })).amount).toBe('4998000');
  });

  it('answers fund-first for an address that is not on chain', async () => {
    const s = setup({ account: null });
    expect(await s.call('send.prepare', prepareReq())).toMatchObject({
      ok: false,
      error: { code: 'fund-first' },
    });
  });

  it('does not guess the decimals of a token it cannot read', async () => {
    const s = setup({ fallbackToken: true, balances: { ubze: 9_000_000n, [OTHER]: 5n } });
    expect(await s.call('send.prepare', prepareReq({ denom: OTHER }))).toMatchObject({
      ok: false,
      error: { code: 'token-unavailable' },
    });
  });

  it('reviews in the weak lock with the on-chain key or a stand-in', async () => {
    const s = setup({ state: 'weakLocked' });
    expect((await s.call('send.prepare', prepareReq())).ok).toBe(true);
  });

  it("relays the node's message when it would reject the transaction", async () => {
    const s = setup();
    s.control.simulateError = new SimulationError('account sequence mismatch', 400);
    expect(await s.call('send.prepare', prepareReq())).toEqual({
      ok: false,
      error: { code: 'simulation-failed', message: 'account sequence mismatch' },
    });
  });
});

describe('send.submit', () => {
  it('asks for the password in the weak lock before touching the network', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    const before = { ...s.calls };
    s.control.state = 'weakLocked';
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'needs-password' },
    });
    expect(s.calls).toEqual(before);
    expect(s.signed).toEqual([]);

    s.control.state = 'unlocked';
    expect((await s.call('send.submit', submitFrom(quote))).ok).toBe(true);
  });

  it('refuses when the wallet is locked', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.state = 'locked';
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'wallet_locked' },
    });
  });

  it('simulates again and signs nothing when the fee is no longer the reviewed one', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    const simulated = s.calls.simulate;
    s.control.gasUsed = 200_000n;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'review-changed' },
    });
    expect(s.calls.simulate).toBe(simulated + 1);
    expect(s.calls.sign).toBe(0);
    expect(s.calls.broadcast).toBe(0);
  });

  it('reads the sequence again at submit', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    const accounts = s.calls.account;
    await s.call('send.submit', submitFrom(quote));
    expect(s.calls.account).toBe(accounts + 1);
  });

  it('re-arms the lock timers after a send', async () => {
    const s = setup();
    await s.call('send.submit', submitFrom(await quoteOf(s)));
    expect(s.calls.rearm).toBe(1);
  });

  it("returns the node's rejection verbatim and does not re-arm", async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.broadcastError = new BroadcastError(
      13,
      'sdk',
      'insufficient fee; got: 1ubze required: 2ubze',
    );
    expect(await s.call('send.submit', submitFrom(quote))).toEqual({
      ok: false,
      error: { code: 'tx-rejected', message: 'insufficient fee; got: 1ubze required: 2ubze' },
    });
    expect(s.calls.rearm).toBe(0);
  });

  it('reports an unknown outcome with the hash when the broadcast gets no answer', async () => {
    const g = golden('send-ubze');
    for (const error of [new TransportError('offline'), new HttpStatusError(504, 'https://node')]) {
      const s = setup();
      s.control.signature = bytes(g.signature);
      const quote = await quoteOf(s);
      s.control.broadcastError = error;
      const txRaw = txRawBytes({
        bodyBytes: withTimeout(bytes(g.bodyBytes), HEIGHT + TIMEOUT_BLOCKS),
        authInfoBytes: bytes(g.authInfoBytes),
        signatures: [bytes(g.signature)],
      });
      expect(await s.call('send.submit', submitFrom(quote))).toEqual({
        ok: true,
        value: { txHash: txHash(txRaw), unconfirmed: true },
      });
      expect(s.calls.broadcast).toBe(1);
    }
  });

  it('signs the canonical fee even when the request spells numbers with leading zeros', async () => {
    const plain = setup();
    await plain.call('send.submit', submitFrom(await quoteOf(plain)));
    const padded = setup();
    const quote = await quoteOf(padded);
    const res = await padded.call('send.submit', {
      ...submitFrom(quote),
      feeAmount: `000${quote.fee.amount}`,
      gasLimit: `0${quote.gasLimit}`,
    });
    expect(res.ok).toBe(true);
    expect(padded.signed).toEqual(plain.signed);
  });

  it("refuses to sign when the address's on-chain key is not the wallet's", async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.accountPubKey = Uint8Array.from([2, ...new Array<number>(32).fill(9)]);
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'key-mismatch' },
    });
    expect(s.calls.sign).toBe(0);
    s.control.accountPubKey = PUBKEY;
    expect((await s.call('send.submit', submitFrom(quote))).ok).toBe(true);
  });

  it('signs with the reviewed sender and refuses another one', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    await s.call('send.submit', submitFrom(quote));
    expect(s.signedFor).toEqual([SIGNER]);
    expect(await s.call('send.submit', { ...submitFrom(quote), fromIndex: 1 })).toMatchObject({
      ok: false,
      error: { code: 'unknown_address' },
    });
    expect(s.signedFor).toEqual([SIGNER]);
  });

  it('refuses an amount the address no longer holds, and malformed quotes', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.balances = { ubze: 10n };
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'insufficient-funds' },
    });
    expect(await s.call('send.submit', { ...submitFrom(quote), amount: '-1' })).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
    expect(await s.call('send.submit', { ...submitFrom(quote), to: 'bze1nope' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-address' },
    });
  });
});

describe('Advanced gas limit and price', () => {
  // 166,666 simulated: the BZE estimate is 200,000 gas for 2,000 ubze at 0.01 ubze per gas.
  const override = (gasLimit: string, gasPrice = 1) => ({
    feeDenom: 'ubze',
    override: { gasLimit, gasPrice },
  });

  it('prices the picked limit and price and signs exactly that', async () => {
    const s = setup();
    const quote = await quoteOf(s, override('300000', 2));
    // 300,000 gas x 0.02 = 6,000 ubze; the options keep their own estimate.
    expect(quote.fee).toMatchObject({ denom: 'ubze', amount: '6000', gasLimit: '300000' });
    expect(quote.gasLimit).toBe('300000');
    expect(quote.override).toEqual({ gasLimit: '300000', gasPrice: 2 });
    expect(quote.overrideReset).toBeUndefined();
    expect(quote.options[0]).toMatchObject({
      amount: '2000',
      gasLimit: '200000',
      gasUsed: '166666',
    });
    expect(quote.options[0]?.pricing).toEqual({
      native: true,
      nativePrice: { num: '1', den: '100' },
      rate: { num: '1', den: '100' },
    });

    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
    expect(sentFee(s.sent[0])).toEqual({
      amount: [{ denom: 'ubze', amount: '6000' }],
      gasLimit: '300000',
      payer: '',
      granter: '',
    });
  });

  it('allows a limit between the simulation and the estimate, refuses one below it', async () => {
    const s = setup();
    const low = await quoteOf(s, override('166666'));
    expect(low.fee).toMatchObject({ amount: '1667', gasLimit: '166666' });
    expect(await s.call('send.submit', submitFrom(low))).toMatchObject({ ok: true });
    const below = await quoteOf(s, override('166665'));
    // Below the simulation the settings are dropped: the estimate comes back, flagged.
    expect(below.overrideReset).toBe(true);
    expect(below.override).toBeUndefined();
    expect(below.fee).toMatchObject({ amount: '2000', gasLimit: '200000' });
  });

  it('drops a limit above ten times the estimate', async () => {
    const s = setup();
    expect((await quoteOf(s, override('2000000'))).override).toBeDefined();
    const above = await quoteOf(s, override('2000001'));
    expect(above).toMatchObject({ overrideReset: true, gasLimit: '200000' });
  });

  it('drops the limit when the fresh simulation needs more, and signs nothing on submit', async () => {
    const s = setup();
    const quote = await quoteOf(s, override('170000'));
    expect(quote.fee).toMatchObject({ amount: '1700', gasLimit: '170000' });
    s.control.gasUsed = 180_000n;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'review-changed' },
    });
    expect(s.calls.sign).toBe(0);
    const again = await quoteOf(s, override('170000'));
    expect(again).toMatchObject({ overrideReset: true, gasLimit: '216000' });
  });

  it('signs nothing for a fee or a limit the settings do not price to', async () => {
    const s = setup();
    const quote = await quoteOf(s, override('300000', 3));
    expect(quote.fee.amount).toBe('9000');
    for (const tampered of [
      { ...submitFrom(quote), feeAmount: '8999' },
      { ...submitFrom(quote), gasLimit: '300001' },
      { ...submitFrom(quote), override: { gasLimit: '300000', gasPrice: 2 } },
    ]) {
      expect(await s.call('send.submit', tampered)).toMatchObject({
        ok: false,
        error: { code: 'review-changed' },
      });
    }
    expect(s.calls.sign).toBe(0);
  });

  it('drops settings whose fee the address cannot pay next to the amount', async () => {
    // 1 BZE sent out of 1.05: 50,000 ubze are left for the fee; 2,000,000 gas x 0.03 is 60,000.
    const s = setup({ balances: { ubze: 1_050_000n } });
    const fits = await quoteOf(s, override('2000000', 2));
    expect(fits.fee).toMatchObject({ amount: '40000', gasLimit: '2000000' });
    const above = await quoteOf(s, override('2000000', 3));
    expect(above).toMatchObject({ overrideReset: true, gasLimit: '200000' });
    expect(above.fee.amount).toBe('2000');
    expect(above.override).toBeUndefined();
  });

  it('drops the settings when a larger amount leaves too little for their fee', async () => {
    // 40,000 ubze for the fee fits next to 1 BZE out of 1.05, not next to 1.02.
    const s = setup({ balances: { ubze: 1_050_000n } });
    const settings = override('2000000', 2);
    expect((await quoteOf(s, { amount: '1', ...settings })).override).toEqual(settings.override);
    const larger = await quoteOf(s, { amount: '1.02', ...settings });
    expect(larger).toMatchObject({ overrideReset: true, gasLimit: '200000', amount: '1020000' });
    expect(larger.fee).toMatchObject({ amount: '2000', gasLimit: '200000' });
  });

  it('sends max less the custom fee', async () => {
    const s = setup({ balances: { ubze: 10_000_000n } });
    const quote = await quoteOf(s, { max: true, ...override('300000') });
    expect(quote.fee.amount).toBe('3000');
    expect(quote.amount).toBe('9997000');
  });

  it('bounds a fee in another token by its own simulation', async () => {
    // The VDL simulation used 250,000: below it is refused, from it on allowed.
    const s = setup({ balances: { ubze: 100_000_000n, [FACTORY]: 100_000_000n } });
    const at = await quoteOf(s, {
      feeDenom: FACTORY,
      override: { gasLimit: '250000', gasPrice: 1 },
    });
    expect(at.override).toBeDefined();
    const below = await quoteOf(s, {
      feeDenom: FACTORY,
      override: { gasLimit: '249999', gasPrice: 1 },
    });
    expect(below).toMatchObject({ overrideReset: true, gasLimit: '300000' });
  });

  it('prices a fee in another token at the picked price', async () => {
    // Pool 21,000 BZE / 50,000 VDL. 300,000 gas x 0.02 = 6,000 ubze -> 15,715 uvdl with 10%.
    const s = setup({ balances: { ubze: 100_000_000n, [FACTORY]: 100_000_000n } });
    const quote = await quoteOf(s, {
      feeDenom: FACTORY,
      override: { gasLimit: '300000', gasPrice: 2 },
    });
    expect(quote.fee).toMatchObject({ denom: FACTORY, amount: '15715', gasLimit: '300000' });
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
    expect(sentFee(s.sent[0])).toEqual({
      amount: [{ denom: FACTORY, amount: '15715' }],
      gasLimit: '300000',
      payer: '',
      granter: '',
    });
  });

  it('refuses settings without their fee token and malformed ones', async () => {
    const s = setup();
    for (const bad of [
      { override: { gasLimit: '300000', gasPrice: 1 } },
      { feeDenom: 'ubze', override: { gasLimit: '300000', gasPrice: 4 } },
      { feeDenom: 'ubze', override: { gasLimit: '0', gasPrice: 1 } },
      { feeDenom: 'ubze', override: { gasLimit: '1.5', gasPrice: 1 } },
      { feeDenom: 'ubze', override: { gasLimit: 300000, gasPrice: 1 } },
    ]) {
      expect(await s.call('send.prepare', prepareReq(bad))).toMatchObject({
        ok: false,
        error: { code: 'bad_request' },
      });
    }
    const quote = await quoteOf(s, override('300000'));
    expect(
      await s.call('send.submit', {
        ...submitFrom(quote),
        override: { gasLimit: '300000', gasPrice: 9 },
      }),
    ).toMatchObject({ ok: false, error: { code: 'bad_request' } });
  });
});

describe('send.status', () => {
  it('confirms an included transaction and links it on Scan', async () => {
    const s = setup();
    expect(await s.call('send.status', { txHash: HASH })).toEqual({
      ok: true,
      value: {
        status: 'confirmed',
        height: '10',
        gasUsed: '150000',
        explorerUrl: `${NETWORK.scan}/txs/${HASH}`,
      },
    });
    expect(s.waits[0]?.options).toMatchObject({ intervalMs: 1000, timeoutMs: 60_000 });
  });

  it('reports a transaction that failed on chain with its log', async () => {
    const s = setup();
    s.control.tx = {
      height: 10n,
      code: 11,
      rawLog: 'out of gas in location: WriteFlat',
      gasUsed: 1n,
    };
    expect(await s.call('send.status', { txHash: HASH })).toMatchObject({
      ok: true,
      value: { status: 'failed', message: 'out of gas in location: WriteFlat' },
    });
  });

  it('says pending after the 60 s are over', async () => {
    const s = setup();
    s.control.tx = new TxTimeoutError(HASH, 60_000);
    expect(await s.call('send.status', { txHash: HASH })).toMatchObject({
      ok: true,
      value: { status: 'pending', explorerUrl: `${NETWORK.scan}/txs/${HASH}` },
    });
  });

  it('rejects something that is not a hash', async () => {
    expect(await setup().call('send.status', { txHash: '../x' })).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    });
  });
});

describe('an address holding a great many tokens', () => {
  it('still sends, past the old page limit, with a bounded number of reads', async () => {
    const s = setup({ otherDenoms: 150_000, balances: { ubze: 100_000_000n } });
    const quote = await quoteOf(s);
    expect(quote.balance).toBe('100000000');
    expect(quote.fee.denom).toBe('ubze');
    const sent = await s.call('send.submit', submitFrom(quote));
    expect(sent).toEqual({ ok: true, value: { txHash: txHash(s.sent[0] ?? new Uint8Array()) } });
    // Each of the two steps reads the capped list and the few denoms it needs, nothing more.
    const perStep = MAX_BALANCES / 100 + 5;
    expect(s.nodeRequests.length).toBeLessThanOrEqual(2 * perStep);
  });

  it('reads one list and nothing else for an ordinary address', async () => {
    const s = setup({ otherDenoms: 3, balances: { ubze: 100_000_000n } });
    await quoteOf(s);
    expect(s.nodeRequests).toHaveLength(1);
    expect(s.calls.balance).toBe(0);
  });
});

/** The sequence and timeout height each broadcast transaction was signed with. */
const signedWith = (txRaw: Uint8Array) => {
  const raw = decodeTxRaw(txRaw);
  const auth = decodeAuthInfo(raw.authInfoBytes) as unknown as {
    signerInfos: { sequence: string }[];
  };
  const body = decodeTxBody(raw.bodyBytes) as unknown as { timeoutHeight: string };
  return { sequence: auth.signerInfos[0]?.sequence, timeoutHeight: body.timeoutHeight };
};

describe('pending sends', () => {
  const PENDING = 'send-pending';
  const WINDOW_MS = 30_000;

  it('signs nothing new while the previous send may still land, even at a newer sequence', async () => {
    const s = setup({ account: { accountNumber: 7n, sequence: 5n } });
    const quote = await quoteOf(s);
    s.control.broadcastError = new BroadcastError(
      4,
      'grpc-gateway',
      'signature verification failed',
    );
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'tx-rejected' },
    });

    // The node now reports the next sequence: the first send may have landed after all.
    s.control.account = { accountNumber: 7n, sequence: 6n };
    s.control.broadcastError = null;
    s.control.now += 5_000;
    const again = await s.call('send.submit', submitFrom(await quoteOf(s)));
    expect(again).toMatchObject({ ok: false, error: { code: PENDING } });
    expect(s.calls.sign).toBe(1);
    expect(s.sent.map((tx) => signedWith(tx).sequence)).toEqual(['5']);
  });

  it('allows a new send once the window has passed', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.broadcastError = new TransportError('offline');
    expect((await s.call('send.submit', submitFrom(quote))).ok).toBe(true);
    s.control.broadcastError = null;

    s.control.now += WINDOW_MS - 1;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: PENDING },
    });
    s.control.now += 1;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
    expect(s.calls.sign).toBe(2);
  });

  it('allows the next send right away once the previous one is found on chain', async () => {
    const s = setup();
    const first = await s.call('send.submit', submitFrom(await quoteOf(s)));
    if (!first.ok) throw new Error(first.error.code);
    const { txHash: hash } = first.value as { txHash: string };
    expect((await s.call('send.status', { txHash: hash })).ok).toBe(true);
    expect((await s.call('send.submit', submitFrom(await quoteOf(s)))).ok).toBe(true);
    expect(s.calls.sign).toBe(2);
  });

  it('keeps the wait when the previous send is reported failed on chain', async () => {
    const s = setup();
    const first = await s.call('send.submit', submitFrom(await quoteOf(s)));
    if (!first.ok) throw new Error(first.error.code);
    s.control.tx = { height: 10n, code: 11, rawLog: 'out of gas', gasUsed: 1n };
    const { txHash: hash } = first.value as { txHash: string };
    expect(await s.call('send.status', { txHash: hash })).toMatchObject({
      ok: true,
      value: { status: 'failed' },
    });
    expect(await s.call('send.submit', submitFrom(await quoteOf(s)))).toMatchObject({
      ok: false,
      error: { code: PENDING },
    });
  });

  it('signs once when two submits arrive together', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    const results = await Promise.all([
      s.call('send.submit', submitFrom(quote)),
      s.call('send.submit', submitFrom(quote)),
    ]);
    expect(s.calls.sign).toBe(1);
    expect(s.calls.broadcast).toBe(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([{ error: { code: PENDING } }]);
  });

  it('lets the next send through when a submit stops before signing', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.gasUsed = 200_000n;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'review-changed' },
    });
    s.control.gasUsed = 166_666n;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
  });

  it('remembers an unresolved send after a later one is found committed', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    // A: no answer from the node.
    s.control.broadcastError = new TransportError('offline');
    await s.call('send.submit', submitFrom(quote));
    // B, after the window: accepted and found committed.
    s.control.broadcastError = null;
    s.control.now += WINDOW_MS;
    s.control.account = { accountNumber: 7n, sequence: 4n };
    const b = await s.call('send.submit', submitFrom(await quoteOf(s)));
    if (!b.ok) throw new Error(b.error.code);
    await s.call('send.status', { txHash: (b.value as { txHash: string }).txHash });
    // C, refused: A can still be included, so the outcome is unknown, not a failure.
    s.control.account = { accountNumber: 7n, sequence: 5n };
    s.control.broadcastError = new BroadcastError(32, 'sdk', 'account sequence mismatch');
    expect(await s.call('send.submit', submitFrom(await quoteOf(s)))).toMatchObject({
      ok: true,
      value: { unconfirmed: true },
    });
  });

  it('treats "already in the mempool" as sent, with the hash of the signed bytes', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.broadcastError = new BroadcastError(19, 'sdk', '');
    const res = await s.call('send.submit', submitFrom(quote));
    expect(res).toEqual({
      ok: true,
      value: { txHash: txHash(s.sent[0] ?? new Uint8Array()), unconfirmed: true },
    });
  });

  it('keeps the hash of the signed bytes when the node answers another one', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.broadcastHash = HASH;
    const res = await s.call('send.submit', submitFrom(quote));
    expect(res).toEqual({
      ok: true,
      value: { txHash: txHash(s.sent[0] ?? new Uint8Array()), unconfirmed: true },
    });
    expect(txHash(s.sent[0] ?? new Uint8Array())).not.toBe(HASH);
  });

  it('accepts the same hash in lower case', async () => {
    // The bytes are deterministic: a first run tells what the second one will sign.
    const probe = setup();
    await probe.call('send.submit', submitFrom(await quoteOf(probe)));
    const local = txHash(probe.sent[0] ?? new Uint8Array());
    const s = setup();
    const quote = await quoteOf(s);
    s.control.broadcastHash = local.toLowerCase();
    expect(await s.call('send.submit', submitFrom(quote))).toEqual({
      ok: true,
      value: { txHash: local },
    });
  });

  it('says the outcome is unknown when a node refuses a send while an earlier one may land', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.broadcastError = new TransportError('offline');
    await s.call('send.submit', submitFrom(quote));
    s.control.now += WINDOW_MS;
    s.control.broadcastError = new BroadcastError(32, 'sdk', 'account sequence mismatch');
    const res = await s.call('send.submit', submitFrom(quote));
    expect(res).toMatchObject({ ok: true, value: { unconfirmed: true } });
  });
});

describe('transaction expiry', () => {
  it('signs every send with a timeout height a fixed number of blocks ahead', async () => {
    const s = setup();
    await s.call('send.submit', submitFrom(await quoteOf(s)));
    expect(s.sent.map((tx) => signedWith(tx).timeoutHeight)).toEqual([
      (HEIGHT + TIMEOUT_BLOCKS).toString(),
    ]);
  });

  it('simulates the body it will sign, timeout height included', async () => {
    const s = setup();
    await s.call('send.submit', submitFrom(await quoteOf(s)));
    expect(s.simulatedTimeouts.length).toBeGreaterThan(1);
    expect(new Set(s.simulatedTimeouts)).toEqual(new Set([(HEIGHT + TIMEOUT_BLOCKS).toString()]));
  });

  it('signs nothing when the latest block height cannot be read', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.height = new TransportError('offline');
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'network-error' },
    });
    expect(s.calls.sign).toBe(0);
    expect(s.calls.broadcast).toBe(0);
  });
});

describe('the reviewed network and sender', () => {
  it('the quote names the network it was prepared on', async () => {
    const s = setup();
    expect(await quoteOf(s)).toMatchObject({
      network: 'mainnet',
      from: { index: 0, address: SIGNER },
    });
    s.control.network = NETWORKS.testnet;
    expect(await quoteOf(s)).toMatchObject({ network: 'testnet' });
  });

  it('signs nothing when the active network is no longer the reviewed one', async () => {
    const s = setup();
    s.control.network = NETWORKS.testnet;
    const quote = await quoteOf(s);
    s.control.network = NETWORKS.mainnet;
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'review-changed' },
    });
    expect(s.calls.sign).toBe(0);
    expect(s.calls.broadcast).toBe(0);

    // Reviewed again on the network now active, it goes out there.
    const again = await quoteOf(s);
    expect(await s.call('send.submit', submitFrom(again))).toMatchObject({ ok: true });
    expect(s.signed).toHaveLength(1);
  });

  it('signs nothing when the address at the reviewed index is another one now', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    s.control.addresses = [{ index: 0, label: 'Main', address: RECIPIENT }];
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({
      ok: false,
      error: { code: 'review-changed' },
    });
    expect(s.signedFor).toEqual([]);
    expect(s.calls.broadcast).toBe(0);
  });

  it('sends as before when neither changed', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    expect(await s.call('send.submit', submitFrom(quote))).toMatchObject({ ok: true });
    expect(s.signedFor).toEqual([SIGNER]);
  });

  it('refuses a submit that does not name the reviewed network and sender', async () => {
    const s = setup();
    const quote = await quoteOf(s);
    const without = (key: string) =>
      Object.fromEntries(Object.entries(submitFrom(quote)).filter(([k]) => k !== key));
    for (const payload of [
      without('network'),
      without('fromAddress'),
      { ...submitFrom(quote), network: 'constructor' },
      { ...submitFrom(quote), network: 1 },
      { ...submitFrom(quote), fromAddress: 7 },
    ]) {
      expect(await s.call('send.submit', payload)).toMatchObject({
        ok: false,
        error: { code: 'bad_request' },
      });
    }
    expect(s.calls.sign).toBe(0);
  });
});
