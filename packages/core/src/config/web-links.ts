import { usageError } from '../errors/cli-error.js';

/**
 * REVITION-CLI-PLAN.md:1391 "manage at <portal url>" (plan amendment 2026-11-27, auditor ruling #537): every web link the
 * CLI prints or opens comes from ONE place, the profile's optional `webOrigin`. Absent = the production web hosts
 * (unchanged). Set = that environment's single web app, which serves the Developer Portal under /developer and the
 * platform pages at its root (staging: https://staging.revition.com). The same idea as the per-profile `audience`
 * (T1.2.1, amended 2026-11-23): an environment's base URLs live with its profile.
 */
export interface WebLinks {
  /** The Developer Portal base, no trailing slash: links are `${developer}/apps`, `${developer}/cli-sessions`, ... */
  readonly developer: string;
  /** The platform web app base, no trailing slash: links are `${app}/foundry/...`. */
  readonly app: string;
  /** The hosts a link may be opened on (the `open` commands' allowlist). */
  readonly hosts: readonly string[];
}

/** Only a Revition https origin: scheme + host, no path, no port. */
export const WEB_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*revition\.com$/;

export const PRODUCTION_WEB_LINKS: WebLinks = Object.freeze({
  developer: 'https://developer.revition.com',
  app: 'https://app.revition.com',
  hosts: Object.freeze(['developer.revition.com', 'app.revition.com']),
});

/** The web links of a profile. PURE. A non-Revition origin is refused (exit 2), never used. */
export function webLinksFor(webOrigin: string | null | undefined): WebLinks {
  if (webOrigin === undefined || webOrigin === null || webOrigin === '') return PRODUCTION_WEB_LINKS;
  if (!WEB_ORIGIN.test(webOrigin)) {
    throw usageError('WEB_ORIGIN_INVALID', `"${webOrigin}" is not a Revition web origin.`, 'Use https://<name>.revition.com.');
  }
  return { developer: `${webOrigin}/developer`, app: webOrigin, hosts: [new URL(webOrigin).host] };
}

/** True when `url` is an https link on one of the links' hosts. PURE. */
export function isWebLink(url: string, links: WebLinks): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && links.hosts.includes(u.host);
}
