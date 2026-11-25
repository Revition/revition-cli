import { exitCodeForStatus } from '../output/exit-codes.js';

import { noWorkspaceError, RevitionCliError } from './cli-error.js';

/**
 * T1.1.4 - the platform error shape `{ error: { code, message, details?, timestamp, trace_id } }` (CLAUDE.md "Error
 * response shape") -> a CliError with the trace id kept and the status mapped to its exit code (T1.1.3). Bodies that
 * are not that shape still map by status, with a generic message. PURE.
 */
export function mapPlatformError(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string | undefined>> = {},
  context: { readonly workspaceRoute: boolean; readonly sessionWorkspace: string | null | undefined } | null = null
): RevitionCliError {
  // T1.3.5 AC5: a 403 on a workspace route for a session KNOWN to have no workspace is the link hint, not a raw 403.
  if (status === 403 && context !== null && context.workspaceRoute && context.sessionWorkspace === null) {
    return noWorkspaceError();
  }
  const e = (body as { error?: Record<string, unknown> } | null)?.error;
  const code = typeof e?.['code'] === 'string' ? e['code'] : `HTTP_${status}`;
  const message =
    typeof e?.['message'] === 'string' && e['message'] !== '' ? e['message'] : `The server answered ${status}.`;
  const traceId =
    (typeof e?.['trace_id'] === 'string' ? e['trace_id'] : null) ??
    headers['x-trace-id'] ??
    headers['x-request-id'] ??
    null;
  const hint =
    typeof e?.['hint'] === 'string'
      ? e['hint']
      : status === 401
        ? 'Run `revition login` to sign in again.'
        : status === 426
          ? 'Run `revition upgrade`.'
        : status === 429
          ? `Too many requests${headers['retry-after'] !== undefined ? `; retry after ${headers['retry-after']} s` : ''}.`
          : null;
  const docsUrl = typeof e?.['portalUrl'] === 'string' ? e['portalUrl'] : null;
  return new RevitionCliError(
    { code, message, hint, httpStatus: status, traceId, docsUrl },
    exitCodeForStatus(status)
  );
}
