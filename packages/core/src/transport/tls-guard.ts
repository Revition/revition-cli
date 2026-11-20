import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

/**
 * T1.1.5 (T08) - certificate verification is never off. If the environment disables it for Node
 * (NODE_TLS_REJECT_UNAUTHORIZED=0), the CLI refuses to send credentials at all (exit 9). A corporate CA is added with
 * NODE_EXTRA_CA_CERTS, which keeps verification on.
 */
export function assertTlsVerificationOn(env: Readonly<Record<string, string | undefined>>): void {
  if (env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0') {
    throw new RevitionCliError(
      {
        code: 'TLS_VERIFICATION_DISABLED',
        message: 'TLS verification is disabled in this environment; refusing to send credentials.',
        hint: 'Unset NODE_TLS_REJECT_UNAUTHORIZED. For a corporate CA, use NODE_EXTRA_CA_CERTS instead.',
      },
      EXIT.network
    );
  }
}

/** The TLS options every connection uses: verification ON, TLS 1.2 or newer (Node's defaults, stated explicitly). */
export const TLS_OPTIONS = { rejectUnauthorized: true, minVersion: 'TLSv1.2' } as const;
