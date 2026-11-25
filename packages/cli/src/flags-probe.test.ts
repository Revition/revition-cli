import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cliDirs, cliPathsOf } from './test-fixtures/cli-dirs.js';
import { startMockAuth } from './test-fixtures/mock-auth.js';
import { CLI_BIN, runCli } from './test-fixtures/spawn-cli.js';

const PAT = `rvt_${'C'.repeat(40)}`;
const FLAG = 'cli-flag-probe';

async function dirs(cache: Record<string, boolean> | null): Promise<Record<string, string>> {
  const root = await mkdtemp(join(tmpdir(), 'revprobe-'));
  const d = { ...cliDirs(root) };
  if (cache !== null) {
    const { cacheDir } = cliPathsOf(d);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, 'flags-default.json'), JSON.stringify({ fetchedAt: Date.now(), ttl: 3600, flags: cache }));
  }
  return d;
}

/** Calls to the flags route (the mock logs paths without the query; the cache is fresh, so no background refresh runs:
 * every call counted is the probe's own `?require=` check, which the mock alone answers 403 when the flag is off). */
const probeCalls = (log: ReadonlyArray<{ path: string }>): number => log.filter((r) => r.path === '/api/v1/foundry/dev/cli/flags').length;

describe('T1.4.3 the flag probe test command (auditor ruling G4, 2026-11-24)', () => {
  it('[CLI-T1.4.3-AC1] off for the account: hidden from help and refused before any platform check', async () => {
    const mock = await startMockAuth({ flags: {} });
    try {
      const env = { ...(await dirs({ [FLAG]: false })), REVITION_HOST: mock.apiHost, REVITION_TOKEN: PAT };
      assert.doesNotMatch((await runCli(CLI_BIN, ['--help'], { env })).stdout, /flags probe/);
      const r = await runCli(CLI_BIN, ['flags', 'probe'], { env });
      assert.equal(r.code, 4);
      assert.match(r.stderr, /not available on your account yet/);
      assert.equal(probeCalls(mock.apiLog), 0);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.4.3-AC2] forced on client-side while the server says off: the platform refuses with 403 CLI_FEATURE_DISABLED', async () => {
    const mock = await startMockAuth({ flags: {} });
    try {
      const env = { ...(await dirs({ [FLAG]: true })), REVITION_HOST: mock.apiHost, REVITION_TOKEN: PAT };
      const r = await runCli(CLI_BIN, ['flags', 'probe', '--json'], { env });
      assert.equal(r.code, 4);
      assert.equal((JSON.parse(r.stdout) as { error: { code: string } }).error.code, 'CLI_FEATURE_DISABLED');
      assert.equal(probeCalls(mock.apiLog), 1);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.4.3-AC1] on for the account (server + delivered cache): it runs, with one read and nothing else', async () => {
    const mock = await startMockAuth({ flags: { [FLAG]: true } });
    try {
      const env = { ...(await dirs({ [FLAG]: true })), REVITION_HOST: mock.apiHost, REVITION_TOKEN: PAT };
      const r = await runCli(CLI_BIN, ['flags', 'probe', '--json'], { env });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual((JSON.parse(r.stdout) as { data: unknown }).data, { flag: FLAG, enabled: true });
      assert.equal(probeCalls(mock.apiLog), 1);
      assert.deepEqual(mock.apiLog.filter((x) => x.method !== 'GET').map((x) => x.path), []);
    } finally {
      mock.close();
    }
  });
});
