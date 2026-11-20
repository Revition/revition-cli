// T1.4.1 - the detached background update check: argv = <installed version> <cache dir>. Offline = silently skipped.
import { runUpdateCheck } from '@revition/cli-core';

const [version, cacheDir] = process.argv.slice(2);
if (version !== undefined && cacheDir !== undefined) {
  await runUpdateCheck({ installedVersion: version, cacheDir, env: process.env, now: Date.now() }).catch(() => undefined);
}
