import { bytesToBase64 } from './base64';
import type { Clock } from './clock';
import {
  BroadcastError,
  HttpStatusError,
  SimulationError,
  TxTimeoutError,
  UnexpectedResponseError,
} from './errors';
import type { Network } from './networks';
import type { HttpTransport } from './transport';
import * as v from './validate';

export interface Account {
  accountNumber: bigint;
  sequence: bigint;
  /** Compressed secp256k1 public key; null until the account has sent a transaction. */
  pubKey: Uint8Array | null;
}

export interface DenomMetadata {
  name: string;
  symbol: string;
  display: string;
  /** Exponent of the display unit (decimals of the token). */
  exponent: number;
  description: string;
}

/** `#RRGGBB` colours. */
export interface Palette {
  background: string;
  text: string;
  primary: string;
  secondary: string;
}

export interface DenomBranding {
  font: string;
  light: Palette;
  dark: Palette;
}

export interface FeeParams {
  /** Minimum gas price; `amount` is a decimal string, not parsed. */
  minGasPrice: { denom: string; amount: string };
}

export interface TradebinParams {
  nativeDenom: string;
  minNativeLiquidityForModuleSwap: bigint;
}

export interface Pool {
  id: string;
  base: string;
  quote: string;
  reserveBase: bigint;
  reserveQuote: bigint;
  /** Only present when the node reports it. */
  halted?: boolean;
}

export interface SimulationResult {
  gasUsed: bigint;
}

export interface BroadcastResult {
  txHash: string;
}

export interface TxResult {
  height: bigint;
  /** 0 is success. */
  code: number;
  rawLog: string;
  gasUsed: bigint;
}

export interface WaitForTxOptions {
  clock: Clock;
  /** Delay between polls, default 1000. */
  intervalMs?: number;
  /** Give up with `TxTimeoutError` after this long, default 60000. */
  timeoutMs?: number;
}

export interface ChainClientOptions {
  /** `pagination.limit` sent with paginated queries; the node's default when unset. */
  pageLimit?: number;
}

/** Read and broadcast access to a BZE node over REST. */
export interface ChainClient {
  /** `null` when the address has never been seen on chain. */
  account(address: string): Promise<Account | null>;
  balances(address: string): Promise<Map<string, bigint>>;
  supply(denom: string): Promise<bigint>;
  /** `null` when the denom has no bank metadata (e.g. `ubze`). */
  denomMetadata(denom: string): Promise<DenomMetadata | null>;
  /** `null` when the denom has no brand kit. */
  denomBranding(denom: string): Promise<DenomBranding | null>;
  feeParams(): Promise<FeeParams>;
  tradebinParams(): Promise<TradebinParams>;
  liquidityPools(): Promise<Pool[]>;
  haltedDenoms(): Promise<string[]>;
  /** Throws `SimulationError` when the node rejects the transaction. */
  simulate(txBytes: Uint8Array): Promise<SimulationResult>;
  /** Throws `BroadcastError` when the node rejects the transaction. */
  broadcast(txBytes: Uint8Array): Promise<BroadcastResult>;
  /** Polls until the transaction is included; throws `TxTimeoutError` when it is not. */
  waitForTx(txHash: string, options: WaitForTxOptions): Promise<TxResult>;
}

const BASE_ACCOUNT = '/cosmos.auth.v1beta1.BaseAccount';
const SECP256K1_PUBKEY = '/cosmos.crypto.secp256k1.PubKey';
const MAX_PAGES = 1000;

export class RestChainClient implements ChainClient {
  constructor(
    private readonly transport: HttpTransport,
    private readonly network: Network,
    private readonly options: ChainClientOptions = {},
  ) {}

  async account(address: string): Promise<Account | null> {
    const body = await this.getJson(
      `/cosmos/auth/v1beta1/accounts/${encodeURIComponent(address)}`,
      true,
    );
    if (body === null) return null;
    const account = v.object(v.field(v.object(body, '$'), 'account', '$'), 'account');
    const type = v.string(v.field(account, '@type', 'account'), 'account.@type');
    if (type !== BASE_ACCOUNT)
      throw new UnexpectedResponseError('account.@type', `unsupported account type ${type}`);
    const pubKey = v.nullable(
      v.field(account, 'pub_key', 'account'),
      'account.pub_key',
      (raw, path) => {
        const key = v.object(raw, path);
        const keyType = v.string(v.field(key, '@type', path), `${path}.@type`);
        if (keyType !== SECP256K1_PUBKEY)
          throw new UnexpectedResponseError(`${path}.@type`, `unsupported key type ${keyType}`);
        return v.base64(v.field(key, 'key', path), `${path}.key`);
      },
    );
    return {
      accountNumber: v.uintString(
        v.field(account, 'account_number', 'account'),
        'account.account_number',
      ),
      sequence: v.uintString(v.field(account, 'sequence', 'account'), 'account.sequence'),
      pubKey,
    };
  }

  async balances(address: string): Promise<Map<string, bigint>> {
    const coins = await this.paginate(
      `/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}`,
      'balances',
      (raw, path) => {
        const coin = v.object(raw, path);
        return {
          denom: v.string(v.field(coin, 'denom', path), `${path}.denom`),
          amount: v.uintString(v.field(coin, 'amount', path), `${path}.amount`),
        };
      },
    );
    return new Map(coins.map((c) => [c.denom, c.amount]));
  }

  async supply(denom: string): Promise<bigint> {
    const body = await this.getJson(
      `/cosmos/bank/v1beta1/supply/by_denom?denom=${encodeURIComponent(denom)}`,
    );
    const amount = v.object(v.field(v.object(body, '$'), 'amount', '$'), 'amount');
    return v.uintString(v.field(amount, 'amount', 'amount'), 'amount.amount');
  }

  async denomMetadata(denom: string): Promise<DenomMetadata | null> {
    const body = await this.getJson(
      `/cosmos/bank/v1beta1/denoms_metadata_by_query_string?denom=${encodeURIComponent(denom)}`,
      true,
    );
    if (body === null) return null;
    const meta = v.object(v.field(v.object(body, '$'), 'metadata', '$'), 'metadata');
    const display = v.string(v.field(meta, 'display', 'metadata'), 'metadata.display');
    const units = v.arrayOf(
      v.field(meta, 'denom_units', 'metadata'),
      'metadata.denom_units',
      (raw, path) => {
        const unit = v.object(raw, path);
        return {
          denom: v.string(v.field(unit, 'denom', path), `${path}.denom`),
          exponent: v.safeInteger(v.field(unit, 'exponent', path), `${path}.exponent`),
        };
      },
    );
    const displayUnit = units.find((u) => u.denom === display);
    if (!displayUnit) {
      throw new UnexpectedResponseError(
        'metadata.denom_units',
        `no unit named by display "${display}"`,
      );
    }
    return {
      name: v.string(v.field(meta, 'name', 'metadata'), 'metadata.name'),
      symbol: v.string(v.field(meta, 'symbol', 'metadata'), 'metadata.symbol'),
      display,
      exponent: displayUnit.exponent,
      description: v.string(v.field(meta, 'description', 'metadata'), 'metadata.description'),
    };
  }

  async denomBranding(denom: string): Promise<DenomBranding | null> {
    const body = await this.getJson(
      `/bze/tokenfactory/denom_branding?denom=${encodeURIComponent(denom)}`,
      true,
    );
    if (body === null) return null;
    const branding = v.object(v.field(v.object(body, '$'), 'branding', '$'), 'branding');
    const palette = (key: 'light' | 'dark'): Palette => {
      const path = `branding.${key}`;
      const p = v.object(v.field(branding, key, 'branding'), path);
      const color = (name: keyof Palette): string => {
        const value = v.string(v.field(p, name, path), `${path}.${name}`);
        if (!/^#[0-9A-Fa-f]{6}$/.test(value))
          throw new UnexpectedResponseError(`${path}.${name}`, 'expected #RRGGBB');
        return value;
      };
      return {
        background: color('background'),
        text: color('text'),
        primary: color('primary'),
        secondary: color('secondary'),
      };
    };
    return {
      font: v.string(v.field(branding, 'font', 'branding'), 'branding.font'),
      light: palette('light'),
      dark: palette('dark'),
    };
  }

  async feeParams(): Promise<FeeParams> {
    const body = await this.getJson('/bze/txfeecollector/params');
    const params = v.object(v.field(v.object(body, '$'), 'params', '$'), 'params');
    // The module's JSON names are PascalCase on the wire.
    const fee = v.object(
      v.field(params, 'ValidatorMinGasFee', 'params'),
      'params.ValidatorMinGasFee',
    );
    return {
      minGasPrice: {
        denom: v.string(
          v.field(fee, 'denom', 'params.ValidatorMinGasFee'),
          'params.ValidatorMinGasFee.denom',
        ),
        amount: v.decimalString(
          v.field(fee, 'amount', 'params.ValidatorMinGasFee'),
          'params.ValidatorMinGasFee.amount',
        ),
      },
    };
  }

  async tradebinParams(): Promise<TradebinParams> {
    const body = await this.getJson('/bze/tradebin/params');
    const params = v.object(v.field(v.object(body, '$'), 'params', '$'), 'params');
    // Mixed naming on the wire: `native_denom` is snake_case, the threshold camelCase.
    return {
      nativeDenom: v.string(v.field(params, 'native_denom', 'params'), 'params.native_denom'),
      minNativeLiquidityForModuleSwap: v.uintString(
        v.field(params, 'minNativeLiquidityForModuleSwap', 'params'),
        'params.minNativeLiquidityForModuleSwap',
      ),
    };
  }

  liquidityPools(): Promise<Pool[]> {
    return this.paginate('/bze/tradebin/all_liquidity_pools', 'list', (raw, path) => {
      const pool = v.object(raw, path);
      const result: Pool = {
        id: v.string(v.field(pool, 'id', path), `${path}.id`),
        base: v.string(v.field(pool, 'base', path), `${path}.base`),
        quote: v.string(v.field(pool, 'quote', path), `${path}.quote`),
        reserveBase: v.uintString(v.field(pool, 'reserve_base', path), `${path}.reserve_base`),
        reserveQuote: v.uintString(v.field(pool, 'reserve_quote', path), `${path}.reserve_quote`),
      };
      if ('halted' in pool) result.halted = v.boolean(pool.halted, `${path}.halted`);
      return result;
    });
  }

  haltedDenoms(): Promise<string[]> {
    return this.paginate('/bze/tradebin/halted_denoms', 'denoms', v.string);
  }

  async simulate(txBytes: Uint8Array): Promise<SimulationResult> {
    const res = await this.transport.request({
      method: 'POST',
      url: this.url('/cosmos/tx/v1beta1/simulate'),
      body: JSON.stringify({ tx_bytes: bytesToBase64(txBytes) }),
    });
    if (res.status !== 200)
      throw new SimulationError(nodeMessage(res.body) ?? `HTTP ${String(res.status)}`, res.status);
    const body = v.object(v.parseJson(res.body), '$');
    const info = v.object(v.field(body, 'gas_info', '$'), 'gas_info');
    return { gasUsed: v.uintString(v.field(info, 'gas_used', 'gas_info'), 'gas_info.gas_used') };
  }

  async broadcast(txBytes: Uint8Array): Promise<BroadcastResult> {
    const res = await this.transport.request({
      method: 'POST',
      url: this.url('/cosmos/tx/v1beta1/txs'),
      body: JSON.stringify({ tx_bytes: bytesToBase64(txBytes), mode: 'BROADCAST_MODE_SYNC' }),
    });
    if (res.status !== 200) {
      // The gateway rejected the request before the node ran CheckTx.
      throw new BroadcastError(
        nodeCode(res.body) ?? res.status,
        'rest',
        nodeMessage(res.body) ?? `HTTP ${String(res.status)}`,
      );
    }
    const body = v.object(v.parseJson(res.body), '$');
    const tx = v.object(v.field(body, 'tx_response', '$'), 'tx_response');
    const code = v.safeInteger(v.field(tx, 'code', 'tx_response'), 'tx_response.code');
    if (code !== 0) {
      throw new BroadcastError(
        code,
        'codespace' in tx ? v.string(tx.codespace, 'tx_response.codespace') : '',
        'raw_log' in tx ? v.string(tx.raw_log, 'tx_response.raw_log') : '',
      );
    }
    return { txHash: v.string(v.field(tx, 'txhash', 'tx_response'), 'tx_response.txhash') };
  }

  async waitForTx(txHash: string, options: WaitForTxOptions): Promise<TxResult> {
    const { clock, intervalMs = 1000, timeoutMs = 60_000 } = options;
    const deadline = clock.now() + timeoutMs;
    for (;;) {
      const body = await this.getJson(`/cosmos/tx/v1beta1/txs/${encodeURIComponent(txHash)}`, true);
      if (body !== null) {
        const tx = v.object(v.field(v.object(body, '$'), 'tx_response', '$'), 'tx_response');
        return {
          height: v.uintString(v.field(tx, 'height', 'tx_response'), 'tx_response.height'),
          code: v.safeInteger(v.field(tx, 'code', 'tx_response'), 'tx_response.code'),
          rawLog: v.string(v.field(tx, 'raw_log', 'tx_response'), 'tx_response.raw_log'),
          gasUsed: v.uintString(v.field(tx, 'gas_used', 'tx_response'), 'tx_response.gas_used'),
        };
      }
      if (clock.now() + intervalMs > deadline) throw new TxTimeoutError(txHash, timeoutMs);
      await clock.sleep(intervalMs);
    }
  }

  private url(path: string): string {
    return this.network.rest + path;
  }

  /** GET and parse; with `allowNotFound` a 404 gives `null`, otherwise any non-200 throws. */
  private async getJson(path: string, allowNotFound = false): Promise<unknown> {
    const url = this.url(path);
    const res = await this.transport.request({ method: 'GET', url });
    if (res.status === 404 && allowNotFound) return null;
    if (res.status !== 200) throw new HttpStatusError(res.status, url);
    return v.parseJson(res.body);
  }

  /** Collects `listField` across pages by following `pagination.next_key`. */
  private async paginate<T>(
    path: string,
    listField: string,
    read: (item: unknown, path: string) => T,
  ): Promise<T[]> {
    const items: T[] = [];
    const seen = new Set<string>();
    let key: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const params: string[] = [];
      if (this.options.pageLimit !== undefined)
        params.push(`pagination.limit=${String(this.options.pageLimit)}`);
      if (key !== null) params.push(`pagination.key=${encodeURIComponent(key)}`);
      const sep = path.includes('?') ? '&' : '?';
      const body = v.object(
        await this.getJson(params.length ? `${path}${sep}${params.join('&')}` : path),
        '$',
      );
      items.push(...v.arrayOf(v.field(body, listField, '$'), listField, read));

      const pagination = body.pagination;
      key = null;
      if (pagination !== undefined && pagination !== null) {
        const next = v.object(pagination, 'pagination').next_key;
        key = next === undefined || next === null ? null : v.string(next, 'pagination.next_key');
      }
      if (key === null || key === '') return items;
      if (seen.has(key)) throw new UnexpectedResponseError('pagination.next_key', 'repeated key');
      seen.add(key);
    }
    throw new UnexpectedResponseError(
      'pagination.next_key',
      `more than ${String(MAX_PAGES)} pages`,
    );
  }
}

function nodeMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'message' in parsed &&
      typeof parsed.message === 'string'
    ) {
      return parsed.message;
    }
  } catch {
    // not JSON
  }
  return null;
}

function nodeCode(body: string): number | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'code' in parsed &&
      typeof parsed.code === 'number'
    ) {
      return parsed.code;
    }
  } catch {
    // not JSON
  }
  return null;
}
