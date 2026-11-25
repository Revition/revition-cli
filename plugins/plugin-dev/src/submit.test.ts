import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertOpenable } from './commands/submissions/open.js';
import { RELEASE_PAGE_URL } from './commands/versions/open.js';
import { dirs, err, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

const AUTO = {
  scan: { pass: true, reasons: [] },
  compatibility: { pass: true, reasons: [] },
  policy: { pass: true, reasons: [] },
  eval: { pass: true, reasons: [] },
};
const SUBMITTED = {
  submissionId: 'dsub_1',
  appId: 'dapp_mine',
  version: '1.2.0',
  state: 'in_review',
  projectId: 'dproj_1',
  projectVersion: 3,
  autoResults: AUTO,
  reviewNotes: [],
  certification: null,
  history: [
    { state: 'submitted', at: '2026-11-18T01:00:00.000Z', reason: 'project Hello v3' },
    { state: 'auto_checks', at: '2026-11-18T01:00:01.000Z', reason: 'automatic checks' },
    { state: 'in_review', at: '2026-11-18T01:00:02.000Z', reason: 'all automatic checks passed' },
  ],
  createdAt: '2026-11-18T01:00:00.000Z',
  updatedAt: '2026-11-18T01:00:02.000Z',
};
const CERTIFIED = {
  ...SUBMITTED,
  state: 'certified',
  reviewNotes: ['Looks good'],
  certification: { badges: ['security_scanned', 'eval_verified'], certifiedAt: '2026-11-18T02:00:00.000Z' },
  history: [...SUBMITTED.history, { state: 'certified', at: '2026-11-18T02:00:00.000Z', reason: 'approved by reviewer' }],
};
const FAILED_EVAL = { ...SUBMITTED, version: '1.1.0', state: 'changes_requested', autoResults: { ...AUTO, eval: { pass: false, reasons: ['no evaluation of this snapshot'] } } };

async function linked(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'submit-'));
  const f = join(dir, '.revition/project.json');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ schemaVersion: 1, appId: 'dapp_mine', projectId: 'dproj_1' }));
  return dir;
}

function platform(): Promise<MockPlatform> {
  let state: Record<string, unknown> = SUBMITTED;
  return startMockPlatform((method, path, body) => {
    if (method === 'POST' && path === '/dev/apps/dapp_mine/submissions') {
      if ((body as { version: string }).version === '1.0.0') {
        return err(409, 'AGENT_STATE_CONFLICT', 'That conflicts with the current state.');
      }
      return { status: 201, body: SUBMITTED };
    }
    if (method === 'GET' && path === '/dev/apps/dapp_mine/submissions') return ok({ submissions: [state, FAILED_EVAL] });
    if (method === 'GET' && path === '/dev/apps/dapp_mine/submissions/1.2.0') {
      const now = state;
      state = CERTIFIED;
      return ok(now);
    }
    if (method === 'GET' && path === '/dev/apps/dapp_mine/submissions/1.1.0') return ok(FAILED_EVAL);
    return null;
  });
}

describe('T2.3.3 submit / submissions', () => {
  it('[CLI-T2.3.3-AC1] submit -> status lifecycle: the checks, the review, then "ready to publish" with the reviewer outcome', async () => {
    const p = await platform();
    try {
      const cwd = await linked();
      const env = { ...(await dirs()), SSH_CONNECTION: 'test' };
      const s = await runCli(['submit', '--version', '1.2.0', '--yes'], { cwd, host: p.host, env });
      assert.equal(s.code, 0, s.stderr);
      assert.deepEqual(p.log.find((l) => l.method === 'POST')?.body, { version: '1.2.0', projectId: 'dproj_1' });
      assert.match(s.stdout, /^dapp_mine 1\.2\.0: in_review\n/);
      assert.match(s.stdout, /auto_checks: automatic checks/);
      assert.match(s.stdout, /check eval: passed/);
      const inReview = await runCli(['submissions', 'view', '1.2.0'], { cwd, host: p.host, env });
      assert.match(inReview.stdout, /in_review/);
      const certified = await runCli(['submissions', 'view', '1.2.0'], { cwd, host: p.host, env });
      assert.match(certified.stdout, /^dapp_mine 1\.2\.0: certified - ready to publish/);
      assert.match(certified.stdout, /review: Looks good/);
      assert.match(certified.stdout, /certified: approved by reviewer/);
      assert.match(certified.stdout, /badges: security_scanned, eval_verified/);
      const failed = await runCli(['submissions', 'view', '1.1.0'], { cwd, host: p.host, env });
      assert.match(failed.stdout, /check eval: failed\n {4}no evaluation of this snapshot/);
      const list = await runCli(['submissions', 'list'], { cwd, host: p.host, env });
      assert.match(list.stdout, /1\.2\.0.*certified \(ready to publish\)/);
    } finally {
      p.close();
    }
  });

  it('edge: re-submitting a version is refused by the server; the CLI says a higher version is needed', async () => {
    const p = await platform();
    try {
      const r = await runCli(['submit', '--version', '1.0.0', '--yes', '--json'], { cwd: await linked(), host: p.host, env: await dirs() });
      assert.equal(r.code, 6);
      assert.match((JSON.parse(r.stdout) as { error: { hint: string } }).error.hint, /submit a higher version/);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.3-AC2] submissions open: the exact portal publish page, allowlisted; nothing is published', async () => {
    const p = await platform();
    try {
      const env = { ...(await dirs()), SSH_CONNECTION: 'test' };
      const r = await runCli(['submissions', 'open', '1.2.0', '--json'], { cwd: await linked(), host: p.host, env });
      assert.equal(r.code, 0, r.stderr);
      const d = (JSON.parse(r.stdout) as { data: { url: string; opened: boolean } }).data;
      assert.equal(d.url, 'https://developer.revition.com/apps');
      assert.equal(d.opened, false);
      assert.deepEqual(p.log.map((l) => `${l.method} ${l.path}`), ['GET /dev/apps/dapp_mine/submissions/1.2.0']);
      assert.throws(() => assertOpenable('https://evil.example.com/apps'), /not a Revition page/);
      assert.throws(() => assertOpenable('http://developer.revition.com/apps'), /not a Revition page/);
      assert.equal(assertOpenable(RELEASE_PAGE_URL), RELEASE_PAGE_URL);
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
    else if (/\.(ts|mts|js|mjs|json)$/.test(n) && !/\.test\.(ts|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

const CLI_SOURCES = (): string[] =>
  ['packages/core/src', 'packages/cli/src', 'packages/api-client/src', 'packages/api-client/openapi', 'plugins/plugin-dev/src'].flatMap((d) => sources(join(ROOT, d)));

describe('T2.3.3 AC3 / T2.3.4 AC3: no CLI module references a human-only release route', () => {
  it('[CLI-T2.3.3-AC3] no CLI module (or the CLI contract) references the publish route', () => {
    const files = CLI_SOURCES();
    assert.ok(files.length > 50);
    // The one exclusion: npm's provenance predicate type URL (`.../npm/attestation/tree/main/specs/publish/v0.1`), a
    // fixed Sigstore string the T4.2.1 plugin verifier must compare against; it is not a Revition route.
    const route = /submissions\/[^'"`\s]*\/publish|(?<!specs)\/publish\b/;
    assert.deepEqual(files.filter((f) => route.test(readFileSync(f, 'utf8'))), []);
    // Control: the guard still flags a publish route written in any form.
    for (const hit of ['`/dev/apps/${a}/submissions/${s}/publish`', "'/v1/publish'", '"/foundry/dev/publish"']) assert.ok(route.test(hit), hit);
    assert.equal(route.test('https://github.com/npm/attestation/tree/main/specs/publish/v0.1'), false);
  });

  it('[CLI-T2.3.4-AC3] no CLI module references a release write route (channel cut, rollout, advance, advisory, deprecation, upgrade assist, security policy)', () => {
    const writes = /\/release\/apps\/[^'"`\s]*\/(channels\/|rollouts\/|advisories|deprecations|upgrade-assist)|\/release\/security-policy/;
    assert.deepEqual(CLI_SOURCES().filter((f) => writes.test(readFileSync(f, 'utf8'))), []);
    // The CLI does read the two release routes, so the scan is not vacuous.
    const reads = CLI_SOURCES().filter((f) => /\/release\/apps\/\$\{seg\(appId\)\}\/(channels|rollouts)`/.test(readFileSync(f, 'utf8')));
    assert.equal(reads.length, 2);
  });
});
