/** T1.1.3 - the exit codes (stable, documented in docs/output.md). Changing one is a MAJOR change (versioning.md). */
export const EXIT = {
  ok: 0,
  general: 1,
  /** bad flags, missing input in --no-input */
  usage: 2,
  /** auth required / expired */
  auth: 3,
  /** 403 / scope */
  permission: 4,
  notFound: 5,
  /** 409 / 412 */
  conflict: 6,
  /** 429 */
  rateLimited: 7,
  /** 5xx */
  server: 8,
  /** network / TLS */
  network: 9,
  /** 426 */
  upgrade: 10,
  cancelled: 11,
  /** 402 */
  payment: 12,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** The exit code for an HTTP status (T1.1.4 maps platform errors through this). PURE. */
export function exitCodeForStatus(status: number): ExitCode {
  if (status === 401) return EXIT.auth;
  if (status === 402) return EXIT.payment;
  if (status === 403) return EXIT.permission;
  if (status === 404) return EXIT.notFound;
  if (status === 409 || status === 412) return EXIT.conflict;
  if (status === 426) return EXIT.upgrade;
  if (status === 429) return EXIT.rateLimited;
  if (status === 400 || status === 422) return EXIT.usage;
  if (status >= 500 && status <= 599) return EXIT.server;
  return EXIT.general;
}
