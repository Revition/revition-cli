import { homedir } from 'node:os';
import { join } from 'node:path';

import { cliPaths, type CliPaths } from '@revition/cli-core';

/**
 * The CLI's directories for one test, isolated on EVERY OS. Linux and macOS honour XDG_*; Windows ignores them and uses
 * %APPDATA% and %LOCALAPPDATA% (core config/paths.ts). With XDG_* alone, a windows-latest run read and wrote the
 * runner's real profile, shared by every test running at once (PR #11 run 45564271218: another test's `telemetry`
 * profile in a logout, a flag cache written where the CLI never reads it).
 */
// A type alias (not an interface) so it is assignable to an env record.
export type CliDirs = {
  readonly XDG_CONFIG_HOME: string;
  readonly XDG_STATE_HOME: string;
  readonly XDG_CACHE_HOME: string;
  readonly APPDATA: string;
  readonly LOCALAPPDATA: string;
};

export function cliDirs(root: string): CliDirs {
  return {
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_STATE_HOME: join(root, 'state'),
    XDG_CACHE_HOME: join(root, 'cache'),
    APPDATA: join(root, 'appdata'),
    LOCALAPPDATA: join(root, 'localappdata'),
  };
}

/** Where the CLI keeps its files under `env` on this OS: the same resolution the CLI itself uses. */
export function cliPathsOf(env: Readonly<Record<string, string | undefined>>): CliPaths {
  return cliPaths({ platform: process.platform, env, home: env['HOME'] ?? homedir() });
}
