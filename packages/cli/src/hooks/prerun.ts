import { metaProblems } from '@revition/cli-core';
import type { Hook } from '@oclif/core';

/**
 * T1.1.1 - before a command runs: it must be a RevitionCommand with complete `meta` (the manifest test proves this
 * for every bundled command; this guards a plugin's command at runtime). An incomplete contract is refused.
 */
const hook: Hook<'prerun'> = async function (opts) {
  const meta = (opts.Command as unknown as { meta?: unknown }).meta;
  const problems = metaProblems(meta);
  if (problems.length > 0) {
    process.stderr.write(
      `Refused: "${opts.Command.id}" does not declare a complete command contract (${problems.join('; ')}).\n`
    );
    this.exit(4);
  }
};

export default hook;
