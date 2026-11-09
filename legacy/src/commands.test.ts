/**
 * T2.11.5 AC2 — the CLI runs scaffold / build / test / eval / deploy against the SDK and the one pipeline.
 * AC3 — no command bypasses the branch, the review or the pipeline (behaviour, and the grep at the end).
 *
 * The Developer Portal routes are the platform's REAL handler (loaded from apps/api); the org routes are a stand-in
 * that records what the CLI sent.
 */

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli, type CliIo } from './commands';

const API = join(__dirname, '../../../apps/api/src/services/foundry');
const dev = require(join(API, 'devportal/handlers/dev-routes')) as {
  handleDevRoute: (
    req: {
      method: string;
      resource: string;
      pathParameters: Record<string, string> | null;
      body: string | null;
    },
    caller: { identityRef: string; email: null },
    deps: unknown
  ) => Promise<{ status: number; body: unknown }>;
};

// T2.11.14: every build surface is billed through Mint's credits (no free building), the check included, so the
// fake API's developer has an in-memory partition and a funded wallet (the platform's own test fixtures).
const { InMemoryFoundryKv } = require(join(API, 'store/adapters/in-memory-foundry-kv')) as {
  InMemoryFoundryKv: new () => unknown;
};
const { funded } = require(join(API, 'devportal/build-metering/__fixtures__/credits')) as {
  funded: (developerId: string) => unknown;
};

interface Sent {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly auth: string | null;
}

/** F5 (R396): one read of the branch list after a background pipeline was accepted. */
interface BranchRead {
  readonly status: string;
  readonly pipeline: readonly { stage: string; status: string; detail: string }[];
  readonly artifactRef?: string | null;
}

function fakeApi(
  opts: { artifactRef?: string | null; background?: readonly BranchRead[] } = {}
): {
  fetch: typeof fetch;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  let reads = 0;
  const devDeps = {
    identity: { kv: new InMemoryFoundryKv(), nowMs: (): number => Date.parse('2026-09-30T00:00:00.000Z') },
    credits: funded('github|dev-1'),
  };
  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  // The Developer Portal routes: the platform's own handler.
  const devRoute = async (method: string, path: string, body: string | null): Promise<Response> => {
    const starter = /^\/dev\/starters\/([^/]+)$/.exec(path);
    const r = await dev.handleDevRoute(
      {
        method,
        resource: starter !== null ? '/dev/starters/{starterId}' : path,
        pathParameters: starter !== null ? { starterId: decodeURIComponent(starter[1]!) } : null,
        body,
      },
      { identityRef: 'github|dev-1', email: null },
      devDeps
    );
    return json(r.status, r.body);
  };
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const raw = typeof init?.body === 'string' ? init.body : null;
    const path = url.pathname.replace(/^\/api\/v1\/foundry/, '');
    const auth = new Headers(init?.headers).get('authorization');
    sent.push({ method, path, body: raw === null ? null : (JSON.parse(raw) as unknown), auth });
    if (path.startsWith('/dev/')) {
      return devRoute(method, path, raw);
    }
    return orgRoute(method, path);
  };
  const orgRoute = (method: string, path: string): Response => {
    if (method === 'POST' && path === '/deployments/agt_1/code-branches') {
      return json(201, {
        branch: 'cli/hello-tool-1',
        branchId: 'cb_0001',
        files: ['capabilities/hello-tool/main.ts', 'capabilities/hello-tool/tests.json'],
        permissionDiff: [{ permission: 'data.read:shopify', status: 'new_requires_approval' }],
      });
    }
    if (path === '/deployments/agt_1/code-branches/cb_0001/pipeline-quote') {
      return json(200, { quoteId: 'q_1', sandboxRuns: 1, limits: { cpuMs: 8000 } });
    }
    if (path === '/deployments/agt_1/code-branches/cb_0001/pipeline' && opts.background !== undefined) {
      // The deployed platform (foundry-routes-handler runPipeline, pipelineInBackground wired): 202, no artifactRef.
      return json(202, {
        status: 'running',
        branchId: 'cb_0001',
        stages: [{ stage: 'build', status: 'running', detail: '' }],
      });
    }
    if (method === 'GET' && path === '/deployments/agt_1/code-branches' && opts.background !== undefined) {
      const read = opts.background[Math.min(reads, opts.background.length - 1)]!;
      reads += 1;
      return json(200, { branches: [{ branchId: 'cb_0001', branch: 'cli/hello-tool-1', ...read }] });
    }
    if (path === '/deployments/agt_1/code-branches/cb_0001/pipeline') {
      return json(200, {
        artifactRef: opts.artifactRef === undefined ? 'artifact://agt_1/test/1' : opts.artifactRef,
        stages: [
          { stage: 'build', status: 'passed', detail: 'code://hello-tool/1@sha256:x' },
          { stage: 'tests', status: 'passed', detail: '1 passed in the sandbox' },
        ],
      });
    }
    if (path === '/deployments/agt_x/code-branches') {
      return json(400, {
        error: {
          code: 'AGENT_INVALID_INPUT',
          details: {
            reason: 'the project has problems',
            problems: [{ file: 'x.txt', message: 'not part of an extension project' }],
          },
        },
      });
    }
    return json(404, { error: { code: 'ROUTE_NOT_FOUND', details: {} } });
  };
  return { fetch: impl as typeof fetch, sent };
}

function io(cwd: string, f: typeof fetch, env: Record<string, string> = { REVITION_TOKEN: 'tok' }) {
  const out: string[] = [];
  const err: string[] = [];
  const cli: CliIo = {
    cwd,
    env: { REVITION_API_URL: 'https://api.test.invalid/api/v1', ...env },
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    fetch: f,
  };
  return { cli, out, err };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'revition-cli-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scaffold -> build -> test, locally', () => {
  it('scaffold writes the starter’s project and never overwrites', async () => {
    const api = fakeApi();
    const a = io(root, api.fetch);
    expect(await runCli(['scaffold', 'hello-tool'], a.cli)).toBe(0);
    expect(readdirSync(join(root, 'hello-tool')).sort()).toEqual(['capabilities', 'revition.json']);
    expect(a.out).toContain('wrote capabilities/hello-tool/main.ts');
    expect(api.sent[0]).toMatchObject({
      method: 'GET',
      path: '/dev/starters/hello-tool',
      auth: 'Bearer tok',
    });
    const again = io(root, api.fetch);
    expect(await runCli(['scaffold', 'hello-tool'], again.cli)).toBe(1);
    expect(again.err[0]).toMatch(/already has .*nothing was written/);
    expect(await runCli(['scaffold'], io(root, api.fetch).cli)).toBe(2);
  });

  it('build is the platform’s check: ok, then the problem named by file', async () => {
    const api = fakeApi();
    await runCli(['scaffold', 'hello-tool', 'p'], io(root, api.fetch).cli);
    const ok = io(root, api.fetch);
    expect(await runCli(['build', '--dir', 'p'], ok.cli)).toBe(0);
    expect(ok.out.at(-1)).toBe('ok: the project passes the build’s checks');
    writeFileSync(join(root, 'p/notes.txt'), 'x');
    const bad = io(root, api.fetch);
    expect(await runCli(['build', '--dir', 'p'], bad.cli)).toBe(1);
    expect(bad.err).toEqual(['problem notes.txt: not part of an extension project']);
  });

  it('test runs the tests here against stubbed ports; a wrong expectation fails', async () => {
    const api = fakeApi();
    await runCli(['scaffold', 'webhook-receiver', 'w'], io(root, api.fetch).cli);
    writeFileSync(join(root, 'w/fixtures.json'), JSON.stringify({ 'observability.log': null }));
    const ok = io(root, api.fetch);
    expect(await runCli(['test', '--dir', 'w'], ok.cli)).toBe(0);
    expect(ok.out).toEqual([
      'PASS webhook-receiver: accepts a delivery',
      '  sdk observability.log: answered from fixtures (nothing real touched)',
      'all tests passed locally',
    ]);
    const tests = join(root, 'w/capabilities/webhook-receiver/tests.json');
    writeFileSync(
      tests,
      JSON.stringify([{ name: 'wrong', input: {}, expect: { accepted: false } }])
    );
    const bad = io(root, api.fetch);
    expect(await runCli(['test', '--dir', 'w'], bad.cli)).toBe(1);
    expect(bad.out).toContain('FAIL webhook-receiver: wrong');
    expect(bad.out).toContain('  returned {"accepted":true}, expected {"accepted":false}');
    // Only the Developer Portal's free routes were called: no branch, no pipeline, no model.
    expect(new Set(api.sent.map((s) => `${s.method} ${s.path}`))).toEqual(
      new Set([
        'GET /dev/starters/webhook-receiver',
        'POST /dev/authoring/check',
        'GET /dev/docs/sdk',
      ])
    );
  }, 60_000);

  it('a missing fixture fails the test with the fix; a project with problems is not run', async () => {
    const api = fakeApi();
    await runCli(['scaffold', 'webhook-receiver', 'w'], io(root, api.fetch).cli);
    const r = io(root, api.fetch);
    expect(await runCli(['test', '--dir', 'w'], r.cli)).toBe(1);
    expect(r.out).toContain(
      '  sdk observability.log: no local fixture for observability.log: add "observability.log" to fixtures.json'
    );
    writeFileSync(join(root, 'w/extra.txt'), 'x');
    const bad = io(root, api.fetch);
    expect(await runCli(['test', '--dir', 'w'], bad.cli)).toBe(1);
    expect(bad.err).toEqual(['problem extra.txt: not part of an extension project']);
    // A project the build would refuse (a blocking finding) is not run locally either.
    rmSync(join(root, 'w/extra.txt'));
    const main = join(root, 'w/capabilities/webhook-receiver/main.ts');
    const source = readFileSync(main, 'utf8');
    writeFileSync(main, `import { execSync } from 'child_process';\n${source}`);
    const refused = io(root, api.fetch);
    expect(await runCli(['test', '--dir', 'w'], refused.cli)).toBe(1);
    expect(refused.err).toEqual([
      'problem capabilities/webhook-receiver: high: process: spawning a process (line 1)',
    ]);
    expect(refused.out.filter((l) => l.startsWith('PASS') || l.startsWith('FAIL'))).toEqual([]);
    writeFileSync(main, source);
    writeFileSync(join(root, 'w/fixtures.json'), '[]');
    const fx = io(root, api.fetch);
    expect(await runCli(['test', '--dir', 'w'], fx.cli)).toBe(1);
    expect(fx.err).toEqual(['fixtures.json is an object of SDK call name to result']);
  }, 60_000);
});

describe('deploy and eval: a branch for review, then the one pipeline', () => {
  it('deploy proposes exactly the directory’s files as a cli branch; it approves nothing', async () => {
    const api = fakeApi();
    await runCli(['scaffold', 'hello-tool', 'p'], io(root, api.fetch).cli);
    const d = io(root, api.fetch);
    expect(await runCli(['deploy', '--agent', 'agt_1', '--dir', 'p'], d.cli)).toBe(0);
    const post = api.sent.find((s) => s.method === 'POST' && s.path.endsWith('/code-branches'))!;
    expect(post.body).toEqual({
      mode: 'cli',
      files: {
        'revition.json': readFileSync(join(root, 'p/revition.json'), 'utf8'),
        'capabilities/hello-tool/main.ts': readFileSync(
          join(root, 'p/capabilities/hello-tool/main.ts'),
          'utf8'
        ),
        'capabilities/hello-tool/tests.json': readFileSync(
          join(root, 'p/capabilities/hello-tool/tests.json'),
          'utf8'
        ),
      },
    });
    expect(d.out).toEqual([
      'proposed cli/hello-tool-1 (cb_0001) with capabilities/hello-tool/main.ts, capabilities/hello-tool/tests.json',
      '  needs data.read:shopify: an Owner or Admin must grant it',
      'Next: an Owner or Admin reviews the branch; then revition eval --agent agt_1 --branch cb_0001',
    ]);
    expect(await runCli(['deploy', '--dir', 'p'], io(root, api.fetch).cli)).toBe(2);
    const refused = io(root, api.fetch);
    expect(await runCli(['deploy', '--agent', 'agt_x', '--dir', 'p'], refused.cli)).toBe(1);
    expect(refused.err).toEqual([
      'refused: AGENT_INVALID_INPUT: the project has problems',
      '  x.txt: not part of an extension project',
    ]);
  });

  it('eval quotes first and runs nothing without --yes; with it, runs the pipeline against that quote', async () => {
    const api = fakeApi();
    const q = io(root, api.fetch);
    expect(await runCli(['eval', '--agent', 'agt_1', '--branch', 'cb_0001'], q.cli)).toBe(0);
    expect(api.sent.map((s) => s.method)).toEqual(['GET']);
    expect(q.out).toEqual([
      'quote q_1: 1 sandbox test run(s) at {"cpuMs":8000}',
      'Nothing ran. Re-run with --yes to run the pipeline against this quote.',
    ]);
    const y = io(root, api.fetch);
    expect(await runCli(['eval', '--agent', 'agt_1', '--branch', 'cb_0001', '--yes'], y.cli)).toBe(
      0
    );
    expect(api.sent.at(-1)).toMatchObject({ method: 'POST', body: { quoteId: 'q_1' } });
    expect(y.out.slice(1)).toEqual([
      'build: passed (code://hello-tool/1@sha256:x)',
      'tests: passed (1 passed in the sandbox)',
      'promoted to test as artifact://agt_1/test/1',
    ]);
    const blocked = fakeApi({ artifactRef: null });
    expect(
      await runCli(
        ['eval', '--agent', 'agt_1', '--branch', 'cb_0001', '--yes'],
        io(root, blocked.fetch).cli
      )
    ).toBe(1);
    expect(await runCli(['eval', '--agent', 'agt_1'], io(root, api.fetch).cli)).toBe(2);
  });

  // F5 (R396): a deployed platform answers the run with 202 and writes the end on the branch.
  const RUNNING: BranchRead = {
    status: 'approved',
    pipeline: [
      { stage: 'build', status: 'passed', detail: 'code://hello-tool/1@sha256:x' },
      { stage: 'tests', status: 'running', detail: '' },
    ],
  };
  const PROMOTED: BranchRead = {
    status: 'promoted',
    artifactRef: 'artifact://agt_1/test/1',
    pipeline: [
      { stage: 'build', status: 'passed', detail: 'code://hello-tool/1@sha256:x' },
      { stage: 'tests', status: 'passed', detail: '1 passed in the sandbox' },
    ],
  };
  const noWait = (): Promise<void> => Promise.resolve();

  it('a 202 background run: eval reads the branch until no stage runs, then prints the 200 lines', async () => {
    const api = fakeApi({ background: [RUNNING, PROMOTED] });
    const y = io(root, api.fetch);
    const code = await runCli(['eval', '--agent', 'agt_1', '--branch', 'cb_0001', '--yes'], {
      ...y.cli,
      sleep: noWait,
    });
    expect(y.err).toEqual([]);
    expect(code).toBe(0);
    expect(y.out.slice(1)).toEqual([
      'build: passed (code://hello-tool/1@sha256:x)',
      'tests: passed (1 passed in the sandbox)',
      'promoted to test as artifact://agt_1/test/1',
    ]);
    expect(api.sent.filter((s) => s.method === 'GET' && s.path === '/deployments/agt_1/code-branches')).toHaveLength(2);
  });

  it('a 202 run that ends blocked, or never ends within the wait, is never a success', async () => {
    const blocked = fakeApi({
      background: [
        { status: 'blocked', artifactRef: null, pipeline: [{ stage: 'tests', status: 'failed', detail: 'x' }] },
      ],
    });
    const b = io(root, blocked.fetch);
    expect(
      await runCli(['eval', '--agent', 'agt_1', '--branch', 'cb_0001', '--yes'], { ...b.cli, sleep: noWait })
    ).toBe(1);
    expect(b.out.at(-1)).toBe('not promoted');
    const stuck = fakeApi({ background: [RUNNING] });
    const s = io(root, stuck.fetch);
    expect(
      await runCli(['eval', '--agent', 'agt_1', '--branch', 'cb_0001', '--yes'], { ...s.cli, sleep: noWait })
    ).toBe(1);
    expect(s.err).toEqual(['the pipeline is still running after 15 min; re-read the branch later']);
  });
});

describe('usage and credentials', () => {
  it('no token: refused before any call; unknown command or flag: usage', async () => {
    const api = fakeApi();
    const r = io(root, api.fetch, {});
    expect(await runCli(['build'], r.cli)).toBe(1);
    expect(r.err).toEqual(['set REVITION_TOKEN to your Revition access token']);
    expect(await runCli(['build'], io(root, api.fetch, { REVITION_TOKEN: '' }).cli)).toBe(1);
    expect(api.sent).toEqual([]);
    const u = io(root, api.fetch);
    expect(await runCli(['publish'], u.cli)).toBe(2);
    expect(u.err[0]).toMatch(/^usage: revition/);
    expect(await runCli(['build', '--nope'], io(root, api.fetch).cli)).toBe(2);
  });
});

describe('AC3 — the CLI has no road around the branch, the review or the pipeline (grep)', () => {
  const src = readdirSync(__dirname)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(__dirname, f), 'utf8'))
    .join('\n');

  it('it calls only the check, starter, reference, code-branch and pipeline routes', () => {
    const client = readFileSync(join(__dirname, 'client.ts'), 'utf8');
    expect([...client.matchAll(/`(\/(?:dev|deployments)[^`]*)`/g)].map((m) => m[1]).sort()).toEqual(
      [
        // POST proposes the branch; GET (F5, R396) reads a background pipeline's end. Both are the one branch route.
        '/deployments/${seg(agentId)}/code-branches',
        '/deployments/${seg(agentId)}/code-branches',
        '/deployments/${seg(agentId)}/code-branches/${seg(branchId)}/pipeline',
        '/deployments/${seg(agentId)}/code-branches/${seg(branchId)}/pipeline-quote',
        '/dev/starters/${seg(starterId)}',
      ]
    );
    expect([...client.matchAll(/'(\/dev\/[^']*)'/g)].map((m) => m[1]).sort()).toEqual([
      '/dev/authoring/check',
      '/dev/docs/sdk',
    ]);
  });

  it('no upload, approval, promotion, publish or environment route appears anywhere in it', () => {
    expect(src).not.toMatch(
      /code-capabilities|\/approve|\/reject|\/environments|\/promote|\/publish|\/go-live/
    );
    expect(src).toMatch(/mode: 'cli'/);
  });
});
