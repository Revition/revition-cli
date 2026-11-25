import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

// The Linux / macOS paths are POSIX paths whatever host computes them (a Windows host computing them must not use '\\').
const { join } = posix;

/**
 * T1.1.2 - where the CLI keeps its files, per OS:
 * - Linux: $XDG_CONFIG_HOME/revition (default ~/.config/revition); state $XDG_STATE_HOME (~/.local/state); cache
 *   $XDG_CACHE_HOME (~/.cache).
 * - macOS: ~/Library/Application Support/revition (the XDG variables, when set, are honoured); cache
 *   ~/Library/Caches/revition.
 * - Windows: %APPDATA%\revition; state and cache under %LOCALAPPDATA%\revition.
 * PURE (inputs passed in).
 */
export interface PathInputs {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly home: string;
}

export interface CliPaths {
  readonly configDir: string;
  readonly configFile: string;
  readonly stateDir: string;
  readonly cacheDir: string;
  readonly logDir: string;
}

const APP = 'revition';

export function cliPaths({ platform, env, home }: PathInputs): CliPaths {
  const set = (k: string): string | undefined => {
    const v = env[k];
    return v !== undefined && v.trim() !== '' ? v : undefined;
  };
  if (platform === 'win32') {
    const appData = set('APPDATA') ?? win32.join(home, 'AppData', 'Roaming');
    const local = set('LOCALAPPDATA') ?? win32.join(home, 'AppData', 'Local');
    const configDir = win32.join(appData, APP);
    const stateDir = win32.join(local, APP, 'state');
    return {
      configDir,
      configFile: win32.join(configDir, 'config.json'),
      stateDir,
      cacheDir: win32.join(local, APP, 'cache'),
      logDir: win32.join(stateDir, 'logs'),
    };
  }
  const mac = platform === 'darwin';
  const configBase = set('XDG_CONFIG_HOME') ?? (mac ? join(home, 'Library', 'Application Support') : join(home, '.config'));
  const stateBase =
    set('XDG_STATE_HOME') ?? (mac ? join(home, 'Library', 'Application Support', APP) : join(home, '.local', 'state'));
  const cacheBase = set('XDG_CACHE_HOME') ?? (mac ? join(home, 'Library', 'Caches') : join(home, '.cache'));
  const configDir = join(configBase, APP);
  // On macOS without XDG_STATE_HOME the state lives inside the app's own folder (stateBase already ends in /revition).
  const stateDir = set('XDG_STATE_HOME') === undefined && mac ? join(stateBase, 'state') : join(stateBase, APP);
  return {
    configDir,
    configFile: join(configDir, 'config.json'),
    stateDir,
    cacheDir: join(cacheBase, APP),
    logDir: join(stateDir, 'logs'),
  };
}

/** The paths for this process (platform, environment and home directory of the running user). */
export function defaultCliPaths(): CliPaths {
  return cliPaths({ platform: process.platform, env: process.env, home: homedir() });
}

/** The project link file, relative to a project root. */
export const PROJECT_FILE = join('.revition', 'project.json');
