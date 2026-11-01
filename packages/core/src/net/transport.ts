import { TransportError } from './errors';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/** The only way the clients reach the network. No retries: callers decide. */
export interface HttpTransport {
  request(req: HttpRequest): Promise<HttpResponse>;
}

export const DEFAULT_TIMEOUT_MS = 15_000;

/** `HttpTransport` over the platform `fetch`, with a timeout and no redirects. */
export class FetchTransport implements HttpTransport {
  constructor(
    private readonly fetchFn: typeof fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async request(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new TransportError(`request to ${req.url} timed out after ${String(this.timeoutMs)} ms`),
      );
    }, this.timeoutMs);
    const onCallerAbort = () => {
      controller.abort(req.signal?.reason);
    };
    if (req.signal?.aborted) {
      onCallerAbort();
    } else {
      req.signal?.addEventListener('abort', onCallerAbort, { once: true });
    }

    try {
      const res = await this.fetchFn(req.url, {
        method: req.method,
        // A redirect could hand the request to a host the wallet never allowed.
        redirect: 'error',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          ...(req.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(req.body === undefined ? {} : { body: req.body }),
      });
      return { status: res.status, body: await res.text() };
    } catch (e) {
      if (controller.signal.aborted && controller.signal.reason instanceof TransportError) {
        throw controller.signal.reason;
      }
      if (req.signal?.aborted) throw e;
      throw new TransportError(`request to ${req.url} failed`, { cause: e });
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}
