import type { Clock, HttpRequest, HttpResponse, HttpTransport } from '../src/index';

/** A recorded request/response pair, as written by `scripts/record-fixtures.mjs`. */
export interface Fixture {
  method: 'GET' | 'POST';
  path: string;
  status: number;
  body: unknown;
}

type Reply = HttpResponse | ((req: HttpRequest) => HttpResponse);

/** Replays canned responses by `METHOD url`; an unknown request fails the test. */
export class MockTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  private readonly replies = new Map<string, Reply[]>();

  constructor(private readonly base: string) {}

  /** Adds a reply for `method path`; several replies for one request are served in order, the last one repeats. */
  on(method: 'GET' | 'POST', path: string, ...replies: Reply[]): this {
    this.replies.set(`${method} ${this.base}${path}`, replies);
    return this;
  }

  /** Serves a recorded fixture at its recorded request. */
  replay(fixture: Fixture): this {
    return this.on(fixture.method, fixture.path, reply(fixture));
  }

  request(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(req);
    const queue = this.replies.get(`${req.method} ${req.url}`);
    const next = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!next) return Promise.reject(new Error(`unexpected request ${req.method} ${req.url}`));
    return Promise.resolve(typeof next === 'function' ? next(req) : next);
  }
}

export function reply(fixture: Pick<Fixture, 'status' | 'body'>): HttpResponse {
  return { status: fixture.status, body: JSON.stringify(fixture.body) };
}

export function json(status: number, body: unknown): HttpResponse {
  return { status, body: JSON.stringify(body) };
}

/** A clock that only moves when something sleeps. */
export class FakeClock implements Clock {
  private time = 1_000_000;
  readonly sleeps: number[] = [];

  now(): number {
    return this.time;
  }

  sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
    return Promise.resolve();
  }
}
