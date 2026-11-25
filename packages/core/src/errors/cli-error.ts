import { EXIT, type ExitCode } from '../output/exit-codes.js';

/** T1.1.4 - the one error shape every command reports (human render and the --json envelope). */
export interface CliError {
  readonly code: string;
  readonly message: string;
  readonly hint: string | null;
  readonly httpStatus: number | null;
  readonly traceId: string | null;
  readonly docsUrl: string | null;
}

/** A failure a command raises on purpose: carries the CliError and the exit code. */
export class RevitionCliError extends Error {
  readonly error: CliError;
  readonly exitCode: ExitCode;

  constructor(error: Partial<CliError> & Pick<CliError, 'code' | 'message'>, exitCode: ExitCode = EXIT.general) {
    super(error.message);
    this.name = 'RevitionCliError';
    this.error = {
      code: error.code,
      message: error.message,
      hint: error.hint ?? null,
      httpStatus: error.httpStatus ?? null,
      traceId: error.traceId ?? null,
      docsUrl: error.docsUrl ?? null,
    };
    this.exitCode = exitCode;
  }
}

/**
 * T1.3.5 AC5 (ruling O105 / O106) - a workspace command for a session known to have no workspace: exit 4 with the
 * link hint, never a raw 403.
 */
export function noWorkspaceError(): RevitionCliError {
  return new RevitionCliError(
    {
      code: 'NO_WORKSPACE',
      message: 'This command needs a workspace, and your account has none linked (a developer account).',
      hint: 'Link one with `revition account link-workspace`; Developer API commands work without it.',
    },
    EXIT.permission
  );
}

/** The preflight: refuse before the request when the session is known to have no workspace. */
export function assertWorkspaceFor(isWorkspaceRoute: boolean, sessionWorkspace: string | null | undefined): void {
  if (isWorkspaceRoute && sessionWorkspace === null) throw noWorkspaceError();
}

/** Usage / validation (exit 2): bad flags, or input that --no-input forbids asking for. */
export function usageError(code: string, message: string, hint: string | null = null): RevitionCliError {
  return new RevitionCliError({ code, message, hint }, EXIT.usage);
}
