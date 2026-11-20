/**
 * T1.3.4 - clock skew: when the local clock is more than 60 s off the server's Date header (T1.1.6 measures it), the
 * server's time is used to decide whether the session is fresh. PURE.
 */
export const SKEW_TOLERANCE_MS = 60_000;
/** Re-auth this long before authFreshUntil. */
export const REAUTH_MARGIN_MS = 60_000;

export function skewMs(localNowMs: number, serverDate: string | null | undefined): number | null {
  if (serverDate === null || serverDate === undefined) return null;
  const server = Date.parse(serverDate);
  return Number.isFinite(server) ? server - localNowMs : null;
}

/** The time to judge freshness by: the server's when the skew exceeds the tolerance, else the local clock. */
export function effectiveNow(localNowMs: number, skew: number | null): number {
  return skew !== null && Math.abs(skew) > SKEW_TOLERANCE_MS ? localNowMs + skew : localNowMs;
}

export function needsReauth(authFreshUntil: number, localNowMs: number, skew: number | null): boolean {
  return effectiveNow(localNowMs, skew) > authFreshUntil - REAUTH_MARGIN_MS;
}
