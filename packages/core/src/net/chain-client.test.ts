import { describe, expect, expectTypeOf, it } from 'vitest';
import accountMain from '../../test/fixtures/rest/mainnet/account.json';
import balancesMain from '../../test/fixtures/rest/mainnet/balances.json';
import balancesPage1 from '../../test/fixtures/rest/mainnet/balances-page1.json';
import balancesPage2 from '../../test/fixtures/rest/mainnet/balances-page2.json';
import broadcastError from '../../test/fixtures/rest/mainnet/broadcast-error.json';
import brandingMissing from '../../test/fixtures/rest/mainnet/denom-branding-missing.json';
import metadataMain from '../../test/fixtures/rest/mainnet/denom-metadata.json';
import metadataMissing from '../../test/fixtures/rest/mainnet/denom-metadata-missing.json';
import feeParamsMain from '../../test/fixtures/rest/mainnet/fee-params.json';
import haltedMain from '../../test/fixtures/rest/mainnet/halted-denoms.json';
import poolsMain from '../../test/fixtures/rest/mainnet/liquidity-pools.json';
import poolsPage1 from '../../test/fixtures/rest/mainnet/liquidity-pools-page1.json';
import poolsPage2 from '../../test/fixtures/rest/mainnet/liquidity-pools-page2.json';
import simulateError from '../../test/fixtures/rest/mainnet/simulate-error.json';
import supplyMain from '../../test/fixtures/rest/mainnet/supply.json';
import tradebinMain from '../../test/fixtures/rest/mainnet/tradebin-params.json';
import txMain from '../../test/fixtures/rest/mainnet/tx.json';
import txMissing from '../../test/fixtures/rest/mainnet/tx-missing.json';
import accountTest from '../../test/fixtures/rest/testnet/account.json';
import brandingTest from '../../test/fixtures/rest/testnet/denom-branding.json';
import { FakeClock, json, MockTransport, reply, type Fixture } from '../../test/support';
import {
  BroadcastError,
  HttpStatusError,
  MAINNET,
  RestChainClient,
  SimulationError,
  TESTNET,
  TxTimeoutError,
  UnexpectedResponseError,
  type ChainClient,
} from '../index';

const f = (x: unknown) => x as Fixture;

function mainnet(): MockTransport {
  return new MockTransport(MAINNET.rest);
}

describe('RestChainClient.account', () => {
  it('reads number and sequence, with a null pubkey for an account that never sent', async () => {
    const t = mainnet().replay(f(accountMain));
    const address = accountMain.path.split('/').pop() ?? '';
    const account = await new RestChainClient(t, MAINNET).account(address);
    expect(account).toEqual({ accountNumber: 11706n, sequence: 0n, pubKey: null });
  });

  it('decodes the pubkey of an account that has one', async () => {
    const body = structuredClone(accountTest.body);
    body.account.pub_key = {
      '@type': '/cosmos.crypto.secp256k1.PubKey',
      key: btoa(String.fromCharCode(...new Uint8Array(33).fill(7))),
    };
    const t = new MockTransport(TESTNET.rest).on('GET', accountTest.path, json(200, body));
    const account = await new RestChainClient(t, TESTNET).account(body.account.address);
    expect(account?.pubKey).toEqual(new Uint8Array(33).fill(7));
  });

  it('is null on 404', async () => {
    const t = mainnet().on(
      'GET',
      '/cosmos/auth/v1beta1/accounts/bze1new',
      json(404, { code: 5, message: 'not found', details: [] }),
    );
    expect(await new RestChainClient(t, MAINNET).account('bze1new')).toBeNull();
  });

  it('rejects account types other than BaseAccount', async () => {
    const body = {
      account: {
        ...accountMain.body.account,
        '@type': '/cosmos.vesting.v1beta1.ContinuousVestingAccount',
      },
    };
    const t = mainnet().on('GET', '/cosmos/auth/v1beta1/accounts/bze1x', json(200, body));
    await expect(new RestChainClient(t, MAINNET).account('bze1x')).rejects.toThrow(
      expect.objectContaining({ name: 'UnexpectedResponseError', path: 'account.@type' }) as Error,
    );
  });

  it('names the missing field', async () => {
    const t = mainnet().on(
      'GET',
      '/cosmos/auth/v1beta1/accounts/bze1x',
      json(200, {
        account: { '@type': '/cosmos.auth.v1beta1.BaseAccount', pub_key: null, sequence: '1' },
      }),
    );
    await expect(new RestChainClient(t, MAINNET).account('bze1x')).rejects.toThrow(
      expect.objectContaining({ path: 'account.account_number' }) as Error,
    );
  });

  it('names a malformed number', async () => {
    const body = { account: { ...accountMain.body.account, sequence: 12 } };
    const t = mainnet().on('GET', '/cosmos/auth/v1beta1/accounts/bze1x', json(200, body));
    await expect(new RestChainClient(t, MAINNET).account('bze1x')).rejects.toThrow(
      expect.objectContaining({ path: 'account.sequence' }) as Error,
    );
  });

  it('rejects a body that is not JSON', async () => {
    const t = mainnet().on('GET', '/cosmos/auth/v1beta1/accounts/bze1x', {
      status: 200,
      body: '<html>',
    });
    await expect(new RestChainClient(t, MAINNET).account('bze1x')).rejects.toBeInstanceOf(
      UnexpectedResponseError,
    );
  });

  it('fails on any other status', async () => {
    const t = mainnet().on('GET', '/cosmos/auth/v1beta1/accounts/bze1x', { status: 502, body: '' });
    await expect(new RestChainClient(t, MAINNET).account('bze1x')).rejects.toBeInstanceOf(
      HttpStatusError,
    );
  });
});

describe('RestChainClient.balances', () => {
  const address = balancesMain.path.split('/').pop() ?? '';

  it('reads every balance as bigint', async () => {
    const t = mainnet().replay(f(balancesMain));
    const balances = await new RestChainClient(t, MAINNET).balances(address);
    expect([...balances.entries()]).toEqual(
      balancesMain.body.balances.map((b) => [b.denom, BigInt(b.amount)]),
    );
  });

  it('follows pagination.next_key, URL-encoded', async () => {
    const t = mainnet().replay(f(balancesPage1)).replay(f(balancesPage2));
    const balances = await new RestChainClient(t, MAINNET, { pageLimit: 1 }).balances(address);
    expect(balances.size).toBe(2);
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1]?.url).toContain('pagination.key=dWJ6ZQ%3D%3D');
  });

  it('stops a node that keeps returning the same key', async () => {
    const page = { balances: [], pagination: { next_key: 'AAAA', total: '0' } };
    const t = mainnet()
      .on('GET', `/cosmos/bank/v1beta1/balances/${address}`, json(200, page))
      .on('GET', `/cosmos/bank/v1beta1/balances/${address}?pagination.key=AAAA`, json(200, page));
    await expect(new RestChainClient(t, MAINNET).balances(address)).rejects.toBeInstanceOf(
      UnexpectedResponseError,
    );
  });

  it('names a malformed amount', async () => {
    const body = {
      balances: [{ denom: 'ubze', amount: '-5' }],
      pagination: { next_key: null, total: '1' },
    };
    const t = mainnet().on('GET', `/cosmos/bank/v1beta1/balances/${address}`, json(200, body));
    await expect(new RestChainClient(t, MAINNET).balances(address)).rejects.toThrow(
      expect.objectContaining({ path: 'balances[0].amount' }) as Error,
    );
  });
});

describe('RestChainClient.supply', () => {
  it('reads the amount', async () => {
    const t = mainnet().replay(f(supplyMain));
    expect(await new RestChainClient(t, MAINNET).supply('ubze')).toBe(
      BigInt(supplyMain.body.amount.amount),
    );
  });

  it('names the missing field', async () => {
    const t = mainnet().on(
      'GET',
      '/cosmos/bank/v1beta1/supply/by_denom?denom=ubze',
      json(200, { amount: { denom: 'ubze' } }),
    );
    await expect(new RestChainClient(t, MAINNET).supply('ubze')).rejects.toThrow(
      expect.objectContaining({ path: 'amount.amount' }) as Error,
    );
  });
});

describe('RestChainClient.denomMetadata', () => {
  const denom = 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl';

  it('takes the exponent of the display unit', async () => {
    const t = mainnet().replay(f(metadataMain));
    expect(await new RestChainClient(t, MAINNET).denomMetadata(denom)).toEqual({
      name: 'Vidulum',
      symbol: 'VDL',
      display: 'VDL',
      exponent: 6,
      description: 'Vidulum App Token',
    });
  });

  it('is null on 404 (ubze has no metadata)', async () => {
    const t = mainnet().replay(f(metadataMissing));
    expect(await new RestChainClient(t, MAINNET).denomMetadata('ubze')).toBeNull();
  });

  it('fails when no unit matches display', async () => {
    const body = structuredClone(metadataMain.body);
    body.metadata.display = 'NOPE';
    const t = mainnet().on('GET', metadataMain.path, json(200, body));
    await expect(new RestChainClient(t, MAINNET).denomMetadata(denom)).rejects.toThrow(
      expect.objectContaining({ path: 'metadata.denom_units' }) as Error,
    );
  });
});

describe('RestChainClient.denomBranding', () => {
  it('reads the font and both palettes', async () => {
    const t = new MockTransport(TESTNET.rest).replay(f(brandingTest));
    const branding = await new RestChainClient(t, TESTNET).denomBranding(
      'factory/bze1z3mkcr2jz424w6m49frgjmy9uhlrx69phqwg3l/vidulum',
    );
    expect(branding).toEqual(brandingTest.body.branding);
  });

  it('is null on 404', async () => {
    const t = mainnet().replay(f(brandingMissing));
    expect(await new RestChainClient(t, MAINNET).denomBranding('ubze')).toBeNull();
  });

  it('rejects a colour that is not #RRGGBB, naming it', async () => {
    const body = structuredClone(brandingTest.body);
    body.branding.dark.primary = 'blue';
    const t = new MockTransport(TESTNET.rest).on('GET', brandingTest.path, json(200, body));
    await expect(
      new RestChainClient(t, TESTNET).denomBranding(
        'factory/bze1z3mkcr2jz424w6m49frgjmy9uhlrx69phqwg3l/vidulum',
      ),
    ).rejects.toThrow(expect.objectContaining({ path: 'branding.dark.primary' }) as Error);
  });
});

describe('RestChainClient params', () => {
  it('reads the PascalCase ValidatorMinGasFee', async () => {
    const t = mainnet().replay(f(feeParamsMain));
    expect(await new RestChainClient(t, MAINNET).feeParams()).toEqual({
      minGasPrice: { denom: 'ubze', amount: '0.010000000000000000' },
    });
  });

  it('does not accept a snake_case guess for the fee field', async () => {
    const t = mainnet().on(
      'GET',
      '/bze/txfeecollector/params',
      json(200, { params: { validator_min_gas_fee: { denom: 'ubze', amount: '0.01' } } }),
    );
    await expect(new RestChainClient(t, MAINNET).feeParams()).rejects.toThrow(
      expect.objectContaining({ path: 'params.ValidatorMinGasFee' }) as Error,
    );
  });

  it('reads native_denom (snake) and minNativeLiquidityForModuleSwap (camel)', async () => {
    const t = mainnet().replay(f(tradebinMain));
    expect(await new RestChainClient(t, MAINNET).tradebinParams()).toEqual({
      nativeDenom: 'ubze',
      minNativeLiquidityForModuleSwap: 100000000000n,
    });
  });

  it('does not accept the other casing of the tradebin fields', async () => {
    const params = { nativeDenom: 'ubze', min_native_liquidity_for_module_swap: '1' };
    const t = mainnet().on('GET', '/bze/tradebin/params', json(200, { params }));
    await expect(new RestChainClient(t, MAINNET).tradebinParams()).rejects.toThrow(
      expect.objectContaining({ path: 'params.native_denom' }) as Error,
    );
  });
});

describe('RestChainClient.liquidityPools', () => {
  it('reads reserve_base and reserve_quote as bigint', async () => {
    const t = mainnet().replay(f(poolsMain));
    const pools = await new RestChainClient(t, MAINNET).liquidityPools();
    const first = poolsMain.body.list[0];
    expect(pools[0]).toEqual({
      id: first?.id,
      base: first?.base,
      quote: first?.quote,
      reserveBase: BigInt(first?.reserve_base ?? ''),
      reserveQuote: BigInt(first?.reserve_quote ?? ''),
    });
    expect(pools).toHaveLength(poolsMain.body.list.length);
  });

  it('follows pagination', async () => {
    const lastKey = encodeURIComponent(poolsPage2.body.pagination.next_key);
    const t = mainnet()
      .replay(f(poolsPage1))
      .replay(f(poolsPage2))
      .on(
        'GET',
        `/bze/tradebin/all_liquidity_pools?pagination.limit=1&pagination.key=${lastKey}`,
        json(200, { list: [], pagination: { next_key: null } }),
      );
    const pools = await new RestChainClient(t, MAINNET, { pageLimit: 1 }).liquidityPools();
    expect(pools.map((p) => p.id)).toEqual([
      poolsPage1.body.list[0]?.id,
      poolsPage2.body.list[0]?.id,
    ]);
  });

  it('keeps a halted flag when the node reports one', async () => {
    const pool = { ...poolsMain.body.list[0], halted: true };
    const t = mainnet().on(
      'GET',
      '/bze/tradebin/all_liquidity_pools',
      json(200, { list: [pool], pagination: { next_key: null } }),
    );
    expect((await new RestChainClient(t, MAINNET).liquidityPools())[0]?.halted).toBe(true);
  });

  it('names the wrong reserve field', async () => {
    const pool = { ...poolsMain.body.list[0], reserve_base: undefined, reserveBase: '1' };
    const t = mainnet().on(
      'GET',
      '/bze/tradebin/all_liquidity_pools',
      json(200, { list: [pool], pagination: { next_key: null } }),
    );
    await expect(new RestChainClient(t, MAINNET).liquidityPools()).rejects.toThrow(
      expect.objectContaining({ path: 'list[0].reserve_base' }) as Error,
    );
  });
});

describe('RestChainClient.haltedDenoms', () => {
  it('lists the halted denoms', async () => {
    const t = mainnet().replay(f(haltedMain));
    expect(await new RestChainClient(t, MAINNET).haltedDenoms()).toEqual(haltedMain.body.denoms);
  });

  it('follows pagination', async () => {
    const t = mainnet()
      .on(
        'GET',
        '/bze/tradebin/halted_denoms',
        json(200, { denoms: ['a'], pagination: { next_key: 'S2V5' } }),
      )
      .on(
        'GET',
        '/bze/tradebin/halted_denoms?pagination.key=S2V5',
        json(200, { denoms: ['b'], pagination: { next_key: null } }),
      );
    expect(await new RestChainClient(t, MAINNET).haltedDenoms()).toEqual(['a', 'b']);
  });
});

describe('RestChainClient.simulate', () => {
  const tx = new Uint8Array([1, 2, 3]);

  it('posts the base64 tx and returns gasUsed', async () => {
    const t = mainnet().on(
      'POST',
      '/cosmos/tx/v1beta1/simulate',
      json(200, { gas_info: { gas_wanted: '0', gas_used: '123456' }, result: {} }),
    );
    expect(await new RestChainClient(t, MAINNET).simulate(tx)).toEqual({ gasUsed: 123456n });
    expect(t.requests[0]?.body).toBe('{"tx_bytes":"AQID"}');
  });

  it('carries the node message on failure', async () => {
    const t = mainnet().replay(f(simulateError));
    const err = await new RestChainClient(t, MAINNET).simulate(tx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SimulationError);
    expect((err as SimulationError).message).toBe(simulateError.body.message);
    expect((err as SimulationError).status).toBe(500);
  });
});

describe('RestChainClient.broadcast', () => {
  const tx = new Uint8Array([1, 2, 3]);

  it('returns the hash and asks for sync mode', async () => {
    const body = { tx_response: { code: 0, txhash: 'ABCD', codespace: '', raw_log: '' } };
    const t = mainnet().on('POST', '/cosmos/tx/v1beta1/txs', json(200, body));
    expect(await new RestChainClient(t, MAINNET).broadcast(tx)).toEqual({ txHash: 'ABCD' });
    expect(JSON.parse(t.requests[0]?.body ?? '')).toEqual({
      tx_bytes: 'AQID',
      mode: 'BROADCAST_MODE_SYNC',
    });
  });

  it('surfaces code, codespace and raw_log of a rejected tx', async () => {
    const t = mainnet().replay(f(broadcastError));
    const err = await new RestChainClient(t, MAINNET).broadcast(tx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BroadcastError);
    expect(err).toMatchObject({
      code: broadcastError.body.tx_response.code,
      codespace: broadcastError.body.tx_response.codespace,
      rawLog: broadcastError.body.tx_response.raw_log,
    });
  });

  it('turns a gateway rejection into a BroadcastError too', async () => {
    const t = mainnet().on(
      'POST',
      '/cosmos/tx/v1beta1/txs',
      json(400, { code: 3, message: 'bad request', details: [] }),
    );
    await expect(new RestChainClient(t, MAINNET).broadcast(tx)).rejects.toMatchObject({
      code: 3,
      rawLog: 'bad request',
    });
  });
});

describe('RestChainClient.waitForTx', () => {
  const hash = txMain.body.tx_response.txhash;
  const path = `/cosmos/tx/v1beta1/txs/${hash}`;

  it('resolves after two 404s', async () => {
    const t = mainnet().on('GET', path, reply(f(txMissing)), reply(f(txMissing)), reply(f(txMain)));
    const clock = new FakeClock();
    const result = await new RestChainClient(t, MAINNET).waitForTx(hash, { clock });
    expect(result).toEqual({
      height: BigInt(txMain.body.tx_response.height),
      code: 0,
      rawLog: '',
      gasUsed: BigInt(txMain.body.tx_response.gas_used),
    });
    expect(t.requests).toHaveLength(3);
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it('returns a failed transaction without throwing', async () => {
    const body = {
      tx_response: { ...txMain.body.tx_response, code: 5, raw_log: 'insufficient funds' },
    };
    const t = mainnet().on('GET', path, json(200, body));
    expect(
      await new RestChainClient(t, MAINNET).waitForTx(hash, { clock: new FakeClock() }),
    ).toMatchObject({
      code: 5,
      rawLog: 'insufficient funds',
    });
  });

  it('times out with TxTimeoutError', async () => {
    const t = mainnet().on('GET', path, reply(f(txMissing)));
    const clock = new FakeClock();
    const err = await new RestChainClient(t, MAINNET)
      .waitForTx(hash, { clock, intervalMs: 1000, timeoutMs: 5000 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TxTimeoutError);
    expect(t.requests).toHaveLength(6);
    expect(clock.sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
  });
});

describe('amounts are never numbers', () => {
  it('types every on-chain amount as bigint or string', () => {
    type Result<K extends keyof ChainClient> = Awaited<ReturnType<ChainClient[K]>>;
    expectTypeOf<Result<'supply'>>().toEqualTypeOf<bigint>();
    expectTypeOf<Result<'balances'>>().toEqualTypeOf<Map<string, bigint>>();
    expectTypeOf<Result<'account'>>().toEqualTypeOf<{
      accountNumber: bigint;
      sequence: bigint;
      pubKey: Uint8Array | null;
    } | null>();
    expectTypeOf<Result<'simulate'>['gasUsed']>().toEqualTypeOf<bigint>();
    expectTypeOf<Result<'waitForTx'>['gasUsed']>().toEqualTypeOf<bigint>();
    expectTypeOf<Result<'waitForTx'>['height']>().toEqualTypeOf<bigint>();
    expectTypeOf<Result<'feeParams'>['minGasPrice']['amount']>().toEqualTypeOf<string>();
    expectTypeOf<
      Result<'tradebinParams'>['minNativeLiquidityForModuleSwap']
    >().toEqualTypeOf<bigint>();
    expectTypeOf<Result<'liquidityPools'>[number]['reserveBase']>().toEqualTypeOf<bigint>();
    expectTypeOf<Result<'liquidityPools'>[number]['reserveQuote']>().toEqualTypeOf<bigint>();
  });
});
