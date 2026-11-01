/** An error crossing the popup/worker boundary. Plain data: nothing is ever thrown across. */
export interface ProtocolError {
  code: string;
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: ProtocolError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

/** What a feature declares: for each method name, its request and response payloads. */
export type FeatureProtocol = Record<string, { req: unknown; res: unknown }>;

/** What travels in `chrome.runtime.sendMessage`. */
export interface Envelope {
  method: string;
  payload: unknown;
}

export const ErrorCodes = {
  unknownMethod: 'unknown_method',
  badRequest: 'bad_request',
  internal: 'internal',
  transport: 'transport',
} as const;
