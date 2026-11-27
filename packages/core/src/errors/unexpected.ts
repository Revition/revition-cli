import { randomUUID } from 'node:crypto';

import { PRODUCTION_WEB_LINKS } from '../config/web-links.js';
import { EXIT } from '../output/exit-codes.js';

import { RevitionCliError } from './cli-error.js';

/**
 * The public CLI support page. Not environment-bound (plan amendment 2026-11-27, #537): an unexpected error is
 * rendered before any profile is known, and support is the public documentation for every environment.
 */
export const SUPPORT_URL = `${PRODUCTION_WEB_LINKS.developer}/cli/support`;

/**
 * T1.1.4 - anything that is not a RevitionCliError becomes one generic message with a local trace id; the original
 * error goes to the debug log only (never to the terminal, where it could carry a secret or a stack).
 */
export function toCliError(err: unknown, traceId: string = randomUUID()): RevitionCliError {
  if (err instanceof RevitionCliError) return err;
  return new RevitionCliError(
    {
      code: 'UNEXPECTED',
      message: `Something went wrong (trace ${traceId}). Run with --debug and attach the log; see ${SUPPORT_URL}`,
      traceId,
      docsUrl: SUPPORT_URL,
    },
    EXIT.general
  );
}
