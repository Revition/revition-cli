import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { dirs, err, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

const FILES: Record<string, string> = {
  'revition.json': '{"summary":"Hello","capabilities":[{"id":"hello","name":"Hello","language":"ts","entrypoint":"run"}]}\n',
  'capabilities/hello/run.ts': 'export async function run(i) { return i; }\n',
};
const IMPACT = {
  permission: { expanded: ['data:orders'], reduced: [], needsApproval: ['data:orders'] },
  data: { expanded: ['data:orders'], reduced: [] },
  ai: [],
  ui: [],
  cost: ['one more model call per run'],
  security: [],
  risky: true,
  flags: ['permission expanded: data:orders'],
};
const PROPOSED = { branch: 'cli/hello-1', branchId: 'br_1', files: Object.keys(FILES), testsAdded: [], permissionDiff: [{ permission: 'data:orders' }], impact: IMPACT };
const BRANCH = {
  ...PROPOSED,
  agentId: 'dep_1',
  origin: 'cli',
  summary: 'Hello',
  status: 'approved',
  createdAt: '2026-11-18T01:00:00.000Z',
  reviewedBy: 'auth0|owner',
  pipeline: [{ stage: 'build', status: 'passed', detail: '' }],
  artifactRef: null,
  history: [{ at: '2026-11-18T01:00:00.000Z', by: 'auth0|dev', event: 'proposed' }],
};

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'deploy-'));
  for (const [f, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

function platform(opts: { forbidden?: boolean } = {}): Promise<MockPlatform> {
  return startMockPlatform((method, path) => {
    if (method === 'POST' && path === '/deployments/dep_1/code-branches') {
      return opts.forbidden === true ? err(403, 'AGENT_FORBIDDEN', 'You cannot edit this agent.') : { status: 201, body: PROPOSED };
    }
    if (method === 'GET' && path === '/deployments/dep_1/code-branches') return ok({ branches: [BRANCH] });
    return null;
  });
}

describe('T2.3.2 deploy (branch proposal) + branches', () => {
  it('[CLI-T2.3.2-AC2] deploy shows the server impact summary and the review link; it never activates anything', async () => {
    const p = await platform();
    try {
      const r = await runCli(['deploy', '--agent', 'dep_1', '--dir', await project(), '--yes'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /^proposed cli\/hello-1 \(br_1\) with revition\.json, capabilities\/hello\/run\.ts\n/);
      assert.match(r.stdout, /impact: flagged: the reviewer must look before merging/);
      assert.match(r.stdout, / {2}permission: \+data:orders/);
      assert.match(r.stdout, / {2}cost: one more model call per run/);
      assert.match(r.stdout, / {2}flag: permission expanded: data:orders/);
      assert.match(r.stdout, /review: https:\/\/app\.revition\.com\/foundry\/agents\/dep_1\/edit\?section=apps_capabilities_plugins/);
      // One proposal, nothing else: no approve / merge / pipeline call.
      assert.deepEqual(p.log.map((l) => `${l.method} ${l.path}`).filter((x) => x.includes('/deployments/')), ['POST /deployments/dep_1/code-branches']);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.2-AC2] deploy needs confirmation non-interactively; an agent you cannot edit is a 403 with an explanation', async () => {
    const p = await platform({ forbidden: true });
    try {
      const unconfirmed = await runCli(['deploy', '--agent', 'dep_1', '--dir', await project(), '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(unconfirmed.code, 2);
      assert.equal(p.log.filter((l) => l.method === 'POST').length, 0);
      const r = await runCli(['deploy', '--agent', 'dep_1', '--dir', await project(), '--yes', '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 4);
      const e = (JSON.parse(r.stdout) as { error: { code: string; hint: string } }).error;
      assert.equal(e.code, 'AGENT_FORBIDDEN');
      assert.match(e.hint, /edit access to agent dep_1/);
    } finally {
      p.close();
    }
  });

  it('branches list / view / status read the platform and point to the portal for review', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      const list = await runCli(['branches', 'list', '--agent', 'dep_1'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(list.code, 0, list.stderr);
      assert.match(list.stdout, /cli\/hello-1.*br_1.*approved/);
      const view = await runCli(['branches', 'view', 'br_1', '--agent', 'dep_1'], { cwd: tmpdir(), host: p.host, env });
      assert.match(view.stdout, /approved by auth0\|owner/);
      assert.match(view.stdout, /impact: flagged/);
      assert.match(view.stdout, /build: passed/);
      const status = await runCli(['branches', 'status', 'br_1', '--agent', 'dep_1', '--json'], { cwd: tmpdir(), host: p.host, env });
      const d = (JSON.parse(status.stdout) as { data: { status: string; reviewedBy: string } }).data;
      assert.deepEqual([d.status, d.reviewedBy], ['approved', 'auth0|owner']);
      const missing = await runCli(['branches', 'view', 'br_9', '--agent', 'dep_1', '--json'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(missing.code, 5);
    } finally {
      p.close();
    }
  });
});

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string): string[] {
  let out: string[] = [];
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist' || n === 'test-fixtures') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out = [...out, ...sources(p)];
    else if (/\.(ts|mts|js|mjs)$/.test(n) && !/\.test\.(ts|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

describe('T2.3.2 AC3: approval and merge are human steps in the portal', () => {
  it('[CLI-T2.3.2-AC3] no CLI module calls a branch approve / reject / merge route, and no command approves or merges', () => {
    const files = ['packages/core/src', 'packages/cli/src', 'packages/api-client/src', 'plugins/plugin-dev/src'].flatMap((d) => sources(join(ROOT, d)));
    assert.ok(files.length > 50, `scanned ${files.length} files`);
    const hits = files.filter((f) => /code-branches\/[^'"`]*\/(approve|reject|merge)\b/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(hits, []);
    const manifest = JSON.parse(readFileSync(join(ROOT, 'plugins/plugin-dev/oclif.manifest.json'), 'utf8')) as { commands: Record<string, unknown> };
    const core = JSON.parse(readFileSync(join(ROOT, 'packages/cli/oclif.manifest.json'), 'utf8')) as { commands: Record<string, unknown> };
    const ids = [...Object.keys(manifest.commands), ...Object.keys(core.commands)];
    assert.ok(ids.includes('branches:status'));
    assert.deepEqual(ids.filter((id) => /approve|merge|reject/.test(id)), []);
  });
});
