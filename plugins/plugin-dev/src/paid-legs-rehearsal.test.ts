import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { dirs, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

/**
 * $0 REHEARSALS of the paid staging legs (step 10 holds the real fire): the same commands, through the real CLI, in the
 * same order the staging leg runs them, against a scripted platform on 127.0.0.1. Nothing reaches a paid provider or
 * any other host (every request is in the mock's log, and the mock is the only host). The user's approval is the quote
 * id: the leg fires only for the quote the user approved, and the spend read back must be within the quote.
 *   CLI-T2.3.1-AC5 (REVITION-CLI-PLAN.md:2275) one staging eval run, quoted from the real quote route, approved first.
 *   CLI-T2.5.1-AC2 (:2497) the real spend is <= the quote (the Phase 2 journey's eval step, e2e/phase2.e2e.ts:140).
 */
const SUITE = '{\n  "description": "Journey",\n  "dimensions": ["task_success"],\n  "cases": [{ "id": "c1", "input": {} }]\n}\n';
const QUOTE = { quoteId: 'evq_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', appId: 'dapp_e2e', projectId: 'dproj_e2e', suiteId: 'journey', digest: 'sha256:j', cases: 1, modelCalls: 2, estCredits: 5, balanceCredits: 50 };
const RUN = {
  runId: 'devev_r',
  appId: 'dapp_e2e',
  suiteId: 'journey',
  projectId: 'dproj_e2e',
  projectVersion: 1,
  digest: 'sha256:j',
  report: { capabilityId: 'hello', version: '1.0.0', suiteId: 'journey', baseline: { task_success: 0.5 }, withCapability: { task_success: 1 }, delta: { task_success: 0.5 }, verdict: 'improves' },
  passRate: 1,
  cases: 1,
  at: '2026-11-19T00:00:00.000Z',
  billedCredits: 4.2,
};

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'paid-rehearsal-'));
  const files = { 'evals/journey.json': SUITE, '.revition/project.json': JSON.stringify({ schemaVersion: 1, appId: 'dapp_e2e', projectId: 'dproj_e2e' }) };
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

function platform(): Promise<MockPlatform> {
  return startMockPlatform((method, path) => {
    if (method === 'GET' && path === '/dev/projects/dproj_e2e') return ok({ projectId: 'dproj_e2e', version: 1, files: { 'evals/journey.json': SUITE } });
    if (method === 'GET' && path === '/dev/apps/dapp_e2e/evals/quote') return ok(QUOTE);
    if (method === 'POST' && path === '/dev/apps/dapp_e2e/evals') return { status: 201, body: RUN };
    if (method === 'GET' && path === '/dev/apps/dapp_e2e/evals') return ok({ runs: [RUN] });
    return null;
  });
}

const posts = (p: MockPlatform): number => p.log.filter((l) => l.method === 'POST' && l.path === '/dev/apps/dapp_e2e/evals').length;

/** The staging leg's own gate, as phase2.e2e.ts:140-151 runs it: dry-run quote; fire only for the approved quote id. */
async function leg(p: MockPlatform, approved: string): Promise<{ quoteId: string; estCredits: number | null; billed: number | null }> {
  const cwd = await project();
  const env = await dirs();
  const dry = await runCli(['eval', 'run', '--suite', 'journey', '--dry-run', '--json'], { cwd, host: p.host, env });
  assert.equal(dry.code, 0, dry.stderr);
  const quote = (JSON.parse(dry.stdout) as { data: { quote: { quoteId: string; estCredits: number | null } } }).data.quote;
  if (approved !== quote.quoteId) return { quoteId: quote.quoteId, estCredits: quote.estCredits, billed: null };
  const ran = await runCli(['eval', 'run', '--suite', 'journey', '--yes', '--json'], { cwd, host: p.host, env });
  assert.equal(ran.code, 0, ran.stderr);
  const run = (JSON.parse(ran.stdout) as { data: { run: { billedCredits?: number } } }).data.run;
  return { quoteId: quote.quoteId, estCredits: quote.estCredits, billed: run.billedCredits ?? null };
}

describe('$0 rehearsal: the paid eval leg (step 10)', () => {
  it('[CLI-T2.3.1-AC5] rehearsal: quoted from the quote route, fired once for the approved quote, the run carries it; only the mock host is contacted', async () => {
    const p = await platform();
    try {
      const r = await leg(p, QUOTE.quoteId);
      assert.equal(r.quoteId, QUOTE.quoteId);
      assert.equal(posts(p), 1, 'exactly one run');
      assert.deepEqual(p.log.find((l) => l.method === 'POST')?.body, { projectId: 'dproj_e2e', suiteId: 'journey', quoteId: QUOTE.quoteId });
      const order = p.log.filter((l) => l.path.startsWith('/dev/apps/')).map((l) => `${l.method} ${l.path}`);
      assert.ok(order.indexOf('GET /dev/apps/dapp_e2e/evals/quote') < order.indexOf('POST /dev/apps/dapp_e2e/evals'), 'quoted before the run');
      assert.equal(new URL(p.host.startsWith('http') ? p.host : `http://${p.host}`).hostname, '127.0.0.1', 'the only host is local');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC5] rehearsal: a fresh quote that differs from the approved one never fires (0 run calls)', async () => {
    const p = await platform();
    try {
      const r = await leg(p, 'evq_the_user_approved_another_one');
      assert.equal(r.billed, null);
      assert.equal(posts(p), 0);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.5.1-AC2] rehearsal: the billed credits read back from the server are within the quote', async () => {
    const p = await platform();
    try {
      const r = await leg(p, QUOTE.quoteId);
      assert.equal(r.billed, 4.2, 'the billed amount comes from the server');
      assert.ok(r.estCredits !== null && r.billed !== null && r.billed <= r.estCredits, `spend ${r.billed} <= quote ${r.estCredits}`);
    } finally {
      p.close();
    }
  });
});
