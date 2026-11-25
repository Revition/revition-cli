import type { Dispatcher } from 'undici';

import { undici } from '../lazy-deps.js';
import { TLS_OPTIONS } from './tls-guard.js';

/**
 * T1.1.5 - HTTPS_PROXY / HTTP_PROXY / NO_PROXY are honoured (either case). NO_PROXY: comma-separated hosts, a
 * leading dot or none both match the domain and its subdomains, `*` disables the proxy, an optional :port must match.
 * Proxy credentials are never logged (callers log only `proxyLabel`). PURE (env passed in).
 */
export function proxyFor(target: URL, env: Readonly<Record<string, string | undefined>>): string | null {
  const get = (k: string): string | undefined => env[k] ?? env[k.toLowerCase()];
  const noProxy = (get('NO_PROXY') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s !== '');
  const host = target.hostname.toLowerCase();
  const port = target.port || (target.protocol === 'https:' ? '443' : '80');
  for (const entry of noProxy) {
    if (entry === '*') return null;
    const [h, p] = entry.split(':') as [string, string | undefined];
    if (p !== undefined && p !== port) continue;
    const bare = h.replace(/^\*?\./, '');
    if (host === bare || host.endsWith(`.${bare}`)) return null;
  }
  const proxy = target.protocol === 'https:' ? (get('HTTPS_PROXY') ?? get('HTTP_PROXY')) : get('HTTP_PROXY');
  return proxy !== undefined && proxy !== '' ? proxy : null;
}

/** The proxy URL with any credentials removed, for logs and `doctor`. */
export function proxyLabel(proxy: string): string {
  try {
    const u = new URL(proxy);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return '[invalid proxy URL]';
  }
}

/** The undici dispatcher for a target: through the proxy when one applies; TLS verification always on. */
export function dispatcherFor(target: URL, env: Readonly<Record<string, string | undefined>>): Dispatcher {
  const proxy = proxyFor(target, env);
  if (proxy === null) return new (undici().Agent)({ connect: TLS_OPTIONS });
  return new (undici().ProxyAgent)({ uri: proxy, requestTls: TLS_OPTIONS, proxyTls: TLS_OPTIONS });
}
