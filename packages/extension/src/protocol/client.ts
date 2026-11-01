import { ErrorCodes, fail, type Envelope, type Result } from './types';
import type { Method, RequestOf, ResponseOf } from '.';

/** Popup-side access to the service worker. UI components receive it by injection. */
export interface Client {
  call<M extends Method>(method: M, request: RequestOf<M>): Promise<Result<ResponseOf<M>>>;
}

/** The slice of `chrome.runtime` the client uses. */
export interface RuntimeLike {
  sendMessage(message: Envelope): Promise<unknown>;
}

export function isResult(raw: unknown): raw is Result<unknown> {
  if (typeof raw !== 'object' || raw === null || !('ok' in raw)) return false;
  if (raw.ok === true) return 'value' in raw;
  if (raw.ok !== false || !('error' in raw)) return false;
  const e = raw.error;
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof e.code === 'string' &&
    'message' in e &&
    typeof e.message === 'string'
  );
}

/** `Client` over `chrome.runtime.sendMessage`. Failures come back as `transport` errors. */
export class RuntimeClient implements Client {
  constructor(private readonly runtime: RuntimeLike) {}

  async call<M extends Method>(method: M, request: RequestOf<M>): Promise<Result<ResponseOf<M>>> {
    let raw: unknown;
    try {
      raw = await this.runtime.sendMessage({ method, payload: request });
    } catch {
      return fail(ErrorCodes.transport, 'The wallet service did not answer.');
    }
    if (!isResult(raw)) return fail(ErrorCodes.transport, 'The wallet service sent a bad reply.');
    const result: unknown = raw;
    return result as Result<ResponseOf<M>>;
  }
}
