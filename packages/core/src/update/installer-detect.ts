import { PACKAGE, type Channel } from './check.js';

/**
 * T1.4.1 - which package manager installed this CLI, from where its package lives, and the exact upgrade command.
 * `upgrade` prints that command and runs it; it never downloads or executes anything else. Unknown -> instructions
 * only. PURE.
 */
export type Installer = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export function detectInstaller(packageRoot: string): Installer {
  const p = packageRoot.replace(/\\/g, '/').toLowerCase();
  if (p.includes('/.bun/')) return 'bun';
  if (p.includes('/pnpm/') || p.includes('/.pnpm/')) return 'pnpm';
  if (p.includes('/yarn/global/') || p.includes('/.config/yarn/')) return 'yarn';
  if (p.includes('/node_modules/@revition/cli')) return 'npm';
  return 'unknown';
}

export function upgradeCommand(installer: Installer, channel: Channel): readonly [string, readonly string[]] | null {
  const spec = `${PACKAGE}@${channel}`;
  if (installer === 'npm') return ['npm', ['install', '--global', spec]];
  if (installer === 'pnpm') return ['pnpm', ['add', '--global', spec]];
  if (installer === 'yarn') return ['yarn', ['global', 'add', spec]];
  if (installer === 'bun') return ['bun', ['add', '--global', spec]];
  return null;
}

/**
 * The package manager's stdio: stdin shared (it may prompt), its stdout AND stderr onto the CLI's stderr. The CLI's
 * stdout carries only the command's own result, so `upgrade --json` prints exactly one envelope (T1.1.3 AC1,
 * REVITION-CLI-PLAN.md:858); the L3 run on the installed CLI (2026-11-18) caught npm's "added 1 package" on stdout.
 */
export type UpgradeStdio = [0, 2, 2];
export const UPGRADE_STDIO: UpgradeStdio = [0, 2, 2];

export type SpawnLike = (cmd: string, args: readonly string[], opts: { stdio: UpgradeStdio; shell: boolean }) => {
  on(event: 'error' | 'close', cb: (arg?: unknown) => void): unknown;
};

/**
 * Runs exactly the package manager with exactly these arguments, nothing else. Windows ships it as a .cmd shim that
 * Node only runs through the shell; every argument is fixed (the channel is an enum), so nothing user-typed reaches it.
 */
export function runUpgrade(cmd: readonly [string, readonly string[]], spawnImpl: SpawnLike, platform: NodeJS.Platform = process.platform): Promise<number> {
  const [bin, args] = cmd;
  const win = platform === 'win32';
  return new Promise((resolve) => {
    const child = spawnImpl(win ? `${bin}.cmd` : bin, [...args], { stdio: UPGRADE_STDIO, shell: win });
    child.on('error', () => resolve(127));
    child.on('close', (c) => resolve(typeof c === 'number' ? c : 1));
  });
}

export const VERIFY_HINT = 'Verify the package provenance with: npm audit signatures';
export const USER_PREFIX_HINT =
  'Permission denied? Install without sudo into a user prefix: npm config set prefix ~/.npm-global, add ~/.npm-global/bin to PATH, then re-run.';
