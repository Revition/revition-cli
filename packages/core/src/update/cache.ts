import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { atomicWriteFile } from '../config/write.js';

/** T1.4.1 - the update check result, cached in `<cache>/update.json`; checked at most once per 24 h per channel. */
export const CHECK_INTERVAL_MS = 24 * 3600 * 1000;

export const UpdateCacheSchema = z
  .object({
    channel: z.string(),
    checkedAt: z.number(),
    latest: z.string().nullable(),
    /** npm's `deprecate` message for the INSTALLED version, if any (T1.5.4). */
    deprecated: z.string().nullable(),
    installedVersion: z.string(),
  })
  .strict();
export type UpdateCache = z.infer<typeof UpdateCacheSchema>;

export const updateCacheFile = (cacheDir: string): string => join(cacheDir, 'update.json');

export async function readUpdateCache(cacheDir: string): Promise<UpdateCache | null> {
  const text = await readFile(updateCacheFile(cacheDir), 'utf8').catch(() => null);
  if (text === null) return null;
  try {
    const r = UpdateCacheSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export async function writeUpdateCache(cacheDir: string, c: UpdateCache): Promise<void> {
  await atomicWriteFile(updateCacheFile(cacheDir), JSON.stringify(c));
}

export function isStale(c: UpdateCache | null, channel: string, installedVersion: string, nowMs: number): boolean {
  return c === null || c.channel !== channel || c.installedVersion !== installedVersion || nowMs - c.checkedAt >= CHECK_INTERVAL_MS;
}
