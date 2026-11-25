import { defaultCliPaths, readFlagCache } from '@revition/cli-core/startup';

/**
 * T1.4.3 - the server feature flags that are ON for a profile, from the local flag cache (no network). Loaded from the
 * core's light `startup` entry so `revition --help` (which lists only the commands that may run) never loads the whole
 * core: T1.1.1 AC6, `--help` starts in <= 300 ms.
 */
export function enabledFlags(profile: string): ReadonlySet<string> {
  const c = readFlagCache(defaultCliPaths().cacheDir, profile);
  return new Set(Object.entries(c?.flags ?? {}).filter(([, on]) => on).map(([n]) => n));
}
