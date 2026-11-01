import {
  ErrorCodes,
  fail,
  type Method,
  type RequestOf,
  type ResponseOf,
  type Result,
} from '../protocol';

/**
 * A handler checks the untrusted payload itself: `validate` turns it into the typed request
 * (or an error, answered as `bad_request`) and `handle` only ever sees validated input.
 */
export interface Handler<M extends Method> {
  validate(payload: unknown): Result<RequestOf<M>>;
  handle(request: RequestOf<M>): Promise<Result<ResponseOf<M>>>;
}

type Route = (payload: unknown) => Promise<Result<unknown>>;

/** Maps method names to handlers. Features register theirs from `handlers/index.ts`. */
export class HandlerRegistry {
  private readonly routes = new Map<string, Route>();

  register<M extends Method>(method: M, handler: Handler<M>): void {
    if (this.routes.has(method)) throw new Error(`handler for ${method} already registered`);
    this.routes.set(method, async (payload) => {
      const request = handler.validate(payload);
      if (!request.ok) return fail(ErrorCodes.badRequest, request.error.message);
      return handler.handle(request.value);
    });
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
    const route = this.routes.get(message.method);
    if (!route) return fail(ErrorCodes.unknownMethod, `Unknown request: ${message.method}`);
    try {
      return await route('payload' in message ? message.payload : undefined);
    } catch {
      // The reason stays in the worker: it may carry secrets.
      return fail(ErrorCodes.internal, 'The wallet could not complete the request.');
    }
  }
}
