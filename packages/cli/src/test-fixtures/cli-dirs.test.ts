import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { describe, it } from 'node:test';

import { cliPaths } from '@revition/cli-core';

import { cliDirs } from './cli-dirs.js';

// Each simulated OS builds its paths with that OS's own path module, so the result is the same on any host.
describe('cliDirs isolates the CLI on every OS (the test suites rely on it)', () => {
  it('Windows: every CLI directory resolves inside the test root (APPDATA / LOCALAPPDATA, not the runner profile)', () => {
    const root = 'D:\\a\\tmp\\revlife-x';
    const paths = cliPaths({ platform: 'win32', env: cliDirs(root, win32.join), home: 'C:\\Users\\runneradmin' });
    for (const [name, dir] of Object.entries(paths)) assert.ok(dir.startsWith(`${root}\\`), `${name}: ${dir}`);
  });

  it('Linux and macOS: every CLI directory resolves inside the test root (XDG_*)', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      const paths = cliPaths({ platform, env: cliDirs('/tmp/revlife-x', posix.join), home: '/home/runner' });
      for (const [name, dir] of Object.entries(paths)) assert.ok(dir.startsWith('/tmp/revlife-x/'), `${platform} ${name}: ${dir}`);
    }
  });
});
