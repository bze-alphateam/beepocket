import type { NetworkId } from '@beepocket/core';
import {
  ErrorCodes,
  fail,
  ok,
  DappProtocolCodes,
  type CurrentRequest,
  type QueueView,
  type RequestView,
  type Result,
} from '../protocol';
import type { Services } from '../background/services';
import type { Deliverer } from './deliver';
import type { AccountChanges } from './account-changes';
import type { SitesService } from './sites';
import type { Cancellations } from './cancellations';
import type { DocumentLog } from './documents';
import type { Decision, DappHandler, DappRegistry, UserAnswer } from './registry';
import { MAX_PER_ORIGIN, MAX_PREPARING, REQUEST_TTL_MS, type RequestStore } from './requests';
import {
  refuse,
  type DappSender,
  type Outcome,
  type PendingRequest,
  type QueuedRequest,
} from './types';
import type { RequestWindow } from './window';
import { DappErrorCodes, NOT_RESPONDING_MESSAGE, STALE_AFTER_MS, type WireError } from './wire';

/** The immediate reply to the content script: taken, or refused right away. */
export type Ack = { accepted: true } | { error: WireError };

export interface Received {
  ack: Ack;
  /** Runs once the ack is out: answers the page, or queues the request and shows the window. */
  after: () => Promise<void>;
}

export interface DappServiceDeps {
  registry: DappRegistry;
  requests: RequestStore;
  window: RequestWindow;
  deliverer: Deliverer;
  documents: Pick<DocumentLog, 'record' | 'removeTab'>;
  changes: Pick<AccountChanges, 'notify'>;
  sites: Pick<SitesService, 'list' | 'current' | 'change' | 'disconnect' | 'connectedOrigins'>;
  services: Pick<Services, 'activeNetwork'>;
  /** Requests being handled and whether their page gave up on them; `sendTx` checks it too. */
  cancellations: Cancellations;
  clock: { now(): number };
}

/** A well-formed request, before anything is done for it. */
interface Incoming {
  id: string;
  method: string;
  params: unknown;
}

/** The checks passed: the request is taken once it is recorded. */
interface Checked {
  handler: DappHandler;
  pending: Incoming;
}

const ID = /^[0-9a-f]{32}$/;
const nothing = (): Promise<void> => Promise.resolve();
const TOO_MANY = 'Too many requests waiting';

/** One request of one document: what a cancel names. */
const handlingKey = (from: DappSender, id: string) =>
  `${String(from.tabId)}\n${from.documentId}\n${id}`;

/**
 * The dapp channel inside the worker. A well-formed request is acked at once, before any work;
 * its answer is delivered later to the exact document that asked, so it survives the worker
 * stopping while the user decides.
 * Pending requests live in session storage; only the requests this worker is deciding right now
 * are kept in memory, since they stop with it.
 */
export class DappService {
  /**
   * The requests being decided right now, to stop their node requests when their page gives up.
   * Kept in memory: they run in this worker, and stop with it.
   */
  private readonly handling = new Map<string, AbortController>();
  /** Requests whose decision reads the node, being decided right now: per site, and in all. */
  private readonly preparing = new Map<string, number>();
  private preparingTotal = 0;

  constructor(private readonly deps: DappServiceDeps) {}

  /** Settings › Connected sites. */
  get sites(): DappServiceDeps['sites'] {
    return this.deps.sites;
  }

  /**
   * The network switched from `from` to `to`: what a site connected on either of them sees has
   * changed, so its open pages are told. No other page is. While the connected sites cannot be
   * read (the wallet is locked), no page is told; a connected page learns the change on its
   * next call.
   */
  async networkChanged(from: NetworkId, to: NetworkId): Promise<void> {
    const origins = await this.deps.sites.connectedOrigins([from, to]);
    if (origins === null || origins.size === 0) return;
    await this.deps.changes.notify({ origins });
  }

  /** `message` is the untrusted `dapp` field of a content-script message; `from` is the browser's word. */
  async receive(from: DappSender, message: unknown): Promise<Received> {
    const checked = this.check(from, message);
    if (!('pending' in checked)) return checked;
    const { handler, pending } = checked;
    // Recorded before the ack, so the page's cancel, which can only follow it, finds the request.
    const taken = await this.deps.cancellations.sent(from, pending.id);
    if (taken !== 'ok') {
      const text = taken === 'duplicate' ? 'Duplicate request.' : TOO_MANY;
      return {
        ack: { error: { code: DappErrorCodes.invalidRequest, message: text } },
        after: nothing,
      };
    }
    return { ack: { accepted: true }, after: () => this.settle(from, handler, pending) };
  }

  /** The synchronous checks that decide the ack. */
  private check(from: DappSender, message: unknown): Received | Checked {
    const bad = (text: string): Received => ({
      ack: { error: { code: DappErrorCodes.invalidRequest, message: text } },
      after: nothing,
    });
    if (typeof message !== 'object' || message === null) return bad('Malformed request.');
    const { id, method, params, sentAt, cancel } = message as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id)) return bad('Malformed request.');
    if (cancel === true) {
      return { ack: { accepted: true }, after: () => this.cancel(from, id) };
    }
    if (typeof method !== 'string') return bad('Malformed request.');
    if (sentAt !== undefined && (typeof sentAt !== 'number' || !Number.isFinite(sentAt))) {
      return bad('Malformed request.');
    }
    // Too late: the page gives up before this ack could reach it, so nothing is done for it.
    if (sentAt !== undefined && this.deps.clock.now() - sentAt >= STALE_AFTER_MS) {
      return {
        ack: { error: { code: DappErrorCodes.unavailable, message: NOT_RESPONDING_MESSAGE } },
        after: nothing,
      };
    }
    const handler = this.deps.registry.get(method);
    if (!handler) return bad('Unknown method.');
    const valid = handler.validate(params);
    if (!valid.ok) return bad(valid.error.message);

    // The ack goes out right after, before anything that can take time (a node call in
    // `decide`, the window): the page's liveness timer only waits a few seconds for it.
    return { handler, pending: { id, method, params: valid.value } };
  }

  /**
   * The page gave up on a request: it is dropped wherever it is. Still being handled, it is never
   * queued (and `sendTx` does not broadcast it); queued, it leaves the queue, and the window moves
   * on to the next one. Nothing is answered: the page already stopped waiting.
   */
  private async cancel(from: DappSender, id: string): Promise<void> {
    this.handling.get(handlingKey(from, id))?.abort();
    await this.deps.cancellations.cancel(from, id);
    await this.deps.requests.cancel(id, from.tabId, from.documentId);
  }

  /**
   * Everything after the ack. It never throws and never ends without the request either
   * answered or queued: a failure is delivered to the page instead of leaving it waiting.
   */
  private async settle(from: DappSender, handler: DappHandler, pending: Incoming): Promise<void> {
    // Before anything is awaited: a cancel, which can only follow the ack, always finds it.
    const key = handlingKey(from, pending.id);
    const controller = new AbortController();
    this.handling.set(key, controller);
    try {
      await this.handle(from, handler, pending, controller.signal);
    } finally {
      if (this.handling.get(key) === controller) this.handling.delete(key);
      await this.deps.cancellations.settled(from, pending.id).catch(() => undefined);
    }
  }

  /**
   * Takes a place for a request whose decision reads the node, or says there is none: a site's
   * requests being decided and those waiting in the queue share its `MAX_PER_ORIGIN`, and at most
   * `MAX_PREPARING` are decided at once in all. The check and the taking are one step.
   */
  private async takePlace(origin: string): Promise<(() => void) | null> {
    const queued = (await this.deps.requests.list()).filter((r) => r.origin === origin).length;
    const mine = this.preparing.get(origin) ?? 0;
    if (mine + queued >= MAX_PER_ORIGIN || this.preparingTotal >= MAX_PREPARING) return null;
    this.preparing.set(origin, mine + 1);
    this.preparingTotal++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.preparingTotal--;
      const left = (this.preparing.get(origin) ?? 1) - 1;
      if (left > 0) this.preparing.set(origin, left);
      else this.preparing.delete(origin);
    };
  }

  private async handle(
    from: DappSender,
    handler: DappHandler,
    pending: Incoming,
    signal: AbortSignal,
  ): Promise<void> {
    // Held until the request is answered or queued, so it always counts in one place or the other.
    let release: (() => void) | null = null;
    try {
      // Requests that waited their 10 minutes make room before the caps are checked.
      await this.expireDue();
      const network = await this.deps.services.activeNetwork();
      const request: PendingRequest = {
        ...pending,
        origin: from.origin,
        network: network.id,
        tabId: from.tabId,
        documentId: from.documentId,
        createdAt: this.deps.clock.now(),
      };
      await this.deps.documents.record({
        tabId: from.tabId,
        documentId: from.documentId,
        origin: from.origin,
        network: network.id,
      });
      // A request that can be settled without the node never takes a place: only those that
      // will read it count toward the caps.
      let decision = (await handler.beforeNode?.(request)) ?? null;
      if (handler.beforeNode && !decision) {
        release = await this.takePlace(from.origin);
        if (!release) {
          await this.deliver(request, refuse(DappErrorCodes.invalidRequest, TOO_MANY));
          return;
        }
      }
      decision ??= await handler.decide(request, signal);
      // Given up on while it was being decided: nobody waits for a window or an answer.
      if (signal.aborted || (await this.deps.cancellations.has(request))) return;
      if (decision.kind === 'answer') {
        await this.deliver(request, decision.outcome);
        return;
      }
      const added = await this.deps.requests.add(request);
      if (added.status === 'duplicate') {
        await this.deliver(request, refuse(DappErrorCodes.invalidRequest, 'Duplicate request.'));
        return;
      }
      if (added.status !== 'added') {
        await this.deliver(request, refuse(DappErrorCodes.invalidRequest, TOO_MANY));
        return;
      }
      if (added.evicted) {
        await this.deliver(added.evicted, refuse(DappErrorCodes.invalidRequest, TOO_MANY));
      }
      // A cancel that arrived while the request was being added found nothing to take out.
      if (await this.deps.cancellations.has(request)) {
        await this.deps.requests.cancel(request.id, request.tabId, request.documentId);
        return;
      }
    } catch {
      // Stopped because its page gave up: nobody waits for an answer.
      if (signal.aborted) return;
      await this.deps.deliverer.answer(
        from,
        pending.id,
        refuse(DappErrorCodes.invalidRequest, 'The wallet could not handle the request.'),
      );
      return;
    } finally {
      release?.();
    }
    // The request is safe in the queue: a window that fails to open loses nothing (the toolbar
    // icon and the expiry still reach it), so its failure is not the page's error.
    await this.deps.window.show().catch(() => undefined);
  }

  /**
   * The request the window should show: the head of the queue. A head the wallet can already
   * answer (or must refuse, such as a site disconnected meanwhile) is settled and the next one shown.
   */
  async current(): Promise<CurrentRequest> {
    await this.expireDue();
    for (;;) {
      const queue = await this.deps.requests.list();
      const request = queue[0];
      if (!request) return { status: 'none' };
      const handler = this.deps.registry.get(request.method);
      if (!handler) {
        await this.finish(request, refuse(DappErrorCodes.invalidRequest, 'Unknown method.'));
        continue;
      }
      const decision = await handler.decide(request);
      if (decision.kind === 'answer') {
        if (await this.deps.requests.claim(request.id, request.ticket))
          await this.deliver(request, decision.outcome);
        continue;
      }
      return {
        ...view(request, decision),
        count: queue.length,
        expiresAt: request.createdAt + REQUEST_TTL_MS,
      };
    }
  }

  /** Who is waiting, for the unlock screen and the window's poll. Reveals no request details. */
  async queue(): Promise<QueueView> {
    await this.expireDue();
    const queue = await this.deps.requests.list();
    const head = queue[0];
    return {
      head: head?.origin ?? null,
      ...(head ? { headId: head.id, headTicket: head.ticket } : {}),
      count: queue.length,
      origins: [...new Set(queue.map((r) => r.origin))],
    };
  }

  /** Opens (or focuses) the request window when something waits; the unlock screen calls it. */
  async openWindow(): Promise<void> {
    if ((await this.deps.requests.list()).length > 0) await this.deps.window.show();
  }

  /** The expiry alarm fired. */
  onExpiry(): Promise<void> {
    return this.expireDue();
  }

  /** The user closed the request window: nothing they have not seen is approved. */
  async onWindowRemoved(windowId: number): Promise<void> {
    if (!(await this.deps.window.closed(windowId))) return;
    const all = await this.deps.requests.takeAll();
    await Promise.all(
      all.map((r) => this.deliver(r, refuse(DappErrorCodes.rejected, 'The request was rejected.'))),
    );
  }

  private async expireDue(): Promise<void> {
    const gone = await this.deps.requests.takeExpired();
    await Promise.all(
      gone.map((r) => this.deliver(r, refuse(DappErrorCodes.expired, 'The request expired.'))),
    );
  }

  /**
   * The user's answer to the request on screen. It applies only to that exact instance (its id
   * and the ticket the window was shown): anything else is `unknown-request`, and the window
   * asks again for what waits.
   */
  async answer(id: string, user: UserAnswer): Promise<Result<Record<string, never>>> {
    await this.expireDue();
    const request = await this.deps.requests.claim(id, user.ticket);
    if (!request)
      return fail(DappProtocolCodes.unknownRequest, 'This request is no longer waiting.');
    const handler = this.deps.registry.get(request.method);
    if (!handler) {
      await this.deliver(request, refuse(DappErrorCodes.invalidRequest, 'Unknown method.'));
      return ok({});
    }
    let result: Result<Outcome>;
    try {
      result = await handler.confirm(request, user);
    } catch {
      result = fail(ErrorCodes.internal, 'The wallet could not complete the request.');
    }
    if (!result.ok) {
      // The user can try again (wrong state, password needed): the request keeps waiting.
      const displaced = await this.deps.requests.restore(request);
      if (displaced) {
        await this.deliver(displaced, refuse(DappErrorCodes.invalidRequest, 'Duplicate request.'));
      }
      return result;
    }
    await this.deliver(request, result.value);
    return ok({});
  }

  /** A closed tab leaves nobody to answer. */
  onTabRemoved(tabId: number): Promise<void> {
    return this.deps.requests.removeTab(tabId).then(() => this.deps.documents.removeTab(tabId));
  }

  private finish(request: QueuedRequest, outcome: Outcome): Promise<void> {
    return this.deps.requests.claim(request.id, request.ticket).then((claimed) => {
      if (claimed) return this.deliver(claimed, outcome);
    });
  }

  private deliver(request: PendingRequest, outcome: Outcome): Promise<void> {
    return this.deps.deliverer.answer(request, request.id, outcome);
  }
}

function view(
  request: QueuedRequest,
  decision: Exclude<Decision, { kind: 'answer' }>,
): RequestView {
  switch (decision.kind) {
    case 'locked':
      return { status: 'locked', origin: request.origin };
    case 'unlock':
      return { status: 'unlock', origin: request.origin };
    case 'connect':
      return {
        status: 'connect',
        id: request.id,
        ticket: request.ticket,
        origin: request.origin,
        network: request.network,
        addresses: decision.addresses,
      };
    case 'sign':
      return {
        status: 'sign',
        id: request.id,
        ticket: request.ticket,
        origin: request.origin,
        network: request.network,
        ...decision.details,
      };
  }
}
