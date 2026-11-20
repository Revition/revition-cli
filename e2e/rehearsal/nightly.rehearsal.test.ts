/**
 * The $0 rehearsal of the nightly read-only smoke (REVITION-CLI-PLAN T1.2.6, AC3 :1334, edge :1337): the SAME script
 * the workflow runs (scripts/nightly-smoke.sh, then scripts/pat-rotation-check.mjs), against the scripted platform on
 * 127.0.0.1 (journey-platform.ts) and against a closed port (staging unreachable). It proves the nightly can pass, is
 * read-only, and reports an unreachable platform as "unavailable", never as a CLI regression. The 7 consecutive nights
 * on staging stay the live part (step 8).
 *
 *   node --import tsx --test e2e/rehearsal/nightly.rehearsal.test.ts
 *   REHEARSAL_OUT=<dir>  also writes the script output and the platform's call log there.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { rotationDue } from '../../scripts/pat-rotation-check.mjs';

import { startJourneyPlatform } from './journey-platform.js';
import { REHEARSAL_TOKEN } from './run-journey.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = process.env['REHEARSAL_OUT'] ?? '';

interface Run {
  readonly code: number | null;
  readonly stdout: string;
  readonly outputs: Record<string, string>;
  readonly dir: string;
}

function run(cmd: string, args: readonly string[], host: string, token: string = REHEARSAL_TOKEN): Promise<Run> {
  const dir = mkdtempSync(join(tmpdir(), 'nightly-'));
  const ghOut = join(dir, 'github-output');
  writeFileSync(ghOut, '');
  const { NODE_TEST_CONTEXT: _parent, ...inherited } = process.env;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: {
        ...inherited,
        REVITION_TOKEN: token,
        REVITION_HOST: host,
        REVITION_NO_UPDATE_CHECK: '1',
        DO_NOT_TRACK: '1',
        CI: 'true',
        NO_COLOR: '1',
        XDG_CONFIG_HOME: join(dir, 'config'),
        XDG_STATE_HOME: join(dir, 'state'),
        XDG_CACHE_HOME: join(dir, 'cache'),
        NIGHTLY_RETRY_SECONDS: '0',
        NIGHTLY_OUT_DIR: dir,
        GITHUB_OUTPUT: ghOut,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', (code) => {
      const outputs = Object.fromEntries(
        readFileSync(ghOut, 'utf8')
          .split('\n')
          .filter((l) => l.includes('='))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
      );
      resolve({ code, stdout, outputs, dir });
    });
  });
}

/** A port nothing listens on: staging unreachable. */
async function closedPort(): Promise<string> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return `127.0.0.1:${port}`;
}

function save(name: string, body: string): void {
  if (OUT === '') return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), body);
}

describe('dress rehearsal: the nightly read-only smoke (T1.2.6), the workflow\'s own script ($0)', () => {
  it('[CLI-T1.2.6-AC3] against the platform: doctor, whoami, apps list, docs sdk all exit 0; read-only; contract-clean', async () => {
    const platform = await startJourneyPlatform(REHEARSAL_TOKEN);
    try {
      const r = await run('bash', ['scripts/nightly-smoke.sh'], platform.host);
      save('nightly-smoke-stdout.txt', r.stdout);
      save('nightly-smoke-calls.json', `${JSON.stringify(platform.calls, null, 1)}\n`);
      assert.equal(r.code, 0, r.stdout);
      for (const cmd of ['doctor', 'whoami', 'apps list', 'docs sdk']) assert.match(r.stdout, new RegExp(`^${cmd} -> exit 0 `, 'mu'));
      assert.deepEqual(r.outputs, { unavailable: '0', failed: '0' });
      const whoami = JSON.parse(readFileSync(join(r.dir, 'out-whoami.json'), 'utf8')) as { ok?: boolean };
      assert.notEqual(whoami.ok, false, 'whoami answered');
      assert.ok(platform.calls.length > 0, 'the platform was called');
      assert.deepEqual(platform.calls.filter((c) => c.method !== 'GET'), [], 'read-only: no write of any kind');
      assert.deepEqual(platform.calls.filter((c) => c.problems.length > 0), [], 'every request is a contract operation');
      assert.ok(!r.stdout.includes(REHEARSAL_TOKEN), 'the token is never printed');
    } finally {
      platform.close();
    }
  });

  it('[CLI-T1.2.6-AC3] edge (:1337): staging unreachable = exit 9, retried 3 times, reported "unavailable", never a CLI failure', async () => {
    const r = await run('bash', ['scripts/nightly-smoke.sh'], await closedPort());
    save('nightly-smoke-unreachable-stdout.txt', r.stdout);
    assert.equal(r.code, 0, 'an unreachable platform is not a CLI regression');
    for (const cmd of ['whoami', 'apps list', 'docs sdk']) assert.match(r.stdout, new RegExp(`^${cmd} -> exit 9 \\(attempts 3\\)`, 'mu'));
    assert.equal(r.outputs['unavailable'], '1');
    assert.equal(r.outputs['failed'], '0');
  });

  it('[CLI-T1.2.6-AC3] a PAT the platform refuses (401) is a FAILURE (exit 1), not "unavailable"', async () => {
    const platform = await startJourneyPlatform(REHEARSAL_TOKEN);
    try {
      const r = await run('bash', ['scripts/nightly-smoke.sh'], platform.host, `xyz_${'W'.repeat(40)}`);
      save('nightly-smoke-wrong-pat-stdout.txt', r.stdout);
      assert.equal(r.code, 1, r.stdout);
      assert.equal(r.outputs['failed'], '1');
      assert.equal(r.outputs['unavailable'], '0');
    } finally {
      platform.close();
    }
  });

  it('[CLI-T1.2.6-AC3] the PAT rotation check reads the CI PAT\'s own expiry (by prefix) and asks 7 days before it', async () => {
    const platform = await startJourneyPlatform(REHEARSAL_TOKEN);
    try {
      const r = await run(process.execPath, ['scripts/pat-rotation-check.mjs'], platform.host);
      save('pat-rotation-check-stdout.txt', r.stdout);
      assert.equal(r.code, 0, r.stdout);
      assert.match(r.outputs['rotate'] ?? '', /^[01]$/u);
      assert.ok(!r.stdout.includes(REHEARSAL_TOKEN));
    } finally {
      platform.close();
    }
    const now = Date.parse('2026-11-19T00:00:00Z');
    const tok = (days: number, revokedAt: string | null = null) => ({ prefix: REHEARSAL_TOKEN.slice(0, 8), expiresAt: new Date(now + days * 86_400_000).toISOString(), revokedAt });
    assert.equal(rotationDue([tok(6)], REHEARSAL_TOKEN, now).rotate, true, '6 days left: rotate');
    assert.equal(rotationDue([tok(8)], REHEARSAL_TOKEN, now).rotate, false, '8 days left: not yet');
    assert.equal(rotationDue([tok(1, '2026-11-18T00:00:00Z')], REHEARSAL_TOKEN, now).rotate, false, 'a revoked token is not the CI PAT');
    assert.equal(rotationDue([{ ...tok(1), prefix: 'rvt_ZZZZ' }], REHEARSAL_TOKEN, now).rotate, false, 'another token is not the CI PAT');
  });

  it('[CLI-T1.2.6-AC3] the workflow runs exactly these scripts, nightly, with the read-only PAT; the CLI entry it names exists', () => {
    const wf = readFileSync(join(ROOT, '.github/workflows/nightly-contract.yml'), 'utf8');
    assert.match(wf, /schedule:\n\s+- cron: '\d+ \d+ \* \* \*'/u);
    assert.match(wf, /run: bash scripts\/nightly-smoke\.sh/u);
    assert.match(wf, /run: node scripts\/pat-rotation-check\.mjs/u);
    assert.match(wf, /REVITION_TOKEN: \$\{\{ secrets\.REVITION_CI_PAT \}\}/u);
    assert.match(wf, /REVITION_HOST: \$\{\{ vars\.REVITION_STAGING_HOST \}\}/u, 'the staging host is a repository variable');
    assert.doesNotMatch(wf, /\.revition\.com/u, 'no environment host is written in the workflow');
    assert.doesNotMatch(wf, /bin\/run\.js/u, 'the CLI entry is packages/cli/bin/run (no .js)');
    const smoke = readFileSync(join(ROOT, 'scripts/nightly-smoke.sh'), 'utf8');
    assert.match(smoke, /bin="\$\{REVITION_CLI_BIN:-packages\/cli\/bin\/run\}"/u);
    assert.ok(readFileSync(join(ROOT, 'packages/cli/bin/run'), 'utf8').includes('execute'));
  });
});
