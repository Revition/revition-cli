// TEST-ONLY preload (startup-path.test.ts): records each time the process asks the OS which shell it runs in, the
// way oclif's getShell does when SHELL is unset (os.userInfo, and on Windows a PowerShell child via execSync), into
// $REVITION_RECORD_SHELL at exit. Both are read through their module objects at call time, so the patch is seen.
import childProcess from 'node:child_process';
import { writeFileSync } from 'node:fs';
import module from 'node:module';
import os from 'node:os';

const out = process.env['REVITION_RECORD_SHELL'];
const probes = [];
const userInfo = os.userInfo;
os.userInfo = (...args) => {
  probes.push('os.userInfo');
  return userInfo(...args);
};
const execSync = childProcess.execSync;
childProcess.execSync = (...args) => {
  probes.push(`execSync ${String(args[0]).slice(0, 40)}`);
  return execSync(...args);
};
module.syncBuiltinESMExports();
process.on('exit', () => {
  if (out !== undefined) writeFileSync(out, probes.join('\n'));
});
