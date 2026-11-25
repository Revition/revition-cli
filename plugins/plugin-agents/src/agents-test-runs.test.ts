import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { agentPageUrl, assertRevitionPage } from './commands/agents/open.js';
import { allPages } from './commands/agents/runs.js';
import { reportLines, type TestsReport } from './commands/agents/test.js';
import { followTraces, FOLLOW_MAX_MS, FOLLOW_MIN_MS, type TraceRef } from './commands/agents/traces.js';
import { dirs, err, ok, runCli, startMockPlatform, type Answer, type MockPlatform } from './test-fixtures/mock-platform.js';

const QUOTE = { quoteId: 'tq_1', draftVersion: 4, modelCalls: 2, verificationCalls: 0, freeCases: 1, available: true, billedEstimateUsd: 0.04 };
const REPORT: TestsReport = {
  draftVersion: 4,
  results: [
    { caseId: 'refund-policy', type: 'draft_run', status: 'completed', passed: true },
    { caseId: 'no-pii', type: 'safety', status: 'completed', passed: false, detail: 'mentioned an email address', regressionOf: 'run_3' },
  ],
  regressionCount: 1,
  allPassed: false,
};
const ENVS = {
  managed: null,
  environments: [
    { env: 'dev', provisioned: true, artifactRef: 'art_1', pending: null },
    { env: 'test', provisioned: false, artifactRef: null, pending: null },
    { env: 'staging', provisioned: true, artifactRef: 'art_0', pending: { from: 'dev', to: 'staging', artifactRef: 'art_1', requestedBy: 'auth0|dev', requestedAt: 'x', gate: {} } },
    { env: 'prod', provisioned: true, artifactRef: null, pending: null },
  ],
};

function platform(opts: { run?: Answer; runsPages?: number } = {}): Promise<MockPlatform> {
  let reportReads = 0;
  return startMockPlatform((method, path, _body, query) => {
    if (method === 'GET' && path === '/deployments/dep_1/tests/quote') return ok(QUOTE);
    if (method === 'POST' && path === '/deployments/dep_1/tests/run') return opts.run ?? ok(REPORT);
    if (method === 'GET' && path === '/deployments/dep_1/tests/report') {
      reportReads += 1;
      return ok(reportReads < 2 ? { report: null, run: { status: 'running', done: 1, total: 3 } } : { report: REPORT, run: { status: 'finished', done: 3, total: 3 }, history: [] });
    }
    if (method === 'GET' && path === '/deployments/dep_1/draft/diff') return ok({ changedSections: ['instructions'], added: [], removed: [], hasUnsavedChanges: true });
    if (method === 'GET' && path === '/deployments/dep_1/environments') return ok(ENVS);
    if (method === 'GET' && path === '/deployments/dep_1/runs') {
      const page = Number(query.get('cursor') ?? '0');
      const last = (opts.runsPages ?? 1) - 1;
      return ok({
        items: [{ runId: `run_${page}`, workTitle: 'Answer tickets', status: 'completed', inFlight: false, startedMs: 1_763_400_000_000 + page, traceRef: null, costUsd: 0.0123, costNote: '' }],
        nextCursor: page < last ? String(page + 1) : null,
      });
    }
    if (method === 'GET' && path === '/deployments/dep_viewer/runs') return err(403, 'AGENT_FORBIDDEN', 'You cannot view this agent.');
    return null;
  });
}

describe('T3.1.4 agents test / status / environments / open', () => {
  it('[CLI-T3.1.4-AC1] the quote first; no paid run without confirmation; the run carries its quoteId; the report as the portal has it', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      const refused = await runCli(['agents', 'test', 'dep_1', '--json'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(refused.code, 2);
      assert.equal(p.log.filter((l) => l.method === 'POST').length, 0);
      const r = await runCli(['agents', 'test', 'dep_1', '--yes'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(r.code, 1, r.stderr);
      assert.match(r.stderr, /quote tq_1: 2 paid draft run\(s\), 1 free case\(s\); about \$0\.04/);
      assert.deepEqual(p.log.find((l) => l.method === 'POST')?.body, { quoteId: 'tq_1' });
      assert.equal(r.stdout, `${reportLines(REPORT).join('\n')}\n`);
      assert.match(r.stdout, /FAIL no-pii \(safety, completed\): mentioned an email address \[regression\]/);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.1.4-AC1] a long suite runs in the background (202): followed until the report is written', { timeout: 30_000 }, async () => {
    const p = await platform({ run: { status: 202, body: { status: 'running', quoteId: 'tq_1', draftVersion: 4, modelCalls: 2 } } });
    try {
      const r = await runCli(['agents', 'test', 'dep_1', '--yes', '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 1, r.stderr);
      assert.deepEqual((JSON.parse(r.stdout) as { data: { report: TestsReport } }).data.report, REPORT);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.1.4-AC2] [CLI-T3.1.4-AC3] status: the draft diff, the latest report, the environments and the pending approval', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      await runCli(['agents', 'status', 'dep_1'], { cwd: tmpdir(), host: p.host, env });
      const s = await runCli(['agents', 'status', 'dep_1'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(s.code, 0, s.stderr);
      assert.match(s.stdout, /draft vs live: instructions/);
      assert.match(s.stdout, /tests: finished \(3 of 3\)/);
      assert.match(s.stdout, /staging: art_0 - approval pending \(dev -> staging, requested by auth0\|dev\)/);
      assert.match(s.stdout, /test: not enabled/);
      const e = await runCli(['agents', 'environments', 'list', 'dep_1', '--json'], { cwd: tmpdir(), host: p.host, env });
      assert.equal((JSON.parse(e.stdout) as { data: { environments: unknown[] } }).data.environments.length, 4);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.1.4-AC3] agents open --action publish lands on the agent page the server names for publishing; nothing is called', async () => {
    const p = await platform();
    try {
      const r = await runCli(['agents', 'open', 'dep_1', '--action', 'publish', '--json'], { cwd: tmpdir(), host: p.host, env: { ...(await dirs()), SSH_CONNECTION: 't' } });
      assert.equal(r.code, 0, r.stderr);
      assert.equal((JSON.parse(r.stdout) as { data: { url: string } }).data.url, 'https://app.revition.com/foundry/agents/dep_1');
      assert.equal(agentPageUrl('dep 1'), 'https://app.revition.com/foundry/agents/dep%201');
      assert.throws(() => assertRevitionPage('https://evil.example/foundry/agents/x'), /not a Revition page/);
      assert.deepEqual(p.log, []);
    } finally {
      p.close();
    }
  });

  it('D9: no CLI module references the publish, promote, approve, decline, provision or enable routes', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((n) => {
        if (['node_modules', 'dist', 'test-fixtures'].includes(n)) return [];
        const p = join(dir, n);
        return statSync(p).isDirectory() ? files(p) : /\.(ts|mjs|js|json)$/.test(n) && !/\.test\.(ts|mjs)$/.test(n) ? [p] : [];
      });
    const all = ['packages/core/src', 'packages/cli/src', 'packages/api-client/src', 'packages/api-client/openapi', 'plugins/plugin-dev/src', 'plugins/plugin-agents/src'].flatMap((d) => files(join(root, d)));
    assert.ok(all.length > 60);
    const human = /draft\/publish|environments\/[^'"`\s]*\/(promote|approve|decline|provision)|environments\/enable/;
    assert.deepEqual(all.filter((f) => human.test(readFileSync(f, 'utf8'))), []);
  });
});

describe('T3.1.5 agents runs / traces', () => {
  it('[CLI-T3.1.5-AC3] [CLI-T3.1.5-AC1] runs follows the server cursor to the end, with the scope and range sent as given', async () => {
    const p = await platform({ runsPages: 3 });
    try {
      const r = await runCli(['agents', 'runs', 'dep_1', '--scope', 'goal', '--scope-id', 'goal_1', '--from', '2026-11-01T00:00:00Z', '--limit', '1', '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual((JSON.parse(r.stdout) as { data: { runs: Array<{ runId: string }> } }).data.runs.map((x) => x.runId), ['run_0', 'run_1', 'run_2']);
      const queries = p.log.filter((l) => l.path === '/deployments/dep_1/runs').map((l) => new URLSearchParams(l.query));
      assert.equal(queries.length, 3);
      assert.deepEqual([queries[0]?.get('scope'), queries[0]?.get('scopeId'), queries[0]?.get('from'), queries[0]?.get('limit')], ['goal', 'goal_1', '2026-11-01T00:00:00Z', '1']);
      assert.deepEqual(queries.map((q) => q.get('cursor')), [null, '1', '2']);
    } finally {
      p.close();
    }
    const pages = [{ items: [1, 2], nextCursor: 'a' }, { items: [3], nextCursor: null }];
    let i = 0;
    assert.deepEqual(await allPages(() => Promise.resolve(pages[i++] ?? { items: [], nextCursor: null })), [1, 2, 3]);
  });

  it('edge: a viewer without access to the agent gets the server 403 (exit 4)', async () => {
    const p = await platform();
    try {
      const r = await runCli(['agents', 'runs', 'dep_viewer'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 4);
    } finally {
      p.close();
    }
  });

  it('[CLI-T3.1.5-AC2] traces --follow: each new trace once across polls, the baseline excluded, backoff 5 s -> 30 s', async () => {
    const t = (id: string, at: string): TraceRef => ({ executionId: id, taskId: null, workTitle: 'w', at, status: 'ok', failed: false });
    const polls: TraceRef[][] = [[t('old', '1')], [t('a', '2'), t('old', '1')], [t('a', '2'), t('old', '1')], [t('c', '4'), t('b', '3'), t('a', '2')], [t('c', '4')], [t('c', '4')], [t('c', '4')]];
    let i = 0;
    const emitted: string[] = [];
    const waits: number[] = [];
    await followTraces(
      {
        list: () => Promise.resolve(polls[Math.min(i++, polls.length - 1)] ?? []),
        emit: (x) => emitted.push(x.executionId),
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
      polls.length - 1
    );
    assert.deepEqual(emitted, ['a', 'b', 'c']);
    assert.deepEqual(waits, [FOLLOW_MIN_MS, FOLLOW_MIN_MS, 10_000, FOLLOW_MIN_MS, 10_000, 20_000]);
    assert.ok(waits.every((w) => w <= FOLLOW_MAX_MS));
  });
});
