import { createServer, type Server } from 'node:http';

export interface MockReply {
  status: number;
  body: unknown;
}

const FACTORY = 'factory/bze1recorded/gold';

/** gRPC-gateway "not found", as nodes answer for unknown metadata / branding. */
const NOT_FOUND: MockReply = { status: 404, body: { code: 5, message: 'not found', details: [] } };

const FACTORY_METADATA = {
  metadata: {
    description: 'Gold',
    denom_units: [
      { denom: FACTORY, exponent: 0, aliases: [] },
      { denom: 'GOLD', exponent: 6, aliases: [] },
    ],
    base: FACTORY,
    display: 'GOLD',
    name: 'Gold Coin',
    symbol: 'GOLD',
  },
};

const FACTORY_BRANDING = {
  branding: {
    font: 'inter',
    light: { background: '#FFFFFF', text: '#111111', primary: '#CC8800', secondary: '#888888' },
    dark: { background: '#000000', text: '#EEEEEE', primary: '#FFB000', secondary: '#777777' },
  },
};

/**
 * Recorded-style answers of a BZE node (REST) and BZE Scan, keyed by path. The e2e specs route
 * the extension's network requests here; unknown paths are a 404 so a stray request fails loudly.
 */
export function mockReply(pathAndQuery: string): MockReply {
  const url = new URL(pathAndQuery, 'http://mock.invalid');
  const denom = url.searchParams.get('denom');
  switch (url.pathname) {
    case '/health':
      return { status: 200, body: { status: 'ok' } };
    case '/cosmos/bank/v1beta1/supply/by_denom':
      return {
        status: 200,
        body: { amount: { denom, amount: denom === FACTORY ? '1000000' : '0' } },
      };
    case '/cosmos/bank/v1beta1/denoms_metadata_by_query_string':
      return denom === FACTORY ? { status: 200, body: FACTORY_METADATA } : NOT_FOUND;
    case '/bze/tokenfactory/denom_branding':
      return denom === FACTORY ? { status: 200, body: FACTORY_BRANDING } : NOT_FOUND;
    default:
      return { status: 404, body: { code: 12, message: 'not implemented' } };
  }
}

export const mockFactoryDenom = FACTORY;

export function startMockServer(port = 0): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const reply = mockReply(req.url ?? '/');
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({ server, url: `http://127.0.0.1:${String(actual)}` });
    });
  });
}
