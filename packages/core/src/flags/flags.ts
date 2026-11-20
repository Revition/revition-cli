import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { atomicWriteFile } from '../config/write.js';
import type { ApiClient } from '../transport/client.js';

/**
 * T1.4.3 - server-delivered feature flags: GET /dev/cli/flags?version=&channel= -> { flags, ttl }, cached in
 * `<cache>/flags-<profile>.json` for its TTL (default 1 h). Offline -> the last cache; no cache -> defaults (every
 * non-stable feature OFF). Flags are UX gates only: the server refuses a feature that is off for the caller.
 */
export const FlagCache = z.object({ fetchedAt: z.number(), ttl: z.number(), flags: z.record(z.string(), z.boolean()) }).strict();
export type FlagCache = z.infer<typeof FlagCache>;

export const flagCacheFile = (cacheDir: string, profile: string): string => join(cacheDir, `flags-${profile.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

/** Synchronous (help rendering needs it): the cached flags, or null. */
export function readFlagCache(cacheDir: string, profile: string): FlagCache | null {
  try {
    const r = FlagCache.safeParse(JSON.parse(readFileSync(flagCacheFile(cacheDir, profile), 'utf8')));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function flagCacheFresh(c: FlagCache | null, nowMs: number): boolean {
  return c !== null && nowMs - c.fetchedAt < c.ttl * 1000;
}

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
