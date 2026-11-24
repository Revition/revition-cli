/**
 * The FULL-SEQUENCE $0 DRESS REHEARSAL of the staging journeys (T1.6.1, T2.5.1, T3.4.1; the step-8 legs): each journey
 * file runs UNCHANGED (same steps, same order, same assertions) against the scripted platform on 127.0.0.1
 * (journey-platform.ts), with the metered and quoted legs switched ON, because nothing behind the mock can bill.
 * What it proves before the live run: every step of every journey works end to end through the real CLI, every request
 * the journeys make is a contract operation (or a deliberate human-only probe the platform refuses), and no other host
 * is ever contacted. It does NOT replace the staging run (the real platform, 3 OS, the human approvals).
 *
 *   node --import tsx --test e2e/rehearsal/journeys.rehearsal.test.ts
 *   REHEARSAL_OUT=<dir>  also writes each journey's raw junit and the platform's call log there (the evidence).
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { startJourneyPlatform, type JourneyPlatform } from './journey-platform.js';
import { REHEARSAL_TOKEN, runJourney, type JourneyRun } from './run-journey.js';

const OUT = process.env['REHEARSAL_OUT'] ?? '';
const HUMAN_ONLY_PROBES = [/\/submissions\/[^/]+\/publish$/u, /\/draft\/publish$/u];

async function rehearse(name: string, phase: string, env: Record<string, string>, opts: { minCliVersion?: string } = {}): Promise<{ run: JourneyRun; platform: JourneyPlatform }> {
  const platform = await startJourneyPlatform(REHEARSAL_TOKEN, opts);
  try {
    const run = await runJourney(phase, platform.host, env);
    if (OUT !== '') {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${name}-junit.xml`), run.junit);
      writeFileSync(join(OUT, `${name}-calls.json`), `${JSON.stringify(platform.calls, null, 1)}\n`);
    }
    return { run, platform };
  } finally {
    platform.close();
  }
}

function assertClean(r: { run: JourneyRun; platform: JourneyPlatform }, expectCases: number): void {
  const failed = r.run.cases.filter((c) => c.status === 'failed');
  assert.deepEqual(failed.map((c) => `${c.name}: ${c.message}`), [], 'every journey step passed');
  const ran = r.run.cases.filter((c) => c.status === 'passed');
  assert.ok(ran.length >= expectCases, `at least ${expectCases} journey cases ran (got ${ran.length})`);
  assert.equal(r.run.code, 0);
  const violations = r.platform.calls.filter((c) => c.problems.length > 0 && !HUMAN_ONLY_PROBES.some((p) => p.test(c.path)));
  assert.deepEqual(violations, [], 'every request is a contract operation');
  for (const c of r.platform.calls.filter((x) => HUMAN_ONLY_PROBES.some((p) => p.test(x.path)))) assert.equal(c.status, 403, `${c.path} refused`);
  assert.match(r.platform.host, /^127\.0\.0\.1:\d+$/u, 'the only host is local');
}

describe('dress rehearsal: the staging journeys, unchanged, against the scripted platform ($0)', () => {
  it('[CLI-T1.6.1-AC2] phase 1: whoami -> auth status -> doctor -> token list / create refused -> revoke -> exit 3 -> logout -> leak suite', async () => {
    const r = await rehearse('phase1', 'phase1', {});
    assertClean(r, 4);
    assert.ok(r.run.junit.includes('[CLI-T1.6.1-AC1]'), 'the raw journey report is recorded');
  });

  it('[CLI-T1.6.1-AC2] phase 1 forced-upgrade probe: the platform minimum raised, the CLI exits 10 with the platform message', async () => {
    const r = await rehearse('phase1-426', 'phase1', { REVITION_E2E_EXPECT_426: '9.0.0' }, { minCliVersion: '9.0.0' });
    assertClean(r, 1);
  });

  it('[CLI-T2.5.1-AC1] [CLI-T2.5.1-AC3] phase 2: init -> generate -> build -> sandbox -> keys -> secrets -> quoted eval -> submit -> runs / analytics / audit -> human-only 403 -> leak suite', async () => {
    const r = await rehearse('phase2', 'phase2', {
      REVITION_E2E_APP: 'dapp_rehearsal',
      REVITION_E2E_VERSION: '1.0.0',
      REVITION_E2E_PAID_OK: '1',
      REVITION_E2E_EVAL_QUOTE: 'evq_rehearsalrehearsalrehearsalrehe',
    });
    // 10: the `test` step is a real case now (CLI-T2.5.1-AC1), no longer a skip.
    assertClean(r, 10);
    const order = r.platform.calls.map((c) => `${c.method} ${c.path.replace(/^\/api\/v1\/foundry/u, '')}`);
    assert.ok(order.indexOf('GET /dev/apps/dapp_rehearsal/evals/quote') < order.indexOf('POST /dev/apps/dapp_rehearsal/evals'), 'quoted before the eval fires');
    assert.ok(order.includes('DELETE /dev/projects/dproj_rehearsal/sandbox'), 'the sandbox is deleted');
    assert.ok(order.includes('DELETE /dev/apps/dapp_rehearsal/secrets/PHASE2_E2E'), 'the secret is removed');
  });

  it('[CLI-T3.4.1-AC1] [CLI-T3.1.3-AC4] [CLI-T3.1.4-AC2] [CLI-T3.1.4-AC3] phase 3: agents pull -> edit -> push -> test -> status -> open (human publish) -> CLI publish 403; MCP read tools only', async () => {
    const r = await rehearse('phase3', 'phase3', { REVITION_E2E_AGENT: 'dep_rehearsal', REVITION_E2E_PAID_OK: '1' });
    assertClean(r, 2);
    const seq = r.platform.calls.map((c) => `${c.method} ${c.path.replace(/^\/api\/v1\/foundry/u, '')}`);
    // [CLI-T3.1.4-AC2] [CLI-T3.1.4-AC3] ruling #279: the authored paid case is quoted before it runs, then reported.
    assert.ok(seq.indexOf('GET /deployments/dep_rehearsal/tests/quote') < seq.indexOf('POST /deployments/dep_rehearsal/tests/run'), 'quoted before the run');
    assert.ok(seq.includes('GET /deployments/dep_rehearsal/tests/report'), 'status reads the report');
    const puts = r.platform.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/draft'));
    assert.equal(puts.length, 2, 'the edit is pushed, then reverted (the pulled definition pushed back)');
  });
});
