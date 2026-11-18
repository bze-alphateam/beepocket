import type { SessionStorage } from '../../platform';

/** After a signed send, a new one from the same address waits this long (about five blocks). */
export const PENDING_WINDOW_MS = 30_000;
/** A wallet send can only be included up to this many blocks after the latest one. */
export const TIMEOUT_BLOCKS = 30n;
/** The most unsettled sends kept per address; older ones are dropped first. */
const MAX_KEPT = 10;

/** A send an address signed. Heights and the sequence are decimal strings. */
export interface PendingSend {
  /** The hash of the signed bytes, uppercase hex. */
  txHash: string;
  sequence: string;
  /** The last block that may include it. */
  timeoutHeight: string;
  /** `Clock.now()` when it was signed. */
  signedAt: number;
}

/** The sends each address signed on one network that are not yet known to be committed. */
export interface PendingSends {
  /**
   * In one step: refuses (null) while a send of this address is being signed or one was signed
   * less than `PENDING_WINDOW_MS` before `now`; otherwise marks the address as signing and
   * returns its unsettled sends. Every claim ends with `release`.
   */
  claim(address: string, now: number): Promise<PendingSend[] | null>;
  /** Adds a signed send; sends that can no longer be included at `height` are dropped. */
  record(address: string, send: PendingSend, height: bigint): Promise<void>;
  /** Ends a claim; recorded sends stay. */
  release(address: string): Promise<void>;
  /** Forgets the send with this hash: it was found committed. */
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

/** What every store over the same session storage shares: one queue and the claimed addresses. */
interface Shared {
  queue: Promise<unknown>;
  signing: Set<string>;
}

const shared = new WeakMap<SessionStorage, Shared>();

/**
 * Kept in session storage: it survives a worker restart, not a browser restart. Stores are built
 * per request, so the queue and the claims belong to the session storage they all write to:
 * every read-and-write runs alone.
 */
export class SessionPendingSends implements PendingSends {
  private readonly key: string;
  private readonly shared: Shared;

  constructor(
    private readonly session: SessionStorage,
    private readonly networkId: string,
  ) {
    this.key = `send.pending:${networkId}`;
    let s = shared.get(session);
    if (!s) {
      s = { queue: Promise.resolve(), signing: new Set() };
      shared.set(session, s);
    }
    this.shared = s;
  }

  claim(address: string, now: number): Promise<PendingSend[] | null> {
    return this.serial(async () => {
      const id = this.signingId(address);
      if (this.shared.signing.has(id)) return null;
      const sends = (await this.all())[address] ?? [];
      if (sends.some((s) => Math.abs(now - s.signedAt) < PENDING_WINDOW_MS)) return null;
      this.shared.signing.add(id);
      return sends;
    });
  }

  record(address: string, send: PendingSend, height: bigint): Promise<void> {
    return this.serial(async () => {
      const all = await this.all();
      const live = (all[address] ?? []).filter((s) => BigInt(s.timeoutHeight) >= height);
      all[address] = [...live, send].slice(-MAX_KEPT);
      await this.session.set(this.key, all);
    });
  }

  release(address: string): Promise<void> {
    return this.serial(() => {
      this.shared.signing.delete(this.signingId(address));
      return Promise.resolve();
    });
  }

  settle(txHash: string): Promise<void> {
    return this.serial(async () => {
      const hash = txHash.toUpperCase();
      const all = Object.entries(await this.all());
      const kept = all
        .map(([address, sends]) => [address, sends.filter((s) => s.txHash !== hash)] as const)
        .filter(([, sends]) => sends.length > 0);
      const before = all.reduce((n, [, sends]) => n + sends.length, 0);
      const after = kept.reduce((n, [, sends]) => n + sends.length, 0);
      if (after !== before) await this.session.set(this.key, Object.fromEntries(kept));
    });
  }

  private signingId(address: string): string {
    return `${this.networkId}:${address}`;
  }

  /** Runs `task` after every earlier one has finished, failed or not. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.shared.queue.then(task);
    this.shared.queue = run.catch(() => undefined);
    return run;
  }

  /** Entries in any other shape are dropped. */
  private async all(): Promise<Record<string, PendingSend[]>> {
    const stored = await this.session.get(this.key);
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
    const all: Record<string, PendingSend[]> = {};
    for (const [address, sends] of Object.entries(stored as Record<string, unknown>)) {
      if (!Array.isArray(sends)) continue;
      const valid = sends.filter(isPendingSend);
      if (valid.length > 0) all[address] = valid;
    }
    return all;
  }
}
