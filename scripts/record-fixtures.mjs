#!/usr/bin/env node
// Records real, public responses of the BZE REST nodes and the BZE Scan API
// into packages/core/test/fixtures/{rest,scan}/<network>/<name>.json. Each file
// is { method, path, status, body } so unit tests and the e2e mock servers
// replay the exact request/response pairs. Run: node scripts/record-fixtures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages/core/test/fixtures');

const NETWORKS = {
  mainnet: {
    rest: 'https://rest.getbze.com',
    scan: 'https://explorer.getbze.com',
    // A factory token with on-chain bank metadata.
    token: 'factory/bze13gzq40che93tgfm9kzmkpjamah5nj0j73pyhqk/uvdl',
  },
  testnet: {
    rest: 'https://testnet.getbze.com',
    scan: 'https://testnet-explorer.getbze.com',
    token: 'factory/bze1z3mkcr2jz424w6m49frgjmy9uhlrx69phqwg3l/vidulum',
  },
};

const enc = encodeURIComponent;

async function call(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    redirect: 'error',
    headers: {
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { method, path, status: res.status, body: parsed };
}

function save(kind, network, name, entry) {
  const dir = join(root, kind, network);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(entry, null, 2)}\n`);
  console.log(`${kind}/${network}/${name}  ${entry.method} ${entry.path} -> ${entry.status}`);
}

// Public data only: an address with several balances, found via Scan's top
// holders of the native token (module accounts have a label and are skipped).
async function findAddress(net) {
  const holders = await call(net.scan, 'GET', '/api/v1/tokens/ubze/holders?limit=100');
  const items = Array.isArray(holders.body?.items) ? holders.body.items : [];
  for (const h of items.filter((i) => i.label === null)) {
    const bal = await call(net.rest, 'GET', `/cosmos/bank/v1beta1/balances/${h.address}`);
    const n = bal.body?.balances?.length ?? 0;
    if (n >= 2) {
      const act = await call(net.scan, 'GET', `/api/v1/accounts/${h.address}/activity?limit=10`);
      if (act.body?.items?.some((i) => i.tx_hash)) return h.address;
    }
  }
  throw new Error('no suitable address found');
}

for (const [network, net] of Object.entries(NETWORKS)) {
  let address;
  try {
    address = await findAddress(net);
  } catch (e) {
    console.warn(`${network}: ${e.message}, skipping account-bound fixtures`);
  }
  const rest = (name, method, path, body) =>
    call(net.rest, method, path, body).then((e) => save('rest', network, name, e));
  const scan = (name, path) =>
    call(net.scan, 'GET', path).then((e) => save('scan', network, name, e));

  if (address) {
    await rest('account', 'GET', `/cosmos/auth/v1beta1/accounts/${address}`);
    await rest(
      'balances-page1',
      'GET',
      `/cosmos/bank/v1beta1/balances/${address}?pagination.limit=1`,
    );
    const p1 = await call(
      net.rest,
      'GET',
      `/cosmos/bank/v1beta1/balances/${address}?pagination.limit=1`,
    );
    const key = p1.body?.pagination?.next_key;
    if (key) {
      await rest(
        'balances-page2',
        'GET',
        `/cosmos/bank/v1beta1/balances/${address}?pagination.limit=1&pagination.key=${enc(key)}`,
      );
    }
    await rest('balances', 'GET', `/cosmos/bank/v1beta1/balances/${address}`);
    await scan('activity', `/api/v1/accounts/${address}/activity?limit=10`);
    const act = await call(net.scan, 'GET', `/api/v1/accounts/${address}/activity?limit=10`);
    const tx = act.body.items.find((i) => i.tx_hash);
    if (tx) await rest('tx', 'GET', `/cosmos/tx/v1beta1/txs/${tx.tx_hash}`);
  }

  await rest('supply', 'GET', `/cosmos/bank/v1beta1/supply/by_denom?denom=${enc('ubze')}`);
  await rest(
    'denom-metadata',
    'GET',
    `/cosmos/bank/v1beta1/denoms_metadata_by_query_string?denom=${enc(net.token)}`,
  );
  await rest(
    'denom-metadata-missing',
    'GET',
    `/cosmos/bank/v1beta1/denoms_metadata_by_query_string?denom=${enc('ubze')}`,
  );
  await rest('denom-branding', 'GET', `/bze/tokenfactory/denom_branding?denom=${enc(net.token)}`);
  await rest(
    'denom-branding-missing',
    'GET',
    `/bze/tokenfactory/denom_branding?denom=${enc('ubze')}`,
  );
  await rest('fee-params', 'GET', '/bze/txfeecollector/params');
  await rest('tradebin-params', 'GET', '/bze/tradebin/params');
  await rest('liquidity-pools', 'GET', '/bze/tradebin/all_liquidity_pools');
  await rest(
    'liquidity-pools-page1',
    'GET',
    '/bze/tradebin/all_liquidity_pools?pagination.limit=1',
  );
  const lp = await call(net.rest, 'GET', '/bze/tradebin/all_liquidity_pools?pagination.limit=1');
  if (lp.body?.pagination?.next_key) {
    await rest(
      'liquidity-pools-page2',
      'GET',
      `/bze/tradebin/all_liquidity_pools?pagination.limit=1&pagination.key=${enc(lp.body.pagination.next_key)}`,
    );
  }
  await rest('halted-denoms', 'GET', '/bze/tradebin/halted_denoms');
  // Garbage tx bytes: the node rejects them, nothing is executed or stored.
  const garbage = Buffer.from([1, 2, 3]).toString('base64');
  await rest('simulate-error', 'POST', '/cosmos/tx/v1beta1/simulate', { tx_bytes: garbage });
  await rest('broadcast-error', 'POST', '/cosmos/tx/v1beta1/txs', {
    tx_bytes: garbage,
    mode: 'BROADCAST_MODE_SYNC',
  });
  await rest('tx-missing', 'GET', `/cosmos/tx/v1beta1/txs/${'0'.repeat(64)}`);

  await scan('token', `/api/v1/tokens/${enc('ubze')}`);
  await scan('token-factory', `/api/v1/tokens/${enc(net.token)}`);
  await scan('token-missing', `/api/v1/tokens/${enc('factory/bze1nobody/unone')}`);
}
