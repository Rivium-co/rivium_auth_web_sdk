/**
 * Error codes the Rivium Auth service answers with, plus two the SDK adds:
 * `NETWORK_ERROR` (the request never got an answer) and `UNKNOWN` (an answer
 * the SDK could not read).
 */
export type RiviumAuthErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_API_KEY'
  | 'METHOD_DISABLED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_TAKEN'
  | 'EMAIL_NOT_VERIFIED'
  | 'WEAK_PASSWORD'
  | 'INVALID_ID_TOKEN'
  | 'NONCE_REUSED'
  | 'PROVIDER_ALREADY_LINKED'
  | 'TOKEN_INVALID'
  | 'SESSION_EXPIRED'
  | 'SESSION_REVOKED'
  | 'USER_DISABLED'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'LIMIT_REACHED'
  | 'PRODUCT_DISABLED'
  | 'MAU_LIMIT'
  | 'NOT_CONFIGURED'
  | 'INTERNAL'
  | 'NETWORK_ERROR'
  | 'UNKNOWN';

/** Every failure the SDK reports. Show users a message based on `code`; `message` is an English hint. */
export class RiviumAuthError extends Error {
  readonly code: RiviumAuthErrorCode;
  /** HTTP status, or 0 when there was no answer. */
  readonly status: number;
  /** Seconds to wait before trying again (with `RATE_LIMITED`). */
  readonly retryAfterSec?: number;
  /** Per-field problems (with `INVALID_INPUT`), e.g. `{ password: 'too_short' }`. */
  readonly fields?: Record<string, string>;
  /** Anything else the server sent with the error. */
  readonly details: Record<string, unknown>;

  constructor(code: RiviumAuthErrorCode, message: string, status = 0, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RiviumAuthError';
    this.code = code;
    this.status = status;
    this.details = details;
    if (typeof details.retryAfterSec === 'number') this.retryAfterSec = details.retryAfterSec;
    if (details.fields && typeof details.fields === 'object') this.fields = details.fields as Record<string, string>;
  }
}

/** Refresh answers that mean the session is over: the user must sign in again. */
export const SESSION_ENDED_CODES: ReadonlySet<RiviumAuthErrorCode> = new Set([
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'TOKEN_INVALID',
  'USER_DISABLED',
  'UNAUTHENTICATED',
]);

export function isRiviumAuthError(err: unknown): err is RiviumAuthError {
  return err instanceof RiviumAuthError;
}
