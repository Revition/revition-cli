import { z } from 'zod';

import { atomicWriteFile } from '../config/write.js';
import type { ApiClient } from '../transport/client.js';

import { flagCacheFile, flagCacheFresh, readFlagCache, type FlagCache as FlagCacheShape } from './flag-cache.js';

// The read side lives in flag-cache.ts (no zod, so `--help` stays inside its budget); re-exported unchanged.
export { flagCacheFile, flagCacheFresh, readFlagCache } from './flag-cache.js';

/**
 * T1.4.3 - server-delivered feature flags: GET /dev/cli/flags?version=&channel= -> { flags, ttl }, cached in
 * `<cache>/flags-<profile>.json` for its TTL (default 1 h). Offline -> the last cache; no cache -> defaults (every
 * non-stable feature OFF). Flags are UX gates only: the server refuses a feature that is off for the caller.
 */
export const FlagCache = z.object({ fetchedAt: z.number(), ttl: z.number(), flags: z.record(z.string(), z.boolean()) }).strict();
export type FlagCache = FlagCacheShape;

/** Fresh cache, else a fetch (written to the cache), else the stale cache, else nothing (= all off). */
export async function loadFlags(i: {
  readonly client: ApiClient;
  readonly cacheDir: string;
  readonly profile: string;
  readonly version: string;
  readonly channel: string;
  readonly now: number;
}): Promise<Record<string, boolean>> {
  const cached = readFlagCache(i.cacheDir, i.profile);
  if (flagCacheFresh(cached, i.now)) return cached?.flags ?? {};
  try {
    const r = await i.client.request<{ flags: Record<string, boolean>; ttl: number }>({
      method: 'GET',
      path: '/dev/cli/flags',
      query: { version: i.version, channel: i.channel },
    });
    const next: FlagCache = { fetchedAt: i.now, ttl: Number.isFinite(r.body.ttl) ? r.body.ttl : 3600, flags: r.body.flags ?? {} };
    await atomicWriteFile(flagCacheFile(i.cacheDir, i.profile), JSON.stringify(next));
    return next.flags;
  } catch {
    return cached?.flags ?? {};
  }
}

/** Flags never block login, logout, doctor or upgrade (T1.4.3 invariant). */
export const NEVER_FLAGGED: ReadonlySet<string> = new Set(['login', 'logout', 'doctor', 'upgrade']);
