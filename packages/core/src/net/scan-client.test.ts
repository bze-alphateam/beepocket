import { describe, expect, expectTypeOf, it } from 'vitest';
import activityMain from '../../test/fixtures/scan/mainnet/activity.json';
import tokenMain from '../../test/fixtures/scan/mainnet/token.json';
import tokenFactory from '../../test/fixtures/scan/mainnet/token-factory.json';
import tokenMissing from '../../test/fixtures/scan/mainnet/token-missing.json';
import { json, MockTransport, type Fixture } from '../../test/support';
import {
  HttpScanClient,
  HttpStatusError,
  MAINNET,
  UnexpectedResponseError,
  type ScanClient,
} from '../index';

const f = (x: unknown) => x as Fixture;
const address = activityMain.path.split('/')[4] ?? '';

function mainnet(): MockTransport {
  return new MockTransport(MAINNET.scan);
}

describe('HttpScanClient.token', () => {
  it('reads the native token', async () => {
    const t = mainnet().replay(f(tokenMain));
    expect(await new HttpScanClient(t, MAINNET).token('ubze')).toEqual({
      denom: 'ubze',
      symbol: 'BZE',
      name: 'BeeZee',
      exponent: 6,
      kind: 'native',
      halted: false,
    });
  });

  it('URL-encodes a factory denom', async () => {
    const t = mainnet().replay(f(tokenFactory));
    const token = await new HttpScanClient(t, MAINNET).token(tokenFactory.body.denom);
    expect(token?.symbol).toBe('VDL');
    expect(t.requests[0]?.url).toBe(`${MAINNET.scan}${tokenFactory.path}`);
    expect(t.requests[0]?.url).toContain('%2F');
  });

  it('is null on 404', async () => {
    const t = mainnet().replay(f(tokenMissing));
    expect(await new HttpScanClient(t, MAINNET).token('factory/bze1nobody/unone')).toBeNull();
  });

  it('accepts null symbol and name', async () => {
    const body = { ...tokenMain.body, symbol: null, name: null };
    const t = mainnet().on('GET', tokenMain.path, json(200, body));
    expect(await new HttpScanClient(t, MAINNET).token('ubze')).toMatchObject({
      symbol: null,
      name: null,
    });
  });

  it('names a missing field', async () => {
    const body: Record<string, unknown> = { ...tokenMain.body };
    delete body.halted;
    const t = mainnet().on('GET', tokenMain.path, json(200, body));
    await expect(new HttpScanClient(t, MAINNET).token('ubze')).rejects.toMatchObject({
      path: 'halted',
    });
  });

  it('fails on a server error', async () => {
    const t = mainnet().on('GET', tokenMain.path, { status: 500, body: '' });
    await expect(new HttpScanClient(t, MAINNET).token('ubze')).rejects.toBeInstanceOf(
      HttpStatusError,
    );
  });
});

describe('HttpScanClient.asset', () => {
  const VDL = tokenFactory.body.denom;
  const path = `/api/v1/registry/assets/${encodeURIComponent(VDL)}`;
  const logo =
    'https://raw.githubusercontent.com/cosmos/chain-registry/master/beezee/images/vdl.png';

  it('reads the logo, URL-encoding the denom', async () => {
    const t = mainnet().on('GET', path, json(200, { denom: VDL, kind: 'factory', logo }));
    expect(await new HttpScanClient(t, MAINNET).asset(VDL)).toEqual({
      denom: VDL,
      logo,
      ticker: null,
      name: null,
      decimals: null,
    });
    expect(t.requests[0]?.url).toContain('%2F');
  });

  it('accepts a null logo', async () => {
    const t = mainnet().on('GET', path, json(200, { denom: VDL, logo: null }));
    expect(await new HttpScanClient(t, MAINNET).asset(VDL)).toMatchObject({
      denom: VDL,
      logo: null,
    });
  });

  it('reads the ticker, name and decimals when Scan lists them', async () => {
    const t = mainnet().on(
      'GET',
      path,
      json(200, { denom: VDL, logo: null, ticker: 'VDL', name: 'Vidulum', decimals: 6 }),
    );
    expect(await new HttpScanClient(t, MAINNET).asset(VDL)).toEqual({
      denom: VDL,
      logo: null,
      ticker: 'VDL',
      name: 'Vidulum',
      decimals: 6,
    });
  });

  it('fails on decimals out of range', async () => {
    const t = mainnet().on('GET', path, json(200, { denom: VDL, logo: null, decimals: 30 }));
    await expect(new HttpScanClient(t, MAINNET).asset(VDL)).rejects.toMatchObject({
      path: 'decimals',
    });
  });

  it('is null when Scan answers for another denom', async () => {
    const t = mainnet().on('GET', path, json(200, { denom: 'ubze', logo }));
    expect(await new HttpScanClient(t, MAINNET).asset(VDL)).toBeNull();
  });

  it("is null on Scan's not_found", async () => {
    const t = mainnet().on('GET', path, json(404, { error: { code: 'not_found' } }));
    expect(await new HttpScanClient(t, MAINNET).asset(VDL)).toBeNull();
  });

  it('fails on a server error and on a logo that is not a string', async () => {
    const down = mainnet().on('GET', path, { status: 500, body: '' });
    await expect(new HttpScanClient(down, MAINNET).asset(VDL)).rejects.toBeInstanceOf(
      HttpStatusError,
    );
    const odd = mainnet().on('GET', path, json(200, { denom: VDL, logo: 7 }));
    await expect(new HttpScanClient(odd, MAINNET).asset(VDL)).rejects.toMatchObject({
      path: 'logo',
    });
  });
});

describe('HttpScanClient.activity', () => {
  it('maps the rows and sends denom and limit', async () => {
    const t = mainnet().on(
      'GET',
      `/api/v1/accounts/${address}/activity?denom=ubze&limit=10`,
      json(200, activityMain.body),
    );
    const page = await new HttpScanClient(t, MAINNET).activity(address, {
      denom: 'ubze',
      limit: 10,
    });
    const first = activityMain.body.items[0];
    expect(page.items).toHaveLength(activityMain.body.items.length);
    expect(page.items[0]).toEqual({
      time: first?.time,
      height: first?.height,
      txHash: first?.tx_hash,
      kind: 'send',
      category: 'received',
      isSigner: false,
      success: true,
      counterparty: { address: first?.counterparty.address, label: null, moniker: null },
      deltas: [
        {
          denom: first?.deltas[0]?.denom,
          amount: BigInt(first?.deltas[0]?.amount ?? ''),
          symbol: 'CTL',
          exponent: 6,
        },
      ],
      msgTypes: ['/cosmos.bank.v1beta1.MsgMultiSend'],
      fee: null,
    });
    expect(page.nextCursor).toBeNull();
  });

  it('omits denom and passes the cursor, URL-encoded', async () => {
    const t = mainnet().on(
      'GET',
      `/api/v1/accounts/${address}/activity?limit=5&cursor=a%2Bb%3D`,
      json(200, { items: [], next_cursor: 'next' }),
    );
    const page = await new HttpScanClient(t, MAINNET).activity(address, {
      limit: 5,
      cursor: 'a+b=',
    });
    expect(page).toEqual({ items: [], nextCursor: 'next' });
  });

  it('reads signed deltas, a fee, a labelled counterparty and a block-level row', async () => {
    const row = {
      time: '2026-10-31T00:00:00Z',
      height: 7,
      tx_hash: null,
      kind: 'reward',
      category: 'staking',
      is_signer: true,
      success: true,
      counterparty: {
        address: 'bze1v',
        label: { name: 'Bonded tokens pool', kind: 'module' },
        moniker: 'Val',
      },
      deltas: [{ denom: 'ubze', amount: '-1500', symbol: null, exponent: null }],
      msg_types: [],
      details: { anything: true },
      fee: [{ denom: 'ubze', amount: '300', symbol: 'BZE', exponent: 6 }],
    };
    const t = mainnet().on(
      'GET',
      `/api/v1/accounts/${address}/activity?limit=1`,
      json(200, { items: [row], next_cursor: null }),
    );
    const [got] = (await new HttpScanClient(t, MAINNET).activity(address, { limit: 1 })).items;
    expect(got?.txHash).toBeNull();
    expect(got?.deltas[0]?.amount).toBe(-1500n);
    expect(got?.fee?.[0]?.amount).toBe(300n);
    expect(got?.counterparty?.label).toEqual({ name: 'Bonded tokens pool', kind: 'module' });
  });

  it('names the path of a bad field', async () => {
    const row = { ...activityMain.body.items[0], success: 'yes' };
    const t = mainnet().on(
      'GET',
      `/api/v1/accounts/${address}/activity?limit=1`,
      json(200, { items: [row], next_cursor: null }),
    );
    await expect(
      new HttpScanClient(t, MAINNET).activity(address, { limit: 1 }),
    ).rejects.toMatchObject({
      path: 'items[0].success',
    });
  });

  it('names a bad delta amount', async () => {
    const row = {
      ...activityMain.body.items[0],
      deltas: [{ denom: 'ubze', amount: 5, symbol: null, exponent: null }],
    };
    const t = mainnet().on(
      'GET',
      `/api/v1/accounts/${address}/activity?limit=1`,
      json(200, { items: [row], next_cursor: null }),
    );
    await expect(
      new HttpScanClient(t, MAINNET).activity(address, { limit: 1 }),
    ).rejects.toMatchObject({
      path: 'items[0].deltas[0].amount',
    });
  });
});

describe('amounts are never numbers', () => {
  it('types activity amounts as bigint', () => {
    type Page = Awaited<ReturnType<ScanClient['activity']>>;
    expectTypeOf<Page['items'][number]['deltas'][number]['amount']>().toEqualTypeOf<bigint>();
    expectTypeOf<
      NonNullable<Page['items'][number]['fee']>[number]['amount']
    >().toEqualTypeOf<bigint>();
  });
});

describe('HttpScanClient hardening', () => {
  it("treats a 404 that is not Scan's not_found as an error", async () => {
    const t = mainnet().on('GET', tokenMain.path, { status: 404, body: '<html>nginx</html>' });
    await expect(new HttpScanClient(t, MAINNET).token('ubze')).rejects.toBeInstanceOf(
      HttpStatusError,
    );
  });

  it('rejects an exponent outside 0..18', async () => {
    const t = mainnet().on('GET', tokenMain.path, json(200, { ...tokenMain.body, exponent: 99 }));
    await expect(new HttpScanClient(t, MAINNET).token('ubze')).rejects.toMatchObject({
      path: 'exponent',
    });
  });

  it('rejects a body that is not JSON', async () => {
    const bad = { status: 200, body: 'not json' };
    const t = mainnet()
      .on('GET', tokenMain.path, bad)
      .on('GET', `/api/v1/accounts/${address}/activity?limit=1`, bad);
    const client = new HttpScanClient(t, MAINNET);
    await expect(client.token('ubze')).rejects.toBeInstanceOf(UnexpectedResponseError);
    await expect(client.activity(address, { limit: 1 })).rejects.toBeInstanceOf(
      UnexpectedResponseError,
    );
  });
});
