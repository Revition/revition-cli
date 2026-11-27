import { z } from 'zod';

import { proxyFor, proxyLabel } from '../transport/proxy.js';
import { isCanaryBuild, isNewer } from '../update/check.js';

/**
 * T1.1.6 - `revition doctor`: one line per check with ok / warn / fail and a fix hint. It never prints a secret or a
 * token fragment (every probe returns a state, never the credential), and "not logged in" is a warning, not a failure.
 */
export const CheckStatus = z.enum(['ok', 'warn', 'fail']);
export const DoctorCheck = z
  .object({ id: z.string(), status: CheckStatus, message: z.string(), hint: z.string().nullable() })
  .strict();
export const DoctorReport = z
  .object({
    checks: z.array(DoctorCheck),
    summary: z.object({ ok: z.number().int(), warn: z.number().int(), fail: z.number().int() }).strict(),
  })
  .strict();
export type DoctorCheck = z.infer<typeof DoctorCheck>;
export type DoctorReport = z.infer<typeof DoctorReport>;

export const MIN_NODE_MAJOR = 22;
export const CLOCK_SKEW_WARN_MS = 60_000;

export interface DoctorDeps {
  readonly cliVersion: string;
  readonly channel: string;
  readonly latestVersion: () => Promise<string | null>;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly arch: string;
  readonly host: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly configReadable: () => Promise<{ readonly ok: boolean; readonly detail: string }>;
  /** The credential store backend, probed WITHOUT reading any secret (T1.3.1). */
  readonly credentialBackend: () => Promise<'keychain' | 'encrypted-file' | 'none'>;
  /** GET /dev/me with the stored credential: only the outcome comes back, never the token. */
  readonly tokenState: () => Promise<'valid' | 'invalid' | 'not_logged_in' | 'unreachable'>;
  /** Reachability + TLS chain + the server's Date header. */
  readonly probeHost: () => Promise<{ readonly reachable: boolean; readonly tls: 'ok' | 'failed' | 'unknown'; readonly serverDate: string | null; readonly error: string | null }>;
  readonly telemetry: () => Promise<string>;
  /** Age of the feature-flag cache in ms, or null when there is none (T1.4.3). */
  readonly flagCacheAgeMs: () => Promise<number | null>;
  readonly now: () => number;
}

const check = (id: string, status: DoctorCheck['status'], message: string, hint: string | null = null): DoctorCheck => ({
  id,
  status,
  message,
  hint,
});

/**
 * Is `latest` (the channel's dist-tag, read live) newer than this build? Two canary builds are ordered by publish order,
 * which the live canary dist-tag carries: a different canary there is the newer one (never a hash comparison).
 */
function newer(latest: string, installed: string): boolean {
  if (latest === installed) return false;
  if (isCanaryBuild(latest) && isCanaryBuild(installed)) return true;
  return isNewer(latest, installed);
}

export async function runDoctor(d: DoctorDeps): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const latest = await d.latestVersion().catch(() => null);
  checks.push(
    latest === null
      ? check('cli-version', 'warn', `revition ${d.cliVersion} (${d.channel}); the latest version could not be checked.`)
      : newer(latest, d.cliVersion)
        ? check('cli-version', 'warn', `revition ${d.cliVersion}; ${latest} is available on ${d.channel}.`, 'Run `revition upgrade`.')
        : check('cli-version', 'ok', `revition ${d.cliVersion} is the latest on ${d.channel}.`)
  );
  const major = Number.parseInt(d.nodeVersion.replace(/^v/, ''), 10);
  checks.push(
    major >= MIN_NODE_MAJOR
      ? check('node', 'ok', `Node.js ${d.nodeVersion} is supported.`)
      : check('node', 'fail', `Node.js ${d.nodeVersion} is not supported.`, `Install Node.js ${MIN_NODE_MAJOR} LTS or newer.`)
  );
  checks.push(check('os', 'ok', `${d.platform} ${d.arch}`));
  const cfg = await d.configReadable();
  checks.push(cfg.ok ? check('config', 'ok', cfg.detail) : check('config', 'fail', cfg.detail, 'Run `revition config path` and fix or remove the file.'));
  const backend = await d.credentialBackend().catch(() => 'none' as const);
  // T4.1.1 AC1: in the standalone binary the keychain binding is the embedded addon (unpacked once, sha256-checked).
  const standalone = (d.env['REVITION_STANDALONE'] ?? '') !== '';
  checks.push(
    backend === 'keychain'
      ? check('credential-store', 'ok', standalone ? "The OS keychain is available (binding loaded from the standalone binary's embedded addon)." : 'The OS keychain is available.')
      : backend === 'encrypted-file'
        ? check('credential-store', 'warn', 'No OS keychain: credentials use the encrypted file store.', 'Install a keyring (e.g. gnome-keyring) for OS-protected storage.')
        : check('credential-store', 'fail', 'No credential store is available.', 'Install a keyring, or use REVITION_TOKEN in CI.')
  );
  const token = await d.tokenState().catch(() => 'unreachable' as const);
  checks.push(
    token === 'valid'
      ? check('credential', 'ok', 'Signed in; the credential is valid.')
      : token === 'not_logged_in'
        ? check('credential', 'warn', 'Not logged in.', 'Run `revition login`.')
        : token === 'invalid'
          ? check('credential', 'fail', 'The stored credential was refused.', 'Run `revition login` again.')
          : check('credential', 'warn', 'The credential could not be checked (host unreachable).')
  );
  const probe = await d.probeHost().catch((e: unknown) => ({ reachable: false, tls: 'unknown' as const, serverDate: null, error: String(e) }));
  checks.push(
    probe.reachable
      ? check('host', 'ok', `${d.host} is reachable.`)
      : check('host', 'fail', `${d.host} is unreachable (${probe.error ?? 'no answer'}).`, 'Check the network, proxy and host.')
  );
  checks.push(
    probe.tls === 'ok'
      ? check('tls', 'ok', 'The TLS certificate chain verifies.')
      : probe.tls === 'failed'
        ? check('tls', 'fail', 'The TLS certificate chain does not verify.', 'For a corporate CA, set NODE_EXTRA_CA_CERTS.')
        : check('tls', 'warn', 'The TLS chain was not checked (host unreachable).')
  );
  const proxy = proxyFor(new URL(`https://${d.host}/`), d.env);
  checks.push(check('proxy', 'ok', proxy === null ? 'No proxy.' : `Proxy ${proxyLabel(proxy)}.`));
  const serverMs = probe.serverDate === null ? Number.NaN : Date.parse(probe.serverDate);
  if (Number.isFinite(serverMs)) {
    const skew = Math.abs(d.now() - serverMs);
    checks.push(
      skew > CLOCK_SKEW_WARN_MS
        ? check('clock', 'warn', `The local clock is off by ${Math.round(skew / 1000)} s from the server.`, 'Sync the system clock (sign-in tokens are time-bound).')
        : check('clock', 'ok', 'The local clock matches the server.')
    );
  } else {
    checks.push(check('clock', 'warn', 'The clock could not be compared (no server time).'));
  }
  checks.push(check('telemetry', 'ok', `Telemetry: ${await d.telemetry()}.`));
  const age = await d.flagCacheAgeMs().catch(() => null);
  checks.push(check('feature-flags', 'ok', age === null ? 'No feature-flag cache yet.' : `Feature-flag cache age ${Math.round(age / 60_000)} min.`));
  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    fail: checks.filter((c) => c.status === 'fail').length,
  };
  return DoctorReport.parse({ checks, summary });
}
