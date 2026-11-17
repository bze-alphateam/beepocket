import type { ReviewedFee, SignDetails, WalletAddress } from '../protocol';
import type { Result } from '../protocol';
import type { Outcome, PendingRequest } from './types';

/** What a handler decides about a request, now or whenever the wallet state may have changed. */
export type Decision =
  /** Done: tell the page. */
  | { kind: 'answer'; outcome: Outcome }
  /** The wallet is fully locked: wait for the unlock screen. */
  | { kind: 'locked' }
  /** The weak lock must be lifted first. */
  | { kind: 'unlock' }
  /** The user picks the one address the site may see. */
  | { kind: 'connect'; addresses: WalletAddress[] }
  /** The user reviews a transaction to sign. */
  | { kind: 'sign'; details: SignDetails };

/** The user's answer from the request window. */
export interface UserAnswer {
  /** The ticket of the request instance the window showed. */
  ticket: string;
  approve: boolean;
  /** The site the window showed, for a connect. */
  origin?: string;
  index?: number;
  /** The fee the user reviewed, for a request that signs. */
  fee?: ReviewedFee;
  /** The tick a dangerous request needs. */
  trusted?: boolean;
}

/**
 * One handler per dapp method (one file each). `validate` checks the page's untrusted params,
 * `decide` runs on arrival and again when the window asks (so a handler is a pure function of
 * the stored request and the wallet), `confirm` completes a request once the user approved.
 */
export interface DappHandler<P = unknown> {
  /**
   * For a method whose `decide` reads the node: the decision when it needs no node (a refusal, a
   * lock), else null. Only a request that gets past it counts toward its site's share while
   * `decide` runs.
   */
  beforeNode?(request: PendingRequest & { params: P }): Promise<Decision | null>;
  validate(params: unknown): Result<P>;
  /** `signal` aborts when the page gives up on the request while it is being decided. */
  decide(request: PendingRequest & { params: P }, signal?: AbortSignal): Promise<Decision>;
  confirm(request: PendingRequest & { params: P }, answer: UserAnswer): Promise<Result<Outcome>>;
}

/**
 * The methods a web page may call. Separate from the popup's `HandlerRegistry` on purpose:
 * neither can reach the other's methods.
 */
export class DappRegistry {
  private readonly handlers = new Map<string, DappHandler>();

  register<P>(method: string, handler: DappHandler<P>): void {
    if (this.handlers.has(method)) throw new Error(`dapp handler for ${method} already registered`);
    this.handlers.set(method, handler);
  }

  get(method: string): DappHandler | undefined {
    return this.handlers.get(method);
  }
}
