import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { dirs, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

/**
 * T3.2.1 AC1 - the commands the other suites do not run with --json, each run here with --json through the real CLI
 * against one fixture platform. `runCli` validates every successful document against the command's PUBLISHED schema
 * (test-fixtures/json-conformance.ts), so a passing case is a conforming document.
 */
const KEY = { keyId: 'k1', appId: 'dapp_mine', scopes: ['source:orders'], issuedAt: '2026-11-18T00:00:00Z', expiresAt: '2027-02-16T00:00:00Z', revokeAt: null };
const BRANCH = {
  branch: 'cli/hello-1', branchId: 'br_1', files: ['revition.json'], testsAdded: [], permissionDiff: [],
  impact: { permission: { expanded: [], reduced: [] }, data: { expanded: [], reduced: [] }, ai: [], ui: [], cost: [], security: [], risky: false, flags: [] },
  agentId: 'dep_1', origin: 'cli', summary: 'Hello', status: 'approved', createdAt: '2026-11-18T00:00:00Z',
  pipeline: [{ stage: 'evaluation', status: 'passed', detail: '' }], artifactRef: 'art_1', history: [],
};
const SUB = { submissionId: 's1', appId: 'dapp_mine', version: '1.0.0', state: 'in_review', projectId: 'dproj_1', projectVersion: 1, autoResults: {}, reviewNotes: [], history: [], createdAt: 'x', updatedAt: 'x' };
const RUN = {
  runId: 'devev_1', appId: 'dapp_mine', suiteId: 'smoke', projectId: 'dproj_1', projectVersion: 1, digest: 'sha256:a',
  report: { capabilityId: 'hello', version: '1.0.0', suiteId: 'smoke', baseline: { task_success: 0.5 }, withCapability: { task_success: 0.7 }, delta: { task_success: 0.2 }, verdict: 'improves' },
  passRate: 0.7, cases: 2, at: 'x', billedCredits: 1,
};
const SDK = { version: '1.0.0', namespaces: [{ name: 'tool', calls: [{ call: 'tool.invoke', signature: 'invoke(): void', doc: null, permissions: [] }] }], types: [] };

function platform(): Promise<MockPlatform> {
  return startMockPlatform((method, path) => {
    const routes: Record<string, unknown> = {
      'GET /dev/apps/dapp_mine/keys': { keys: [KEY] },
      'DELETE /dev/apps/dapp_mine/keys/k1': { revoked: true },
      'GET /dev/audit': { events: [{ event: 'app_registered', at: 1_763_424_000_000, client: 'cli', appId: 'dapp_mine' }] },
      'GET /deployments/dep_1/code-branches': { branches: [BRANCH] },
      'POST /deployments/dep_1/code-branches': BRANCH,
      'GET /deployments/dep_1/code-branches/br_1/pipeline-quote': { quoteId: 'pq_1', sandboxRuns: 1, limits: { wallMs: 1000 } },
      'POST /deployments/dep_1/code-branches/br_1/pipeline': { artifactRef: 'art_1', stages: BRANCH.pipeline },
      'GET /dev/docs/sdk': SDK,
      'GET /dev/apps/dapp_mine/evals': { runs: [RUN] },
      'GET /dev/extension-points': { extensionPoints: [{ id: 'code_tool', title: 'Code tool', description: 'x', surface: 'agent tools' }] },
      'GET /dev/apps': { apps: [{ appId: 'dapp_mine', manifestRef: 'plugin://mine@0.1.0', manifest: {}, declaredScopes: [], createdAt: 'x' }] },
      'GET /dev/projects/dproj_1': { projectId: 'dproj_1', name: 'p', starterId: null, version: 1, files: {} },
      'GET /dev/apps/dapp_mine/runs/r1/logs': { runId: 'r1', kind: 'execution', build: [], exec: [], errors: [], eval: [], withheld: 0, notes: [] },
      'GET /dev/starters': { starters: [{ id: 'hello-tool', title: 'Hello', extensionPoint: 'code_tool', language: 'ts' }] },
      'GET /dev/starters/hello-tool': { id: 'hello-tool', title: 'Hello', extensionPoint: 'code_tool', language: 'ts', files: { 'revition.json': '{}\n' } },
      'GET /dev/apps/dapp_mine/secrets': { names: [{ name: 'API_KEY', updatedAt: 'x' }], firstSetCost: null },
      'PUT /dev/apps/dapp_mine/secrets/API_KEY': { name: 'API_KEY' },
      'DELETE /dev/apps/dapp_mine/secrets/API_KEY': { name: 'API_KEY' },
      'GET /dev/apps/dapp_mine/submissions': { submissions: [SUB] },
      'GET /dev/apps/dapp_mine/submissions/1.0.0': SUB,
      'POST /dev/apps/dapp_mine/submissions': SUB,
      'GET /dev/apps/dapp_mine/analytics': {
        appId: 'dapp_mine', published: true, period: { days: 30, startMs: 0, endMs: 1 },
        stats: { installs: 1, active: 1, revenueUsd: 1, rating: 4, errorRate: 0, upliftTrend: [] },
        sources: { installs: { state: 'recorded' }, active: { state: 'recorded' }, revenueUsd: { state: 'recorded' }, rating: { state: 'recorded' }, errorRate: { state: 'recorded' }, upliftTrend: { state: 'recorded' } },
        payouts: null, upliftVersions: [],
      },
    };
    const body = routes[`${method} ${path}`];
    return body === undefined ? null : ok(body);
  });
}

async function linked(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'conf-'));
  const f = join(dir, '.revition/project.json');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ schemaVersion: 1, appId: 'dapp_mine', projectId: 'dproj_1' }));
  writeFileSync(join(dir, 'revition.json'), '{"summary":"x","capabilities":[]}\n');
  return dir;
}

const CASES: readonly (readonly string[])[] = [
  ['apps', 'keys', 'list', 'dapp_mine'],
  ['apps', 'keys', 'revoke', 'dapp_mine', 'k1', '--yes'],
  ['audit'],
  ['analytics'],
  ['branches', 'list', '--agent', 'dep_1'],
  ['branches', 'view', 'br_1', '--agent', 'dep_1'],
  ['branches', 'eval', 'br_1', '--agent', 'dep_1', '--yes'],
  ['deploy', '--agent', 'dep_1', '--yes'],
  ['docs', 'sdk'],
  ['eval', 'list'],
  ['extension-points'],
  ['link', '--app', 'dapp_mine', '--project', 'dproj_1', '--yes'],
  ['logs', 'r1'],
  ['open', 'docs'],
  ['scaffold', 'hello-tool', 'scaffolded'],
  ['secrets', 'set', 'API_KEY', '--app', 'dapp_mine', '--yes'],
  ['secrets', 'unset', 'API_KEY', '--app', 'dapp_mine', '--yes'],
  ['starters', 'list'],
  ['starters', 'view', 'hello-tool'],
  ['submissions', 'list'],
  ['submissions', 'view', '1.0.0'],
  ['submit', '--version', '1.0.0', '--yes'],
];

describe('T3.2.1 AC1 - every remaining plugin-dev command: its --json output conforms to the published schema', () => {
  for (const argv of CASES) {
    it(`[CLI-T3.2.1-AC1] ${argv.slice(0, 3).join(' ')} --json`, async () => {
      const p = await platform();
      try {
        const r = await runCli([...argv, '--json'], { cwd: await linked(), host: p.host, env: { ...(await dirs()), SSH_CONNECTION: 'conformance' }, input: 'value-from-stdin' });
        assert.equal(r.code, 0, r.stdout + r.stderr);
        assert.equal((JSON.parse(r.stdout) as { ok: boolean }).ok, true);
      } finally {
        p.close();
      }
    });
  }
});
