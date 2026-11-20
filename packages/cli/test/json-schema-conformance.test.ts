import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { assertConformsToSchema } from '../src/test-fixtures/json-conformance.js';
import { startMockAuth } from '../src/test-fixtures/mock-auth.js';
import { CLI_BIN, runCli } from '../src/test-fixtures/spawn-cli.js';

/**
 * T3.2.1 AC1 - the core commands, each run with --json through the real CLI (a CI token against the mock platform
 * where a host is needed); each successful document is validated against the command's PUBLISHED schema.
 * Kept outside `src/**` (the package's parallel test glob): its many CLI spawns would skew the T1.1.1 startup-budget
 * timing in a sibling process. It runs from the repository's sequential scripts phase (scripts/schema-semver.test.mjs).
 */
const PAT = `rvt_${'C'.repeat(40)}`;

const CASES: readonly (readonly string[])[] = [
  ['commands'],
  ['config', 'path'],
  ['config', 'list'],
  ['config', 'set', 'telemetry', 'off'],
  ['config', 'get', 'telemetry'],
  ['config', 'unset', 'telemetry'],
  ['telemetry', 'status'],
  ['telemetry', 'enable'],
  ['telemetry', 'show-last'],
  ['telemetry', 'disable'],
  ['autocomplete', 'zsh'],
  ['whoami'],
  ['auth', 'status'],
  ['token', 'list'],
  ['token', 'create', '--name', 'conformance', '--yes'],
  ['doctor'],
  ['profiles', 'list'],
  ['token', 'revoke', 'tok_1', '--yes'],
  ['upgrade'],
  ['logout'],
];

describe('T3.2.1 AC1 - the core commands: their --json output conforms to the published schema', () => {
  for (const argv of CASES) {
    it(`[CLI-T3.2.1-AC1] ${argv.slice(0, 2).join(' ')} --json`, async () => {
      const mock = await startMockAuth();
      try {
        const home = await mkdtemp(join(tmpdir(), 'core-conf-'));
        const env = {
          HOME: home,
          XDG_CONFIG_HOME: join(home, 'c'),
          XDG_STATE_HOME: join(home, 's'),
          XDG_CACHE_HOME: join(home, 'k'),
          REVITION_HOST: mock.apiHost,
          REVITION_TOKEN: PAT,
          REVITION_NO_UPDATE_CHECK: '1',
          DO_NOT_TRACK: '',
        };
        const r = await runCli(CLI_BIN, [...argv, '--json'], { env });
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assertConformsToSchema(r.stdout);
      } finally {
        mock.close();
      }
    });
  }

  it('[CLI-T3.2.1-AC1] login --with-token --json (the CI token checked against the platform)', async () => {
    const mock = await startMockAuth();
    try {
      const home = await mkdtemp(join(tmpdir(), 'core-conf-l-'));
      const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'c'), XDG_STATE_HOME: join(home, 's'), XDG_CACHE_HOME: join(home, 'k'), REVITION_HOST: mock.apiHost, REVITION_NO_UPDATE_CHECK: '1' };
      const r = await runCli(CLI_BIN, ['login', '--with-token', '--json'], { env, input: `${PAT}\n` });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assertConformsToSchema(r.stdout);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T3.2.1-AC1] profiles use / profiles remove --json (on a profile made for the test)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'core-conf-p-'));
    const env = { HOME: home, XDG_CONFIG_HOME: join(home, 'c'), XDG_STATE_HOME: join(home, 's'), XDG_CACHE_HOME: join(home, 'k'), REVITION_NO_UPDATE_CHECK: '1' };
    assert.equal((await runCli(CLI_BIN, ['config', 'set', 'profiles.work.host', 'api.revition.com'], { env })).code, 0);
    for (const argv of [['profiles', 'use', 'work'], ['profiles', 'remove', 'work', '--yes']]) {
      const r = await runCli(CLI_BIN, [...argv, '--json'], { env });
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assertConformsToSchema(r.stdout);
    }
  });
});
