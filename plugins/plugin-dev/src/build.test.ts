import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { localChecks } from './checks/local-checks.js';
import { dirs, err, ok, runCli, startMockPlatform, type Answer } from './test-fixtures/mock-platform.js';

const MANIFEST = { summary: 'Hello', capabilities: [{ id: 'hello', name: 'Hello', language: 'ts', entrypoint: 'run' }] };
const GOOD: Record<string, string> = {
  'revition.json': `${JSON.stringify(MANIFEST)}\n`,
  'capabilities/hello/run.ts': 'export async function run(i) { return i; }\n',
  'capabilities/hello/tests.json': '[{"name":"echo","input":1,"expect":1}]\n',
  'fixtures.json': '{}\n',
};

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'build-'));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

const CHECK_OK = { ok: true, problems: [], warnings: [], buildLogs: { hello: ['compiled'] }, project: null, granted: {} };

async function platform(check: Answer) {
  return startMockPlatform((method, path) => (method === 'POST' && path === '/dev/authoring/check' ? check : null));
}

describe('T2.1.2 build (local)', () => {
  it('[CLI-T2.1.2-AC1] a broken manifest fails locally with its location, and nothing is sent', async () => {
    const p = await platform(ok(CHECK_OK));
    try {
      const env = await dirs();
      const cases: Array<[Record<string, string>, RegExp]> = [
        [{ ...GOOD, 'revition.json': '{ not json' }, /problem revition\.json: not valid JSON/],
        [{ ...GOOD, 'revition.json': JSON.stringify({ summary: 'x', capabilities: [] }) }, /problem revition\.json: capabilities: 1 to 5 capabilities/],
        [{ ...GOOD, 'revition.json': JSON.stringify({ summary: 'x', capabilities: [{ id: 'hello' }] }) }, /problem revition\.json: capabilities\.0: language, entrypoint required/],
        [{ 'capabilities/hello/run.ts': 'x' }, /problem revition\.json: missing/],
      ];
      for (const [files, line] of cases) {
        const r = await runCli(['build', '--dir', await project(files)], { cwd: tmpdir(), host: p.host, env });
        assert.equal(r.code, 6, r.stderr);
        assert.match(r.stdout, line);
        assert.match(r.stdout, /the project has problems/);
      }
      assert.equal(p.log.filter((x) => x.path === '/dev/authoring/check').length, 0, 'a locally broken project is never uploaded');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.2-AC1] the layout rules: missing source / tests, bad cases, stray files, the 32-file and 1.5 MB limits', () => {
    const { 'capabilities/hello/tests.json': _t, ...noTests } = GOOD;
    assert.deepEqual(localChecks(noTests).map((p) => [p.file, p.message]), [['capabilities/hello/tests.json', 'missing: every capability ships at least one test']]);
    assert.match(localChecks({ ...GOOD, 'capabilities/hello/tests.json': '[{"name":"x"}]' })[0]?.message ?? '', /exactly \{name, input, expect\}/);
    assert.deepEqual(localChecks({ ...GOOD, 'notes.txt': 'x' }).map((p) => p.file), ['notes.txt']);
    assert.deepEqual(localChecks({ ...GOOD, 'evals/smoke.json': '{}', 'README.md': '# x' }), []);
    const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}.txt`, 'x']));
    assert.match(localChecks(many)[0]?.message ?? '', /33 files: the platform limit is 32/);
    assert.match(localChecks({ ...GOOD, 'capabilities/hello/run.ts': 'x'.repeat(1_500_001) })[0]?.message ?? '', /the platform limit is 1500000 bytes/);
    assert.deepEqual(localChecks(GOOD), []);
  });
});

describe('T2.1.2 build (server)', () => {
  it('[CLI-T2.1.2-AC2] a server-side-only failure (a disallowed permission) is shown from /dev/authoring/check: exit 6', async () => {
    const p = await platform(ok({ ok: false, problems: [{ file: 'revition.json', message: 'capabilities.0.declaredPermissions.0: effect:pay.out is not a permission an extension may hold' }], warnings: [], buildLogs: {}, project: null, granted: {} }));
    try {
      const r = await runCli(['build', '--dir', await project(GOOD)], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 6);
      assert.match(r.stdout, /problem revition\.json: capabilities\.0\.declaredPermissions\.0: effect:pay\.out is not a permission/);
      const sent = p.log.find((x) => x.path === '/dev/authoring/check');
      assert.deepEqual(sent?.body, { files: GOOD }, 'the server receives exactly the project files');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.2-AC2] an empty developer wallet is exit 12 with the wallet hint; offline is "local checks only"; --strict fails on warnings', async () => {
    const broke = await platform(err(402, 'AGENT_ENTITLEMENT_REQUIRED', 'the developer wallet has no credit'));
    try {
      const r = await runCli(['build', '--dir', await project(GOOD)], { cwd: tmpdir(), host: broke.host, env: await dirs() });
      assert.equal(r.code, 12);
      assert.match(r.stderr, /developer wallet/);
    } finally {
      broke.close();
    }
    const offline = await runCli(['build', '--dir', await project(GOOD)], { cwd: tmpdir(), host: '127.0.0.1:9', env: await dirs() });
    assert.equal(offline.code, 0, offline.stderr);
    assert.match(offline.stdout, /local checks only/);
    const warn = await platform(ok({ ...CHECK_OK, warnings: [{ file: 'capabilities/hello/run.ts', message: 'console.log is dropped in production' }] }));
    try {
      const env = await dirs();
      const dir = await project(GOOD);
      assert.equal((await runCli(['build', '--dir', dir], { cwd: tmpdir(), host: warn.host, env })).code, 0);
      assert.equal((await runCli(['build', '--dir', dir, '--strict'], { cwd: tmpdir(), host: warn.host, env })).code, 6);
    } finally {
      warn.close();
    }
  });

  it('[CLI-T2.1.2-AC4] --json: one envelope listing every check, with the schema id', async () => {
    const p = await platform(ok(CHECK_OK));
    try {
      const r = await runCli(['build', '--dir', await project(GOOD), '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      const doc = JSON.parse(r.stdout) as { command: string; ok: boolean; data: { schemaId: string; ok: boolean; checks: Array<{ id: string; status: string }> } };
      assert.equal(doc.command, 'build');
      assert.equal(doc.data.schemaId, 'revition.build.v1');
      assert.deepEqual(doc.data.checks, [
        { id: 'size', status: 'ok' },
        { id: 'manifest', status: 'ok' },
        { id: 'layout', status: 'ok' },
        { id: 'tests', status: 'ok' },
        { id: 'server', status: 'ok' },
      ]);
      const bad = await runCli(['build', '--dir', await project({ ...GOOD, 'revition.json': '{' }), '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(bad.code, 6);
      const d = JSON.parse(bad.stdout) as { data: { ok: boolean; checks: Array<{ id: string; status: string }>; problems: Array<{ check: string; file: string }> } };
      assert.equal(d.data.ok, false);
      assert.deepEqual(d.data.checks.find((c) => c.id === 'manifest'), { id: 'manifest', status: 'failed' });
      assert.deepEqual(d.data.checks.find((c) => c.id === 'server'), { id: 'server', status: 'skipped' });
      assert.deepEqual(d.data.problems.map((x) => [x.check, x.file]), [['manifest', 'revition.json']]);
    } finally {
      p.close();
    }
  });
});
