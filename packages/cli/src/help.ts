import type { CommandMeta } from '@revition/cli-core';
import { experimentalOptIn } from '@revition/cli-core/startup';
import type { Command } from '@oclif/core';
// The help entry, not the package index: the index loads every oclif module plus semver (47 files) on each --help
// (T1.1.1 AC6, 300 ms on the 3 OS).
import { Help } from '@oclif/core/help';

import { enabledFlags } from './enabled-flags.js';

/**
 * T1.1.1 / T1.4.3 - help lists a command only when it may run: experimental commands are hidden without the opt-in
 * (REVITION_EXPERIMENTAL=1 or --experimental); a command behind a server feature flag is hidden until the flag is on
 * (defaults off; the flag cache lands with T1.4.3).
 */
export function visibleInHelp(
  meta: CommandMeta | undefined,
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
  enabledFlags: ReadonlySet<string> = new Set()
): boolean {
  if (meta === undefined) return true;
  if (meta.stability === 'experimental' && !experimentalOptIn(env, argv.includes('--experimental'))) return false;
  if (meta.featureFlag !== undefined && !enabledFlags.has(meta.featureFlag)) return false;
  return true;
}

export default class RevitionHelp extends Help {
  protected override get sortedCommands(): Command.Loadable[] {
    const profileAt = process.argv.indexOf('--profile');
    const profile = profileAt >= 0 ? (process.argv[profileAt + 1] ?? 'default') : (process.env['REVITION_PROFILE'] ?? 'default');
    const flags = enabledFlags(profile);
    return super.sortedCommands.filter((c) =>
      visibleInHelp((c as unknown as { meta?: CommandMeta }).meta, process.env, process.argv, flags)
    );
  }
}
