import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * T1.4.3 - the cached server flags, READ side only, with no schema library: `revition --help` reads this cache to
 * decide which commands to list, and T1.1.1 AC6 (REVITION-CLI-PLAN.md:755) gives `--help` 300 ms. Validating through
 * zod loaded ~95 zod modules on every `--help` (macOS CI: 317 ms median, PR #11 run 45569816900). `isFlagCache`
 * accepts exactly what the `FlagCache` zod schema in flags.ts accepts (a strict object; flag-cache.test.ts pins the two
 * against each other), so nothing that reads the cache changes.
 */
export interface FlagCache {
  readonly fetchedAt: number;
  readonly ttl: number;
  readonly flags: Record<string, boolean>;
}

const KEYS = ['fetchedAt', 'flags', 'ttl'];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** True for `{ fetchedAt: number, ttl: number, flags: { [name]: boolean } }` with no other key. */
export function isFlagCache(v: unknown): v is FlagCache {
  if (!isRecord(v)) return false;
  const keys = Object.keys(v).sort();
  if (keys.length !== KEYS.length || keys.some((k, i) => k !== KEYS[i])) return false;
  const { fetchedAt, ttl, flags } = v;
  return (
    Number.isFinite(fetchedAt) &&
    Number.isFinite(ttl) &&
    isRecord(flags) &&
    Object.values(flags).every((f) => typeof f === 'boolean')
  );
}

export const flagCacheFile = (cacheDir: string, profile: string): string => join(cacheDir, `flags-${profile.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

/** Synchronous (help rendering needs it): the cached flags, or null. */
export function readFlagCache(cacheDir: string, profile: string): FlagCache | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(flagCacheFile(cacheDir, profile), 'utf8'));
    return isFlagCache(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function flagCacheFresh(c: FlagCache | null, nowMs: number): boolean {
  return c !== null && nowMs - c.fetchedAt < c.ttl * 1000;
}
