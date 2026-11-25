import type { Hook } from '@oclif/core';

import { duplicateCommandRefusals } from '../plugin-guard.js';
import { infoOnlyRun, type OclifInfoFlags } from '../startup-path.js';

/** Exit code for a policy refusal (permission denied, T1.1.3). */
const POLICY_EXIT = 4;

/**
 * T1.1.1 - runs before any command: Ctrl-C handling; the plugin policy (a plugin that redefines a core command is
 * refused). Third-party installs are decided by `plugins install` itself (T4.2.1-T4.2.3: listed + allowed + verified;
 * anything else refused with the policy, exit 4).
 *
 * T1.1.1 AC6 (startup <= 300 ms): a `--version` / `--help` run executes no command, so the command setup (and the core
 * it imports) is loaded only for a run that executes one. The plugin policy is checked on every run.
 */
const hook: Hook<'init'> = async function (opts) {
  const argv = opts.id === undefined ? opts.argv : [opts.id, ...opts.argv];
  if (!infoOnlyRun(argv, opts.config.pjson.oclif as OclifInfoFlags)) {
    const [{ setDefaultServices }, { cliServices }, { printUpdateNotice }, { installSigint }] = await Promise.all([
      import('@revition/cli-core'),
      import('../services.js'),
      import('../update-notifier.js'),
      import('../signals.js'),
    ]);
    installSigint();
    setDefaultServices(cliServices(opts.config.version));
    await printUpdateNotice(opts.argv, opts.config.version);
  }
  const owners = opts.config.commands.map((c) => ({ id: c.id, pluginName: c.pluginName ?? '' }));
  const dupes = duplicateCommandRefusals(owners, opts.config.name);
  if (dupes.length > 0) {
    for (const d of dupes) process.stderr.write(`${d}\n`);
    this.exit(POLICY_EXIT);
  }
};

export default hook;
