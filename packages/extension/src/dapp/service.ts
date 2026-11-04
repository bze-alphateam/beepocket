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
import { REQUEST_TTL_MS, type RequestStore } from './requests';
import { refuse, type DappSender, type Outcome, type PendingRequest } from './types';
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
  sites: Pick<SitesService, 'list' | 'current' | 'change' | 'disconnect'>;
  services: Pick<Services, 'activeNetwork'>;
  /** Requests their page gave up on; shared with the handlers (`sendTx` checks it). */
  cancellations: Cancellations;
  clock: { now(): number };
}

const ID = /^[0-9a-f]{32}$/;
const nothing = (): Promise<void> => Promise.resolve();

/**
 * The dapp channel inside the worker. A well-formed request is acked at once, before any work;
 * its answer is delivered later to the exact document that asked, so it survives the worker
 * stopping while the user decides.
 * Nothing is kept in memory: pending requests live in session storage.
 */
export class DappService {
  constructor(private readonly deps: DappServiceDeps) {}

  /** Settings › Connected sites. */
  get sites(): DappServiceDeps['sites'] {
    return this.deps.sites;
  }

  /** The network switched: every site's view changed, so every open page is told. */
  networkChanged(): Promise<void> {
    return this.deps.changes.notify('all');
  }

  /** `message` is the untrusted `dapp` field of a content-script message; `from` is the browser's word. */
  receive(from: DappSender, message: unknown): Promise<Received> {
    return Promise.resolve(this.check(from, message));
  }

  /** The synchronous checks that decide the ack. */
  private check(from: DappSender, message: unknown): Received {
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

    // The ack goes out now, before anything that can take time (a node call in `decide`, the
    // window): the page's liveness timer only waits a few seconds for it.
    const pending = { id, method, params: valid.value };
    return { ack: { accepted: true }, after: () => this.settle(from, handler, pending) };
  }

  /**
   * The page gave up on a request: it is dropped wherever it is. Still being handled, it is never
   * queued (and `sendTx` does not broadcast it); queued, it leaves the queue, and the window moves
   * on to the next one. Nothing is answered: the page already stopped waiting.
   */
  private async cancel(from: DappSender, id: string): Promise<void> {
    this.deps.cancellations.add(from, id);
    await this.deps.requests.cancel(id, from.tabId, from.documentId);
  }

  /**
   * Everything after the ack. It never throws and never ends without the request either
   * answered or queued: a failure is delivered to the page instead of leaving it waiting.
   */
  private async settle(
    from: DappSender,
    handler: DappHandler,
    pending: { id: string; method: string; params: unknown },
  ): Promise<void> {
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
      const decision = await handler.decide(request);
      // Given up on while it was being decided: nobody waits for a window or an answer.
      if (this.deps.cancellations.has(request)) return;
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
        await this.deliver(
          request,
          refuse(DappErrorCodes.invalidRequest, 'Too many requests waiting'),
        );
        return;
      }
      if (added.evicted) {
        await this.deliver(
          added.evicted,
          refuse(DappErrorCodes.invalidRequest, 'Too many requests waiting'),
        );
      }
      // A cancel that arrived while the request was being added found nothing to take out.
      if (this.deps.cancellations.has(request)) {
        await this.deps.requests.cancel(request.id, request.tabId, request.documentId);
        return;
      }
    } catch {
      await this.deps.deliverer.answer(
        from,
        pending.id,
        refuse(DappErrorCodes.invalidRequest, 'The wallet could not handle the request.'),
      );
      return;
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
        if (await this.deps.requests.claim(request.id))
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
      ...(head ? { headId: head.id } : {}),
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

  async answer(id: string, user: UserAnswer): Promise<Result<Record<string, never>>> {
    await this.expireDue();
    const request = await this.deps.requests.claim(id);
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
      await this.deps.requests.restore(request);
      return result;
    }
    await this.deliver(request, result.value);
    return ok({});
  }

  /** A closed tab leaves nobody to answer. */
  onTabRemoved(tabId: number): Promise<void> {
    return this.deps.requests.removeTab(tabId).then(() => this.deps.documents.removeTab(tabId));
  }

  private finish(request: PendingRequest, outcome: Outcome): Promise<void> {
    return this.deps.requests.claim(request.id).then((claimed) => {
      if (claimed) return this.deliver(claimed, outcome);
    });
  }

  private deliver(request: PendingRequest, outcome: Outcome): Promise<void> {
    return this.deps.deliverer.answer(request, request.id, outcome);
  }
}

function view(
  request: PendingRequest,
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
        origin: request.origin,
        network: request.network,
        addresses: decision.addresses,
      };
    case 'sign':
      return {
        status: 'sign',
        id: request.id,
        origin: request.origin,
        network: request.network,
        ...decision.details,
      };
  }
}
