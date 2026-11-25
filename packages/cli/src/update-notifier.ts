import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  channelOf,
  defaultCliPaths,
  isStale,
  loadUserConfig,
  readUpdateCache,
  updateCheckAllowed,
  updateNotice,
} from '@revition/cli-core';

/**
 * T1.4.1 - the notifier around every command: before it, print a notice from the cache (if any); after it, start the
 * registry check in a DETACHED process when the cache is stale. Neither step can delay or fail the command.
 */
export const WORKER = fileURLToPath(new URL('./update-worker.js', import.meta.url));

async function allowed(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<boolean> {
  const { config } = await loadUserConfig(defaultCliPaths().configFile).catch(() => ({ config: { updateCheck: true } }));
  return updateCheckAllowed({ json: argv.includes('--json'), env, stderrIsTTY: process.stderr.isTTY === true, configUpdateCheck: config.updateCheck });
}

export async function printUpdateNotice(argv: readonly string[], version: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    if (!(await allowed(argv, env))) return;
    const notice = updateNotice(await readUpdateCache(defaultCliPaths().cacheDir), version);
    if (notice !== null) process.stderr.write(notice);
  } catch {
    // never fails a command
  }
}

/** Returns at once: the check runs in its own detached process (measured by its own timing, never the command's). */
export async function scheduleUpdateCheck(argv: readonly string[], version: string, env: NodeJS.ProcessEnv = process.env, force = false): Promise<boolean> {
  try {
    if (!force && !(await allowed(argv, env))) return false;
    const { cacheDir } = defaultCliPaths();
    if (!isStale(await readUpdateCache(cacheDir), channelOf(version), version, Date.now())) return false;
    const child = spawn(process.execPath, [WORKER, version, cacheDir], { detached: true, stdio: 'ignore', env });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
