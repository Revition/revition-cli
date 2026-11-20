import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { unsafePath } from './project/write-starter.js';
import { dirs, err, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

const STARTERS: Record<string, Record<string, string>> = {
  'hello-tool': { 'revition.json': '{"summary":"Hello","capabilities":["hello"]}\n', 'capabilities/hello/index.ts': 'export async function run() { return 1; }\n', 'capabilities/hello/tests.json': '[]\n' },
  'nightly-job': { 'revition.json': '{"summary":"Nightly","capabilities":["nightly"]}\n', 'capabilities/nightly/main.py': 'def run(i):\n    return i\n' },
};

async function platform(extra: Record<string, Record<string, string>> = {}) {
  const all = { ...STARTERS, ...extra };
  return startMockPlatform((method, path) => {
    if (method === 'GET' && path === '/dev/starters') {
      return ok({ starters: Object.keys(STARTERS).map((id) => ({ id, title: id, extensionPoint: 'code_tool', language: 'ts' })) });
    }
    const m = /^\/dev\/starters\/([^/]+)$/.exec(path);
    if (method === 'GET' && m !== null) {
      const files = all[decodeURIComponent(m[1] ?? '')];
      return files === undefined ? err(404, 'AGENT_NOT_FOUND', 'no such starter') : ok({ id: m[1], title: `Starter ${m[1]}`, extensionPoint: 'code_tool', language: 'ts', files });
    }
    if (method === 'GET' && path === '/dev/apps') return ok({ apps: [{ appId: 'dapp_mine', manifestRef: 'plugin://mine@0.1.0', manifest: {}, declaredScopes: [], createdAt: 'x' }] });
    if (method === 'POST' && path === '/dev/apps') return ok({ appId: 'dapp_new', manifestRef: 'plugin://x@0.1.0', manifest: {}, declaredScopes: [], createdAt: 'x' });
    if (method === 'POST' && path === '/dev/projects') return { status: 201, body: { projectId: 'dproj_new', name: 'n', starterId: 'hello-tool', version: 1 } };
    return null;
  });
}

describe('T2.1.1 init', () => {
  it('[CLI-T2.1.1-AC1] init creates the project from each starter: the files, the link file and the ignore lines', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      for (const id of Object.keys(STARTERS)) {
        const cwd = await mkdtemp(join(tmpdir(), 'init-'));
        const r = await runCli(['init', `p-${id}`, '--starter', id, '--yes', '--json'], { cwd, host: p.host, env });
        assert.equal(r.code, 0, r.stderr);
        const dir = join(cwd, `p-${id}`);
        for (const [f, text] of Object.entries(STARTERS[id] ?? {})) assert.equal(readFileSync(join(dir, f), 'utf8'), text, `${id}: ${f}`);
        assert.deepEqual(JSON.parse(readFileSync(join(dir, '.revition', 'project.json'), 'utf8')), { schemaVersion: 1, appId: null, projectId: null });
        assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /^\.revition\/cache\n\.revition\/assist\/\n$/);
        assert.deepEqual((JSON.parse(r.stdout) as { data: { next: string[] } }).data.next, ['revition test', 'revition dev', 'revition eval']);
      }
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.1-AC1] --app new registers the app (manifest from the flags) and --project new creates the cloud project', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'init-'));
      const r = await runCli(['init', 'my-tool', '--starter', 'hello-tool', '--app', 'new', '--category', 'tools', '--description', 'Looks up orders', '--project', 'new', '--yes'], { cwd, host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      const app = p.log.find((x) => x.method === 'POST' && x.path === '/dev/apps');
      assert.deepEqual(app?.body, { manifest: { pluginId: 'my-tool', brand: 'my-tool', category: 'tools', description: 'Looks up orders', version: '0.1.0', dataClasses: [] }, scopes: [] });
      assert.deepEqual(p.log.find((x) => x.path === '/dev/projects')?.body, { name: 'my-tool', starterId: 'hello-tool' });
      assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'my-tool', '.revition', 'project.json'), 'utf8')), { schemaVersion: 1, appId: 'dapp_new', projectId: 'dproj_new' });
      const missing = await runCli(['init', 'x', '--starter', 'hello-tool', '--app', 'new', '--yes'], { cwd, host: p.host, env: await dirs() });
      assert.equal(missing.code, 2);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.1-AC2] a starter file named ../../x (or absolute) is rejected and nothing is written', async () => {
    const evil = { 'evil-dots': { 'revition.json': '{}\n', '../../x': 'pwned' }, 'evil-abs': { 'ok.txt': 'a', '/tmp/revition-evil-abs': 'pwned' }, 'evil-mid': { 'a/../../../y': 'pwned' } };
    const p = await platform(evil);
    try {
      for (const id of Object.keys(evil)) {
        const cwd = await mkdtemp(join(tmpdir(), 'init-'));
        const r = await runCli(['init', 'proj', '--starter', id, '--yes'], { cwd, host: p.host, env: await dirs() });
        assert.equal(r.code, 2, `${id}: ${r.stderr}`);
        assert.match(r.stderr, /outside the project/);
        assert.equal(existsSync(join(cwd, 'proj')), false, `${id}: nothing written`);
        assert.deepEqual(readdirSync(cwd), [], `${id}: nothing next to it either`);
      }
      assert.equal(existsSync('/tmp/revition-evil-abs'), false);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.1-AC2] the guard: absolute, drive, NUL and any .. segment are unsafe; plain relative paths are safe', () => {
    for (const bad of ['../x', '../../x', 'a/../../x', '/etc/passwd', 'C:\\x', 'a\0b', '', '.']) assert.equal(unsafePath('/p', bad), true, bad);
    for (const good of ['revition.json', 'capabilities/a/index.ts', 'ui/manifest.json']) assert.equal(unsafePath('/p', good), false, good);
  });

  it('[CLI-T2.1.1-AC1] a non-empty directory is refused unless --force, and an existing file is never overwritten', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'init-'));
      const env = await dirs();
      assert.equal((await runCli(['init', 'proj', '--starter', 'hello-tool', '--yes'], { cwd, host: p.host, env })).code, 0);
      const again = await runCli(['init', 'proj', '--starter', 'nightly-job', '--yes'], { cwd, host: p.host, env });
      assert.equal(again.code, 2);
      assert.match(again.stderr, /is not empty/);
      const clash = await runCli(['init', 'proj', '--starter', 'hello-tool', '--force', '--yes'], { cwd, host: p.host, env });
      assert.equal(clash.code, 2);
      assert.match(clash.stderr, /already has/);
    } finally {
      p.close();
    }
  });
});
