import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { ignoreMatcher, secretIn, uploadSet } from './dev/uploader.js';
import { interruptible, pressCtrlC } from './test-fixtures/ctrl-c.js';
import { CLI_BIN, PAT, dirs, err, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

const FILES: Record<string, string> = {
  'revition.json': '{"summary":"Hello","capabilities":[{"id":"hello","name":"Hello","language":"ts","entrypoint":"run"}]}\n',
  'capabilities/hello/run.ts': 'export async function run(i) { return i; }\n',
  'capabilities/hello/tests.json': '[{"name":"echo","input":1,"expect":1}]\n',
};

async function linkedProject(extra: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dev-'));
  for (const [f, text] of Object.entries({ ...FILES, ...extra, '.revition/project.json': JSON.stringify({ schemaVersion: 1, appId: null, projectId: 'dproj_1' }) })) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

function platform(opts: { conflict?: boolean } = {}): Promise<MockPlatform> {
  let version = 3;
  return startMockPlatform((method, path, body) => {
    if (method === 'GET' && path === '/dev/projects/dproj_1') return ok({ projectId: 'dproj_1', version, files: FILES });
    if (method === 'POST' && path === '/dev/projects/dproj_1/sandbox') return ok({ sessionId: 'dsbx_1', projectId: 'dproj_1', tier: 'dev', provider: 'mock', expiresAt: '2026-11-18T12:20:00Z', resumed: false });
    if (method === 'PUT' && path === '/dev/projects/dproj_1/files') {
      if (opts.conflict === true || (body as { baseVersion: number }).baseVersion !== version) return err(409, 'AGENT_STATE_CONFLICT', 'the project changed since you opened it');
      version += 1;
      return ok({ projectId: 'dproj_1', version });
    }
    if (method === 'POST' && path === '/dev/projects/dproj_1/sandbox/run') return ok({ ok: true, output: { echoed: (body as { input: unknown }).input }, logs: [], wallMs: 12 });
    if (method === 'DELETE' && path === '/dev/projects/dproj_1/sandbox') return ok({ disposed: true });
    return null;
  });
}

describe('T2.1.4 dev --sandbox', () => {
  it('[CLI-T2.1.4-AC2] connect -> save (full file set, from the project version) -> run -> result printed -> sandbox deleted', async () => {
    const p = await platform();
    try {
      const dir = await linkedProject();
      const r = await runCli(['dev', '--sandbox', '--run', 'hello', '--input', '{"n":1}', '--once', '--yes', '--json'], { cwd: dir, host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      const data = JSON.parse(r.stdout).data as { cycles: Array<{ version: number; result: { output: unknown } }>; disposed: boolean };
      assert.deepEqual(data.cycles[0]?.result.output, { echoed: { n: 1 } });
      assert.equal(data.cycles[0]?.version, 4);
      assert.equal(data.disposed, true);
      assert.deepEqual(p.log.map((x) => `${x.method} ${x.path}`), [
        'GET /dev/projects/dproj_1',
        'POST /dev/projects/dproj_1/sandbox',
        'PUT /dev/projects/dproj_1/files',
        'POST /dev/projects/dproj_1/sandbox/run',
        'DELETE /dev/projects/dproj_1/sandbox',
      ]);
      assert.deepEqual(p.log[2]?.body, { files: FILES, baseVersion: 3 });
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.4-AC2] the loop re-runs on save, and Ctrl-C deletes the sandbox (exit 11)', async () => {
    const p = await platform();
    try {
      const dir = await linkedProject();
      const env = { ...process.env, ...(await dirs()), NO_COLOR: '1', REVITION_NO_UPDATE_CHECK: '1', REVITION_HOST: p.host, REVITION_TOKEN: PAT };
      const child = spawn(process.execPath, [CLI_BIN, 'dev', '--sandbox', '--run', 'hello', '--yes'], interruptible({ cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] }));
      let stderr = '';
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      const until = async (re: RegExp, ms = 15_000): Promise<void> => {
        const end = Date.now() + ms;
        while (!re.test(stderr) && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
        assert.match(stderr, re);
      };
      await until(/saved version 4/);
      writeFileSync(join(dir, 'capabilities/hello/run.ts'), 'export async function run(i) { return [i]; }\n');
      await until(/saved version 5/);
      const exited = new Promise<number | null>((r) => child.on('close', (c) => r(c)));
      pressCtrlC(child);
      assert.equal(await exited, 11);
      assert.equal(p.log.filter((x) => x.method === 'PUT').length, 2, 'one save per change');
      assert.equal(p.log.at(-1)?.method, 'DELETE');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.4-AC3] a file holding a fake rvt_ token is refused for upload: nothing is sent', async () => {
    const p = await platform();
    try {
      const dir = await linkedProject({ 'capabilities/hello/config.ts': `export const token = "rvt_${'A'.repeat(40)}";\n` });
      const r = await runCli(['dev', '--sandbox', '--once', '--yes'], { cwd: dir, host: p.host, env: await dirs() });
      assert.equal(r.code, 2, r.stderr);
      assert.match(r.stderr, /Not uploaded: capabilities\/hello\/config\.ts contains what looks like a secret/);
      assert.equal(p.log.filter((x) => x.method === 'PUT').length, 0);
      assert.equal(p.log.filter((x) => x.path.endsWith('/sandbox')).length, 0, 'no metered sandbox was opened for a refused upload');
      assert.doesNotMatch(r.stderr, /rvt_A{10}/, 'the token itself is never printed');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.4-AC3] key files, ignored files and .revition/ never upload; secret shapes are detected', () => {
    const all = { ...FILES, 'server.pem': 'x', 'keys/id_rsa': 'x', 'notes/draft.md': 'x', 'build/out.js': 'x' };
    const up = uploadSet(all, (p) => [ignoreMatcher('notes/'), ignoreMatcher('*.js')].some((m) => m?.(p) === true));
    assert.deepEqual(Object.keys(up.files).sort(), Object.keys(FILES).sort());
    assert.deepEqual([...up.excluded].sort(), ['build/out.js', 'keys/id_rsa', 'notes/draft.md', 'server.pem']);
    assert.equal(secretIn('-----BEGIN RSA PRIVATE KEY-----\nabc'), true);
    assert.equal(secretIn(`Bearer eyJ${'a'.repeat(12)}.${'b'.repeat(12)}.${'c'.repeat(12)}`), true);
    assert.equal(secretIn('const x = 1;'), false);
  });

  it('[CLI-T2.1.4-AC4] a concurrent save elsewhere: the reload message, exit 6, and nothing is overwritten', async () => {
    const p = await platform({ conflict: true });
    try {
      const dir = await linkedProject();
      const r = await runCli(['dev', '--sandbox', '--once', '--yes'], { cwd: dir, host: p.host, env: await dirs() });
      assert.equal(r.code, 6, r.stderr);
      assert.match(r.stderr, /Another editor saved this project since you started: nothing was overwritten/);
      assert.match(r.stderr, /revition dev --pull/);
      assert.equal(p.log.filter((x) => x.method === 'PUT').length, 1, 'no retry that could overwrite');
      assert.equal(p.log.at(-1)?.method, 'DELETE', 'the sandbox is still released');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.4-AC1] dev --local runs the project tests with the T2.1.3 engine: no platform call, nothing uploaded', async () => {
    // Nothing listens on the host: any platform call would fail the run.
    const r = await runCli(['dev', '--local', '--once', '--yes', '--json'], { cwd: await linkedProject(), host: '127.0.0.1:9', env: await dirs() });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout) as { data: { projectId: string; session: null; cycles: { uploaded: number; result: { passed: number; failed: number } }[] } };
    assert.equal(out.data.projectId, 'local');
    assert.equal(out.data.session, null);
    assert.deepEqual(out.data.cycles.map((c) => [c.uploaded, c.result.passed, c.result.failed]), [[0, 1, 0]]);
    const both = await runCli(['dev', '--local', '--sandbox', '--yes'], { cwd: await linkedProject(), host: '127.0.0.1:9', env: await dirs() });
    assert.equal(both.code, 2);
  });

  it('[CLI-T2.1.4-AC1] a local loop re-runs on save, until Ctrl-C', async () => {
    const dir = await linkedProject();
    const child = spawn(process.execPath, [CLI_BIN, 'dev', '--local', '--yes'], interruptible({
      cwd: dir,
      env: { ...process.env, ...(await dirs()), NO_COLOR: '1', REVITION_NO_UPDATE_CHECK: '1', REVITION_HOST: '127.0.0.1:9', REVITION_TOKEN: PAT },
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const until = async (re: RegExp): Promise<void> => {
      for (let i = 0; i < 100 && !re.test(err); i++) await new Promise((r) => setTimeout(r, 100));
      assert.match(err, re);
    };
    await until(/PASS hello: echo/);
    writeFileSync(join(dir, 'capabilities/hello/run.ts'), 'export async function run(i) { return [i]; }\n');
    await until(/--- saved \(local run 2\) ---[\s\S]*FAIL hello: echo/);
    const exited = new Promise<number | null>((r) => child.on('close', (c) => r(c)));
    pressCtrlC(child);
    assert.equal(await exited, 11);
  });
});
