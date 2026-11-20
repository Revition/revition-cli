import type { Hook } from '@oclif/core';

import { scheduleUpdateCheck } from '../update-notifier.js';

/** T1.4.1 - after the command finished: start the background update check (detached; never waited for). */
const hook: Hook<'postrun'> = async function (opts) {
  await scheduleUpdateCheck(opts.argv, opts.config.version);
};

export default hook;
