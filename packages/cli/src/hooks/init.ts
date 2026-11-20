import type { Hook } from '@oclif/core';
import { setDefaultServices } from '@revition/cli-core';

import { duplicateCommandRefusals } from '../plugin-guard.js';
import { cliServices } from '../services.js';
import { printUpdateNotice } from '../update-notifier.js';
import { installSigint } from '../signals.js';

/** Exit code for a policy refusal (permission denied, T1.1.3). */
const POLICY_EXIT = 4;

/**
 * T1.1.1 - runs before any command: Ctrl-C handling; the plugin policy (a plugin that redefines a core command is
 * refused). Third-party installs are decided by `plugins install` itself (T4.2.1-T4.2.3: listed + allowed + verified;
 * anything else refused with the policy, exit 4).
 */
const hook: Hook<'init'> = async function (opts) {
  installSigint();
  setDefaultServices(cliServices(opts.config.version));
  await printUpdateNotice(opts.argv, opts.config.version);
  const owners = opts.config.commands.map((c) => ({ id: c.id, pluginName: c.pluginName ?? '' }));
  const dupes = duplicateCommandRefusals(owners, opts.config.name);
  if (dupes.length > 0) {
    for (const d of dupes) process.stderr.write(`${d}\n`);
    this.exit(POLICY_EXIT);
  }
};

export default hook;
