import type { Hook } from '@oclif/core';

import { suggestCommand } from '../suggest.js';

/** T1.1.6 AC2 - an unknown command prints a suggestion and exits 2; nothing runs. */
const hook: Hook<'command_not_found'> = async function (opts) {
  const ids = opts.config.commands.filter((c) => c.hidden !== true).map((c) => c.id);
  const suggestion = suggestCommand(opts.id, ids);
  const typed = opts.id.replace(/:/g, ' ');
  process.stderr.write(
    suggestion === null
      ? `"${typed}" is not a revition command. Run \`revition --help\` to see the commands.\n`
      : `"${typed}" is not a revition command. Did you mean '${suggestion}'?\n`
  );
  this.exit(2);
};

export default hook;
