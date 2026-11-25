import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import type { TestsReport } from './commands/agents/test.js';
import { dirs, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

/**
 * $0 REHEARSALS of the paid staging `agents test` legs (step 10 holds the real fire), through the real CLI against a
 * scripted platform on 127.0.0.1 (no paid provider, no other host). The approval is the quote id (e2e/phase3.e2e.ts:63-82).
 *   CLI-T3.1.4-AC4 (REVITION-CLI-PLAN.md:2701) staging, quoted: quote -> approved -> run with that quoteId -> the report.
 *   CLI-T3.4.1-AC2 (:2931) spend <= quote: the run's cost read back from the platform is within the quoted estimate.
 */
const QUOTE = { quoteId: 'tq_r', draftVersion: 2, modelCalls: 3, verificationCalls: 0, freeCases: 0, available: true, billedEstimateUsd: 0.06 };
const REPORT: TestsReport = { draftVersion: 2, results: [{ caseId: 'answers-refund', type: 'draft_run', status: 'completed', passed: true }], regressionCount: 0, allPassed: true };

function platform(): Promise<MockPlatform> {
  return startMockPlatform((method, path) => {
    if (method === 'GET' && path === '/deployments/dep_r/tests/quote') return ok(QUOTE);
    if (method === 'POST' && path === '/deployments/dep_r/tests/run') return ok(REPORT);
    if (method === 'GET' && path === '/deployments/dep_r/runs') {
      return ok({ items: [{ runId: 'run_t', workTitle: 'Tests', status: 'completed', inFlight: false, startedMs: 1_763_500_000_000, traceRef: null, costUsd: 0.0411, costNote: '' }], nextCursor: null });
    }
    return null;
  });
}

async function leg(p: MockPlatform, approved: string): Promise<{ quoteId: string; estimate: number | null; report: TestsReport | null }> {
  const env = await dirs();
  const first = await runCli(['agents', 'test', 'dep_r', '--json'], { cwd: tmpdir(), host: p.host, env });
  assert.equal(first.code, 2, 'without --yes a paid run stops at the quote');
  assert.equal(p.log.filter((l) => l.method === 'POST').length, 0);
  const q = (JSON.parse(first.stdout) as { error: { details?: { quote?: { quoteId: string; billedEstimateUsd: number | null } } } }).error.details?.quote ?? QUOTE;
  if (approved !== q.quoteId) return { quoteId: q.quoteId, estimate: q.billedEstimateUsd, report: null };
  const run = await runCli(['agents', 'test', 'dep_r', '--yes', '--json'], { cwd: tmpdir(), host: p.host, env });
  assert.equal(run.code, 0, run.stderr);
  const d = (JSON.parse(run.stdout) as { data: { quote: { quoteId: string; billedEstimateUsd?: number | null }; report: TestsReport } }).data;
  assert.equal(d.quote.quoteId, approved, 'the fresh quote is the approved one');
  return { quoteId: d.quote.quoteId, estimate: d.quote.billedEstimateUsd ?? null, report: d.report };
}

describe('$0 rehearsal: the paid agents-test leg (step 10)', () => {
  it('[CLI-T3.1.4-AC4] rehearsal: quote -> approved -> run with that quoteId -> the report; only the mock host is contacted', async () => {
    const p = await platform();
    try {
      const r = await leg(p, QUOTE.quoteId);
      assert.deepEqual(r.report, REPORT);
      assert.deepEqual(p.log.filter((l) => l.method === 'POST').map((l) => l.body), [{ quoteId: 'tq_r' }], 'one run, carrying the approved quote');
      assert.ok(p.host.includes('127.0.0.1'), p.host);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.1.4-AC4] rehearsal: a quote other than the approved one is never run', async () => {
    const p = await platform();
    try {
      const r = await leg(p, 'tq_not_approved');
      assert.equal(r.report, null);
      assert.equal(p.log.filter((l) => l.method === 'POST').length, 0);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.4.1-AC2] rehearsal: the run cost read back from the platform is within the quoted estimate', async () => {
    const p = await platform();
    try {
      const r = await leg(p, QUOTE.quoteId);
      const runs = await runCli(['agents', 'runs', 'dep_r', '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(runs.code, 0, runs.stderr);
      const cost = (JSON.parse(runs.stdout) as { data: { runs: Array<{ costUsd: number | null }> } }).data.runs[0]?.costUsd ?? null;
      assert.ok(r.estimate !== null && cost !== null && cost <= r.estimate, `spend ${cost} <= quote ${r.estimate}`);
    } finally {
      p.close();
    }
  });
});
