import {
  ErrorCodes,
  fail,
  type Method,
  type RequestOf,
  type ResponseOf,
  type Result,
} from '../protocol';

export type Handler<M extends Method> = (request: RequestOf<M>) => Promise<Result<ResponseOf<M>>>;

type AnyHandler = (request: never) => Promise<Result<unknown>>;

/** Maps method names to handlers. Features register theirs from `handlers/index.ts`. */
export class HandlerRegistry {
  private readonly handlers = new Map<string, AnyHandler>();

  register<M extends Method>(method: M, handler: Handler<M>): void {
    if (this.handlers.has(method)) throw new Error(`handler for ${method} already registered`);
    this.handlers.set(method, handler);
  }

  /** Never rejects: unknown methods, bad envelopes and handler crashes become error results. */
  async dispatch(message: unknown): Promise<Result<unknown>> {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('method' in message) ||
      typeof message.method !== 'string'
    ) {
      return fail(ErrorCodes.badRequest, 'Malformed request.');
    }
    const handler = this.handlers.get(message.method);
    if (!handler) return fail(ErrorCodes.unknownMethod, `Unknown request: ${message.method}`);
    const payload = 'payload' in message ? message.payload : undefined;
    try {
      return await handler(payload as never);
    } catch {
      // The reason stays in the worker: it may carry secrets.
      return fail(ErrorCodes.internal, 'The wallet could not complete the request.');
    }
  }
}
