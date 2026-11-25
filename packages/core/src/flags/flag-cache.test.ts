import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isFlagCache } from './flag-cache.js';
import { FlagCache } from './flags.js';

/** Every shape a cache file could hold: the zod-free reader must accept exactly what the zod schema accepts. */
const SAMPLES: readonly unknown[] = [
  { fetchedAt: 1, ttl: 3600, flags: {} },
  { fetchedAt: 1, ttl: 3600, flags: { 'cli.x': true, 'cli.y': false } },
  { fetchedAt: 1.5, ttl: 0, flags: { a: true } },
  { fetchedAt: -1, ttl: -5, flags: {} },
  { fetchedAt: 1, ttl: 3600, flags: { a: 'true' } },
  { fetchedAt: 1, ttl: 3600, flags: { a: 1 } },
  { fetchedAt: 1, ttl: 3600, flags: { a: null } },
  { fetchedAt: 1, ttl: 3600, flags: [] },
  { fetchedAt: 1, ttl: 3600, flags: [true] },
  { fetchedAt: 1, ttl: 3600, flags: null },
  { fetchedAt: '1', ttl: 3600, flags: {} },
  { fetchedAt: 1, ttl: '3600', flags: {} },
  { fetchedAt: 1, flags: {} },
  { ttl: 3600, flags: {} },
  { fetchedAt: 1, ttl: 3600 },
  { fetchedAt: 1, ttl: 3600, flags: {}, extra: 1 },
  { fetchedAt: null, ttl: 3600, flags: {} },
  [],
  null,
  'cache',
  42,
  true,
];

describe('T1.4.3 the zod-free flag cache reader (T1.1.1 AC6: --help never loads zod)', () => {
  it('[CLI-T1.4.3-AC1] isFlagCache accepts exactly what the FlagCache schema accepts', () => {
    for (const s of SAMPLES) assert.equal(isFlagCache(s), FlagCache.safeParse(s).success, JSON.stringify(s));
  });
});
