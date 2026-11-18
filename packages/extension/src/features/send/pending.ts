import type { SessionStorage } from '../../platform';

/** After a signed send, a new one from the same address waits this long (about five blocks). */
export const PENDING_WINDOW_MS = 30_000;
/** A wallet send can only be included up to this many blocks after the latest one. */
export const TIMEOUT_BLOCKS = 30n;

/** The last send an address signed. Amounts and heights are decimal strings. */
export interface PendingSend {
  /** The hash of the signed bytes, uppercase hex. */
  txHash: string;
  sequence: string;
  /** The last block that may include it. */
  timeoutHeight: string;
  /** `Clock.now()` when it was signed. */
  signedAt: number;
}

/** The last signed send of each address on one network. */
export interface PendingSends {
  get(address: string): Promise<PendingSend | null>;
  record(address: string, send: PendingSend): Promise<void>;
  /** Forgets the send with this hash: it was found on chain. */
  settle(txHash: string): Promise<void>;
}

const UINT = /^\d{1,30}$/;
const HASH = /^[0-9A-F]{64}$/;

function isPendingSend(x: unknown): x is PendingSend {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.txHash === 'string' &&
    HASH.test(p.txHash) &&
    typeof p.sequence === 'string' &&
    UINT.test(p.sequence) &&
    typeof p.timeoutHeight === 'string' &&
    UINT.test(p.timeoutHeight) &&
    typeof p.signedAt === 'number' &&
    Number.isFinite(p.signedAt)
  );
}

/** Kept in session storage: it survives a worker restart, not a browser restart. */
export class SessionPendingSends implements PendingSends {
  private readonly key: string;

  constructor(
    private readonly session: SessionStorage,
    networkId: string,
  ) {
    this.key = `send.pending:${networkId}`;
  }

  async get(address: string): Promise<PendingSend | null> {
    const entry = (await this.all())[address];
    return entry ?? null;
  }

  async record(address: string, send: PendingSend): Promise<void> {
    const all = await this.all();
    all[address] = send;
    await this.session.set(this.key, all);
  }

  async settle(txHash: string): Promise<void> {
    const all = await this.all();
    const hash = txHash.toUpperCase();
    const kept = Object.fromEntries(Object.entries(all).filter(([, s]) => s.txHash !== hash));
    if (Object.keys(kept).length !== Object.keys(all).length) {
      await this.session.set(this.key, kept);
    }
  }

  /** Entries in any other shape are dropped. */
  private async all(): Promise<Record<string, PendingSend>> {
    const stored = await this.session.get(this.key);
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
    const all: Record<string, PendingSend> = {};
    for (const [address, send] of Object.entries(stored as Record<string, unknown>)) {
      if (isPendingSend(send)) all[address] = send;
    }
    return all;
  }
}
