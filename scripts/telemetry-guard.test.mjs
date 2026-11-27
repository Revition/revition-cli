// T1.4.2 AC1 (REVITION-CLI-PLAN.md:1707): the suite-wide telemetry spy and its verdict.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { SPY, SUITES, telemetryViolations, withSpy } from './test-all.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** One child process with the spy preloaded that fetches `path` on a local server; returns the spy log. */
async function childFetch(path, extraEnv = {}) {
  const server = createServer((_q, res) => res.writeHead(204).end());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const log = join(mkdtempSync(join(tmpdir(), 'spy-test-')), 'spy.jsonl');
  try {
    const script = `await fetch('http://127.0.0.1:${port}${path}', { method: 'POST', body: '{}' });`;
    // Async: the server answers from this process's event loop, which a spawnSync would block.
    const r = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...process.env, ...extraEnv, REVITION_TELEMETRY_SPY_LOG: log, NODE_OPTIONS: withSpy('') },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (d) => (stderr += d.toString()));
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stderr }));
    });
    assert.equal(r.status, 0, r.stderr);
  } finally {
    server.close();
  }
  try {
    return readFileSync(log, 'utf8');
  } catch {
    return '';
  }
}

describe('[CLI-T1.4.2-AC1] zero telemetry calls without an opt-in, across the whole test suite', () => {
  it('[CLI-T1.4.2-AC1] the spy records a telemetry request from any process it is preloaded into, with no opt-in', async () => {
    const log = await childFetch('/api/v1/foundry/dev/cli/telemetry');
    assert.equal(telemetryViolations(log).length, 1);
  });

  it('[CLI-T1.4.2-AC1] a run that declares its opt-in is not a violation; another route is not recorded', async () => {
    assert.deepEqual(telemetryViolations(await childFetch('/api/v1/foundry/dev/cli/telemetry', { REVITION_TEST_TELEMETRY_OPTIN: '1' })), []);
    assert.equal(await childFetch('/api/v1/foundry/dev/me'), '');
  });

  it('[CLI-T1.4.2-AC1] the verdict: only lines without the opt-in count', () => {
    const log = ['{"path":"/x/dev/cli/telemetry","optIn":false,"pid":1}', '{"path":"/x/dev/cli/telemetry","optIn":true,"pid":2}', ''].join('\n');
    assert.deepEqual(telemetryViolations(log).map((e) => e.pid), [1]);
    assert.deepEqual(telemetryViolations(''), []);
  });

  it('[CLI-T1.4.2-AC1] `pnpm test` runs every suite under the spy (the root test script is the runner)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.test, 'node scripts/test-all.mjs');
    assert.match(SUITES, /scripts\/\*\.test\.mjs/u);
    assert.match(SUITES, /legacy-parity\/\*\.test\.mjs/u);
    assert.match(SUITES, /pnpm -r --workspace-concurrency=\d+ --if-present run test/u);
    assert.match(withSpy('--max-old-space-size=4096'), /^--max-old-space-size=4096 --import=file:\/\//u);
    assert.ok(SPY.endsWith(join('packages', 'test-kit', 'src', 'telemetry-spy.mjs')));
  });
});
