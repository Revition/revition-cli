/**
 * T1.1.5 - retries: idempotent methods (and mutations that carry an Idempotency-Key) on 429 / 502 / 503 / 504 and
 * network resets; exponential backoff with full jitter; Retry-After honoured; never a 4xx other than 429; never a
 * mutation without an Idempotency-Key. PURE.
 */
export const RETRYABLE_STATUS: ReadonlySet<number> = new Set([429, 502, 503, 504]);
const IDEMPOTENT: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const NETWORK_RESET = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

export interface RetryInputs {
  readonly method: string;
  readonly status: number | null;
  readonly errorCode: string | null;
  readonly hasIdempotencyKey: boolean;
}

export function shouldRetry({ method, status, errorCode, hasIdempotencyKey }: RetryInputs): boolean {
  const m = method.toUpperCase();
  const safeToRepeat = IDEMPOTENT.has(m) || hasIdempotencyKey;
  if (!safeToRepeat) return false;
  if (status !== null) return RETRYABLE_STATUS.has(status);
  return errorCode !== null && NETWORK_RESET.has(errorCode);
}

export const BASE_DELAY_MS = 250;
export const MAX_DELAY_MS = 8_000;

/** Full jitter: a uniform delay in [0, min(cap, base * 2^attempt)). `random` in [0, 1). */
export function backoffMs(attempt: number, random: () => number): number {
  return Math.floor(random() * Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt));
}

/** Retry-After as delta-seconds or an HTTP date; null when absent or unparseable. Capped at 60 s. */
export function retryAfterMs(header: string | null | undefined, nowMs: number): number | null {
  if (header === null || header === undefined || header.trim() === '') return null;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(60_000, secs * 1000);
  const at = Date.parse(header);
  if (!Number.isFinite(at)) return null;
  return Math.min(60_000, Math.max(0, at - nowMs));
}
