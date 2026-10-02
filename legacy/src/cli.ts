#!/usr/bin/env node
/** The `revition` binary: the commands in `commands.ts`, on this process's streams and environment. */

import { runCli } from './commands';

void runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
}).then((code) => {
  process.exitCode = code;
});
