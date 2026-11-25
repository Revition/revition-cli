import { usageError } from '../errors/cli-error.js';

/**
 * T1.1.2 (mitigates T09) - credentials only ever go to Revition hosts. Any other host needs --allow-custom-host, prints
 * a red warning, and uses its own token slot: tokens are stored per (profile, host), so a token is never sent to a
 * different host.
 */
export const HOST_ALLOWLIST = /^([a-z0-9-]+\.)*revition\.com$/;

export function isAllowlistedHost(host: string): boolean {
  return HOST_ALLOWLIST.test(host);
}

export interface HostDecision {
  readonly host: string;
  readonly custom: boolean;
  readonly warning: string | null;
}

/** Accepts an allowlisted host; a custom one only with the explicit flag (and a warning); refuses otherwise. */
export function checkHost(host: string, allowCustomHost: boolean): HostDecision {
  const h = host.trim().toLowerCase();
  if (isAllowlistedHost(h)) return { host: h, custom: false, warning: null };
  if (!allowCustomHost) {
    throw usageError(
      'CUSTOM_HOST_REFUSED',
      `"${h}" is not a Revition host; the CLI will not send credentials to it.`,
      'Re-run with --allow-custom-host only if you trust this host (it gets its own, separate credentials).'
    );
  }
  return {
    host: h,
    custom: true,
    warning: `Using a custom host "${h}". Credentials for it are kept separately and never sent to Revition hosts.`,
  };
}

/** The credential slot of a (profile, host) pair (T1.3.1 stores tokens under it). PURE. */
export function credentialSlot(profile: string, host: string): string {
  return `${profile}@${host.toLowerCase()}`;
}
