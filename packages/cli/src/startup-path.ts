/**
 * T1.1.1 AC6 (REVITION-CLI-PLAN.md:755: `revition --version` and `--help` start in <= 300 ms). PURE.
 *
 * oclif prints the version or the help and exits WITHOUT running a command when (its own rule, @oclif/core main.js
 * `versionAddition` / `helpAddition`): the first argument is a version flag; a help flag comes before any `--`; or there
 * are no arguments. Such a run needs none of the command setup (services, Ctrl-C handler, the pre-command update
 * notice), so the init hook skips it and never imports the core for it.
 */
export interface OclifInfoFlags {
  readonly additionalVersionFlags?: readonly string[];
  readonly additionalHelpFlags?: readonly string[];
}

export function infoOnlyRun(argv: readonly string[], flags: OclifInfoFlags = {}): boolean {
  if (argv.length === 0) return true;
  const version = new Set(['--version', ...(flags.additionalVersionFlags ?? [])]);
  if (version.has(argv[0] ?? '')) return true;
  const help = new Set(['--help', ...(flags.additionalHelpFlags ?? [])]);
  for (const arg of argv) {
    if (arg === '--') return false;
    if (help.has(arg)) return true;
  }
  return false;
}
