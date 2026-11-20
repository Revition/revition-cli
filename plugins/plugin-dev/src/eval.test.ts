import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { landedRun, reportText, type EvalRun } from './eval/report.js';
import { dirs, err, ok, runCli, startMockPlatform, type Answer, type MockPlatform } from './test-fixtures/mock-platform.js';

// Review finding 3 (docs/security/review-phase2.md) is closed by the platform honouring Idempotency-Key (below).

const SUITE = '{\n  "description": "Smoke",\n  "dimensions": ["task_success"],\n  "cases": [{ "id": "c1", "input": {} }]\n}\n';
const QUOTE = {
  quoteId: 'evq_0123456789abcdef0123456789abcdef',
  appId: 'dapp_mine',
  projectId: 'dproj_1',
  suiteId: 'smoke',
  digest: 'sha256:abc',
  cases: 3,
  modelCalls: 6,
  estCredits: null,
  balanceCredits: 120,
};
const RUN: EvalRun = {
  runId: 'devev_1',
  appId: 'dapp_mine',
  suiteId: 'smoke',
  projectId: 'dproj_1',
  projectVersion: 3,
  digest: 'sha256:abc',
  report: {
    capabilityId: 'hello',
    version: '1.0.0',
    suiteId: 'smoke',
    baseline: { task_success: 0.5 },
    withCapability: { task_success: 0.75 },
    delta: { task_success: 0.25 },
    verdict: 'improves',
  },
  passRate: 0.6667,
  cases: 3,
  at: '2026-11-18T02:00:00.000Z',
  billedCredits: 4.2,
};

async function linked(files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'eval-'));
  const all = { ...files, '.revition/project.json': JSON.stringify({ schemaVersion: 1, appId: 'dapp_mine', projectId: 'dproj_1' }) };
  for (const [f, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

function platform(opts: { cloudFiles?: Record<string, string>; run?: Answer; runs?: EvalRun[] } = {}): Promise<MockPlatform> {
  return startMockPlatform((method, path, body, query) => {
    if (method === 'GET' && path === '/dev/projects/dproj_1') return ok({ projectId: 'dproj_1', version: 3, files: opts.cloudFiles ?? { 'evals/smoke.json': SUITE } });
    if (method === 'PUT' && path === '/dev/projects/dproj_1/files') return ok({ projectId: 'dproj_1', version: (body as { baseVersion: number }).baseVersion + 1 });
    if (method === 'GET' && path === '/dev/apps/dapp_mine/evals/quote') return ok({ ...QUOTE, suiteId: query.get('suiteId') });
    if (method === 'POST' && path === '/dev/apps/dapp_mine/evals') return opts.run ?? { status: 201, body: RUN };
    if (method === 'GET' && path === '/dev/apps/dapp_mine/evals' && query.get('jobId') === 'devevalj_1') return ok({ job: { jobId: 'devevalj_1', status: 'done', runId: 'devev_1', at: 'x' } });
    if (method === 'GET' && path === '/dev/apps/dapp_mine/evals') return ok({ runs: opts.runs ?? [RUN] });
    return null;
  });
}

const calls = (p: MockPlatform, method: string, path: string): number => p.log.filter((l) => l.method === method && l.path === path).length;

describe('T2.3.1 eval run: quote -> confirm -> run', () => {
  it('[CLI-T2.3.1-AC1] no run call without confirmation: non-interactive without --yes is refused after the quote, before any run', async () => {
    const p = await platform();
    try {
      const r = await runCli(['eval', 'run', '--json'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 2, r.stderr);
      assert.equal((JSON.parse(r.stdout) as { error: { code: string } }).error.code, 'CONFIRMATION_REQUIRED');
      assert.equal(calls(p, 'GET', '/dev/apps/dapp_mine/evals/quote'), 1);
      assert.equal(calls(p, 'POST', '/dev/apps/dapp_mine/evals'), 0);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC1] confirmed (--yes): the quote comes first and the run call carries its quoteId', async () => {
    const p = await platform();
    try {
      const r = await runCli(['eval', 'run', '--yes'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      const order = p.log.filter((l) => l.path.startsWith('/dev/apps/dapp_mine/evals')).map((l) => `${l.method} ${l.path}`);
      assert.deepEqual(order.slice(0, 2), ['GET /dev/apps/dapp_mine/evals/quote', 'POST /dev/apps/dapp_mine/evals']);
      const post = p.log.find((l) => l.method === 'POST');
      assert.deepEqual(post?.body, { projectId: 'dproj_1', suiteId: 'smoke', quoteId: QUOTE.quoteId });
      assert.match(r.stderr, /6 model calls/);
      assert.match(r.stderr, /balance: 120 credits/);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC6] --dry-run prints the quote and never calls the run route', async () => {
    const p = await platform();
    try {
      const r = await runCli(['eval', 'run', '--dry-run'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, new RegExp(QUOTE.quoteId));
      assert.match(r.stdout, /3 cases, 6 model calls/);
      assert.match(r.stdout, /billed to your developer wallet after the run/);
      assert.match(r.stdout, /Dry run: nothing ran or was billed/);
      const j = await runCli(['eval', 'run', '--dry-run', '--json'], { cwd: await linked(), host: p.host, env: await dirs() });
      const data = (JSON.parse(j.stdout) as { data: { quote: { quoteId: string }; run: null; dryRun: boolean } }).data;
      assert.equal(data.quote.quoteId, QUOTE.quoteId);
      assert.equal(data.run, null);
      assert.equal(calls(p, 'POST', '/dev/apps/dapp_mine/evals'), 0);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC2] insufficient credits (402 AGENT_ENTITLEMENT_REQUIRED): exit 12 with the wallet hint', async () => {
    const p = await platform({ run: err(402, 'AGENT_ENTITLEMENT_REQUIRED', 'Your organization needs to buy this first.') });
    try {
      const r = await runCli(['eval', 'run', '--yes', '--json'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 12, r.stderr);
      const e = (JSON.parse(r.stdout) as { error: { code: string; hint: string } }).error;
      assert.equal(e.code, 'AGENT_ENTITLEMENT_REQUIRED');
      assert.match(e.hint, /developer wallet/);
    } finally {
      p.close();
    }
  });

  it("[CLI-T2.3.1-AC3] the report is the portal's (EvalRunView): verdict, suite, cases, pass rate and the server's billedCredits", async () => {
    // apps/web/src/features/devportal/eval/eval-console.tsx:95-98 renders exactly this headline for RUN.
    const portal = 'Improves the agent · smoke · 3 cases · pass rate 67% with the capability · Billed: 4.2 credits';
    assert.equal(reportText(RUN).split('\n')[0], portal);
    const p = await platform();
    try {
      const r = await runCli(['eval', 'run', '--yes'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout.split('\n')[0], portal);
      assert.match(r.stdout, /task_success without the capability: 0\.500 \| with it: 0\.750 \| delta \+0\.250/);
      assert.match(r.stdout, /run devev_1 · https:\/\/developer\.revition\.com\/apps/);
      const j = await runCli(['eval', 'run', '--yes', '--json'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal((JSON.parse(j.stdout) as { data: { run: EvalRun } }).data.run.billedCredits, 4.2);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC3] a 202 background run is followed to its job end, then the same report', async () => {
    const p = await platform({ run: { status: 202, body: { jobId: 'devevalj_1', status: 'running' } } });
    try {
      const r = await runCli(['eval', 'run', '--yes'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, /job devevalj_1/);
      assert.match(r.stdout, /^Improves the agent · smoke/);
      assert.equal(calls(p, 'POST', '/dev/apps/dapp_mine/evals'), 1);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC7] a 504 after the run landed shows the landed record (this suite + digest)', async () => {
    const other = { ...RUN, runId: 'devev_0', digest: 'sha256:old' };
    const p = await platform({ run: err(504, 'HTTP_504', 'Endpoint request timed out'), runs: [RUN, other] });
    try {
      const r = await runCli(['eval', 'run', '--yes'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /run devev_1/);
      assert.match(r.stderr, /nothing was run again/);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC7] review finding 3: a 504 retry re-sends the SAME Idempotency-Key, so the platform (which honours it) runs once', async () => {
    // The platform side is dev-eval.test.ts [CLI-T2.3.1-AC7]: a repeat of a key answers with the first outcome, Arena
    // ran once, Mint billed once. Here: the first attempt times out at the gateway, the retry gets the replayed run.
    let attempts = 0;
    const p = await startMockPlatform((method, path, _body, query) => {
      if (method === 'POST' && path === '/dev/apps/dapp_mine/evals') {
        attempts += 1;
        return attempts === 1 ? err(504, 'HTTP_504', 'Endpoint request timed out') : { status: 201, body: RUN };
      }
      if (method === 'GET' && path === '/dev/projects/dproj_1') return ok({ projectId: 'dproj_1', version: 3, files: { 'evals/smoke.json': SUITE } });
      if (method === 'GET' && path === '/dev/apps/dapp_mine/evals/quote') return ok({ ...QUOTE, suiteId: query.get('suiteId') });
      if (method === 'GET' && path === '/dev/apps/dapp_mine/evals') return ok({ runs: [RUN] });
      return null;
    });
    try {
      const r = await runCli(['eval', 'run', '--yes', '--json'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      const posts = p.log.filter((l) => l.method === 'POST' && l.path === '/dev/apps/dapp_mine/evals');
      assert.ok(posts.length >= 2, 'the gateway timeout was retried');
      const keys = new Set(posts.map((l) => l.idempotencyKey));
      assert.equal(keys.size, 1, 'one key across every attempt');
      assert.match([...keys][0] ?? '', /^[A-Za-z0-9-]{8,}$/);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.1-AC7] no landed run after a timeout: EVAL_OUTCOME_UNKNOWN, told not to re-run', async () => {
    const p = await platform({ run: err(504, 'HTTP_504', 'Endpoint request timed out'), runs: [] });
    try {
      const r = await runCli(['eval', 'run', '--yes', '--json'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 9, r.stderr);
      const e = (JSON.parse(r.stdout) as { error: { code: string; hint: string } }).error;
      assert.equal(e.code, 'EVAL_OUTCOME_UNKNOWN');
      assert.match(e.hint, /Do not re-run/);
    } finally {
      p.close();
    }
  });
});

describe('T2.3.1 eval run: the suite', () => {
  it('step 0: a local suite that differs is shown as a diff and saved (confirmed) before the quote', async () => {
    const local = SUITE.replace('Smoke', 'Smoke v2');
    const p = await platform();
    try {
      const refused = await runCli(['eval', 'run'], { cwd: await linked({ 'evals/smoke.json': local }), host: p.host, env: await dirs() });
      assert.equal(refused.code, 2, refused.stderr);
      assert.match(refused.stderr, /- {3}"description": "Smoke",\n\+ {3}"description": "Smoke v2",/);
      assert.equal(calls(p, 'PUT', '/dev/projects/dproj_1/files'), 0);
      assert.equal(calls(p, 'GET', '/dev/apps/dapp_mine/evals/quote'), 0);
      const r = await runCli(['eval', 'run', '--yes'], { cwd: await linked({ 'evals/smoke.json': local }), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      const put = p.log.find((l) => l.method === 'PUT');
      assert.deepEqual(put?.body, { files: { 'evals/smoke.json': local }, baseVersion: 3 });
      const order = p.log.map((l) => `${l.method} ${l.path}`);
      assert.ok(order.lastIndexOf('PUT /dev/projects/dproj_1/files') < order.lastIndexOf('GET /dev/apps/dapp_mine/evals/quote'));
    } finally {
      p.close();
    }
  });

  it('edge: a project without suites gets the `generate eval-suite` hint; several need --suite', async () => {
    const none = await platform({ cloudFiles: {} });
    try {
      const r = await runCli(['eval', 'run', '--json'], { cwd: await linked(), host: none.host, env: await dirs() });
      assert.equal(r.code, 2);
      assert.match((JSON.parse(r.stdout) as { error: { hint: string } }).error.hint, /revition generate eval-suite/);
    } finally {
      none.close();
    }
    const two = await platform({ cloudFiles: { 'evals/smoke.json': SUITE, 'evals/full.json': SUITE } });
    try {
      const r = await runCli(['eval', 'run', '--json'], { cwd: await linked(), host: two.host, env: await dirs() });
      assert.equal((JSON.parse(r.stdout) as { error: { code: string } }).error.code, 'SUITE_REQUIRED');
    } finally {
      two.close();
    }
  });
});

describe('T2.3.1 eval list', () => {
  it("lists the app's runs with the portal's verdict words and the billed credits", async () => {
    const p = await platform();
    try {
      const r = await runCli(['eval', 'list'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /devev_1/);
      assert.match(r.stdout, /Improves the agent/);
      assert.match(r.stdout, /4\.2 credits/);
    } finally {
      p.close();
    }
  });

  it('landedRun picks the newest run of the same suite and snapshot only', () => {
    const older = { ...RUN, runId: 'devev_0' };
    assert.equal(landedRun([RUN, older], 'smoke', 'sha256:abc')?.runId, 'devev_1');
    assert.equal(landedRun([RUN], 'smoke', 'sha256:other'), null);
    assert.equal(landedRun([RUN], 'full', 'sha256:abc'), null);
  });
});
