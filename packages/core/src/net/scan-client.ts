import { HttpStatusError } from './errors';
import type { Network } from './networks';
import type { HttpTransport } from './transport';
import * as v from './validate';

export interface ScanToken {
  denom: string;
  /** Null while Scan has no display data for the denom. */
  symbol: string | null;
  name: string | null;
  /** Decimals of the display unit. */
  exponent: number;
  /** Scan's token kind, e.g. `native`, `factory`, `ibc`, `lp`. */
  kind: string;
  halted: boolean;
}

export interface ScanBalance {
  denom: string;
  /** Signed: deltas are net balance changes. */
  amount: bigint;
  symbol: string | null;
  exponent: number | null;
}

export interface ScanLabel {
  name: string;
  kind: string;
}

export interface ScanCounterparty {
  address: string;
  label: ScanLabel | null;
  moniker: string | null;
}

export interface ActivityRow {
  /** RFC 3339 timestamp. */
  time: string;
  height: number;
  /** Null for block-level rows. */
  txHash: string | null;
  kind: string;
  category: string;
  isSigner: boolean;
  success: boolean;
  /** Null when there is not exactly one other party. */
  counterparty: ScanCounterparty | null;
  deltas: ScanBalance[];
  msgTypes: string[];
  /** The fee, when the address signed or paid the transaction. */
  fee: ScanBalance[] | null;
}

export interface ActivityQuery {
  /** Only rows touching this denom (needs Scan with BFE-324; ignored by older versions). */
  denom?: string;
  limit: number;
  cursor?: string;
}

export interface ActivityPage {
  items: ActivityRow[];
  /** Pass as `cursor` to get the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** Read access to the BZE Scan API. */
export interface ScanClient {
  /** `null` when Scan does not know the denom. */
  token(denom: string): Promise<ScanToken | null>;
  activity(address: string, query: ActivityQuery): Promise<ActivityPage>;
}

export class HttpScanClient implements ScanClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly network: Network,
  ) {}

  async token(denom: string): Promise<ScanToken | null> {
    const body = await this.getJson(`/api/v1/tokens/${encodeURIComponent(denom)}`, true);
    if (body === null) return null;
    const t = v.object(body, '$');
    return {
      denom: v.string(v.field(t, 'denom', '$'), 'denom'),
      symbol: v.nullable(v.field(t, 'symbol', '$'), 'symbol', v.string),
      name: v.nullable(v.field(t, 'name', '$'), 'name', v.string),
      exponent: v.safeInteger(v.field(t, 'exponent', '$'), 'exponent'),
      kind: v.string(v.field(t, 'kind', '$'), 'kind'),
      halted: v.boolean(v.field(t, 'halted', '$'), 'halted'),
    };
  }

  async activity(address: string, query: ActivityQuery): Promise<ActivityPage> {
    const params = new URLSearchParams();
    if (query.denom !== undefined) params.set('denom', query.denom);
    params.set('limit', String(query.limit));
    if (query.cursor !== undefined) params.set('cursor', query.cursor);
    const body = v.object(
      await this.getJson(
        `/api/v1/accounts/${encodeURIComponent(address)}/activity?${params.toString()}`,
      ),
      '$',
    );
    return {
      items: v.arrayOf(v.field(body, 'items', '$'), 'items', readActivityRow),
      nextCursor: v.nullable(v.field(body, 'next_cursor', '$'), 'next_cursor', v.string),
    };
  }

  private async getJson(path: string, allowNotFound = false): Promise<unknown> {
    const url = this.network.scan + path;
    const res = await this.transport.request({ method: 'GET', url });
    if (res.status === 404 && allowNotFound) return null;
    if (res.status !== 200) throw new HttpStatusError(res.status, url);
    return v.parseJson(res.body);
  }
}

function readBalance(raw: unknown, path: string): ScanBalance {
  const b = v.object(raw, path);
  return {
    denom: v.string(v.field(b, 'denom', path), `${path}.denom`),
    amount: v.intString(v.field(b, 'amount', path), `${path}.amount`),
    symbol: v.nullable(v.field(b, 'symbol', path), `${path}.symbol`, v.string),
    exponent: v.nullable(v.field(b, 'exponent', path), `${path}.exponent`, v.safeInteger),
  };
}

function readCounterparty(raw: unknown, path: string): ScanCounterparty {
  const c = v.object(raw, path);
  return {
    address: v.string(v.field(c, 'address', path), `${path}.address`),
    label: v.nullable(v.field(c, 'label', path), `${path}.label`, (l, p) => {
      const label = v.object(l, p);
      return {
        name: v.string(v.field(label, 'name', p), `${p}.name`),
        kind: v.string(v.field(label, 'kind', p), `${p}.kind`),
      };
    }),
    moniker: v.nullable(v.field(c, 'moniker', path), `${path}.moniker`, v.string),
  };
}

function readActivityRow(raw: unknown, path: string): ActivityRow {
  const r = v.object(raw, path);
  return {
    time: v.string(v.field(r, 'time', path), `${path}.time`),
    height: v.safeInteger(v.field(r, 'height', path), `${path}.height`),
    txHash: v.nullable(v.field(r, 'tx_hash', path), `${path}.tx_hash`, v.string),
    kind: v.string(v.field(r, 'kind', path), `${path}.kind`),
    category: v.string(v.field(r, 'category', path), `${path}.category`),
    isSigner: v.boolean(v.field(r, 'is_signer', path), `${path}.is_signer`),
    success: v.boolean(v.field(r, 'success', path), `${path}.success`),
    counterparty: v.nullable(
      v.field(r, 'counterparty', path),
      `${path}.counterparty`,
      readCounterparty,
    ),
    deltas: v.arrayOf(v.field(r, 'deltas', path), `${path}.deltas`, readBalance),
    msgTypes: v.arrayOf(v.field(r, 'msg_types', path), `${path}.msg_types`, v.string),
    fee: v.nullable(v.field(r, 'fee', path), `${path}.fee`, (f, p) => v.arrayOf(f, p, readBalance)),
  };
}
