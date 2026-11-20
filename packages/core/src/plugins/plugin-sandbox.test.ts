import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { describePermissions, parseManifest, type PluginManifest } from './manifest.js';
import { apiRefusal, runPluginCommand, sandboxArgs, sandboxEnv, type ApiCall } from './sandboxed-context.js';

/**
 * T4.2.2 (REVITION-CLI-PLAN.md:3094-3117). Every case runs a REAL plugin command in the REAL sandbox (a child Node process
 * under the permission model). The plugin reports what it could and could not do through its one declared permission
 * (`api:probe:write`), which the test's fake API records - so the results come from inside the sandbox.
 */
const PROBE = String.raw`
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tryIt = (fn) => { try { const v = fn(); return { ok: true, v: typeof v === 'string' ? v.slice(0, 40) : String(v) }; } catch (e) { return { ok: false, code: e.code ?? e.name, msg: String(e.message).slice(0, 120) }; } };
const tryAsync = async (fn) => { try { const v = await fn(); return { ok: true, v: String(v).slice(0, 40) }; } catch (e) { return { ok: false, code: e.code ?? e.name }; } };
export async function run(ctx) {
  const [credFile, addonFile, projectFile] = ctx.argv;
  const report = {
    credStore: tryIt(() => readFileSync(credFile, 'utf8')),
    keychainAddon: tryIt(() => { const m = { exports: {} }; process.dlopen(m, addonFile); return 'loaded'; }),
    envKeys: Object.keys(process.env).sort(),
    ctxKeys: Object.keys(ctx).sort(),
    directProjectRead: tryIt(() => readFileSync(projectFile, 'utf8')),
    ctxProjectRead: await tryAsync(() => ctx.fs.readFile('notes.txt')),
    ctxProjectWrite: await tryAsync(() => ctx.fs.writeFile('out.txt', 'x')),
    directExec: tryIt(() => { const r = spawnSync('ls', ['/']); if (r.error) throw r.error; return 'ran'; }),
    ctxExec: tryIt(() => ctx.exec.run('ls', ['/'])),
    undeclaredApi: await tryAsync(() => ctx.api.request('GET', '/dev/apps')),
  };
  await ctx.api.request('POST', '/dev/probe', report);
  return 0;
}
`;

function setup(permissions: string[]): { pluginDir: string; projectRoot: string; manifest: PluginManifest; credFile: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-sbx-')));
  const pluginDir = join(base, 'plugins', 'acme__probe');
  const projectRoot = join(base, 'project');
  const stateDir = join(base, 'state', 'revition');
  for (const d of [join(pluginDir, 'dist'), projectRoot, stateDir]) mkdirSync(d, { recursive: true });
  writeFileSync(join(pluginDir, 'dist', 'probe.mjs'), PROBE);
  writeFileSync(join(projectRoot, 'notes.txt'), 'project notes\n');
  const credFile = join(stateDir, 'credentials.enc');
  writeFileSync(credFile, 'rvs_SECRET_SESSION_TOKEN');
  const manifest = parseManifest(JSON.stringify({ schemaVersion: 1, commands: { probe: { entry: 'dist/probe.mjs', summary: 'probe' } }, permissions }));
  return { pluginDir, projectRoot, manifest, credFile };
}

function keychainAddonPath(): string {
  const req = createRequire(import.meta.url);
  const dir = dirname(req.resolve('@napi-rs/keyring/package.json'));
  const nm = join(dir, '..', '..');
  for (const scope of [join(nm, '@napi-rs')]) {
    for (const d of readdirSync(scope)) {
      if (!d.startsWith('keyring-')) continue;
      const f = readdirSync(join(scope, d)).find((x) => x.endsWith('.node'));
      if (f !== undefined) return join(scope, d, f);
    }
  }
  return join(dir, 'keyring.node');
}

interface Report {
  credStore: { ok: boolean; code?: string };
  keychainAddon: { ok: boolean; code?: string };
  envKeys: string[];
  ctxKeys: string[];
  directProjectRead: { ok: boolean; code?: string };
  ctxProjectRead: { ok: boolean; code?: string; v?: string };
  ctxProjectWrite: { ok: boolean; code?: string };
  directExec: { ok: boolean; code?: string };
  ctxExec: { ok: boolean; code?: string };
  undeclaredApi: { ok: boolean; code?: string };
}

async function probe(permissions: string[]): Promise<{ report: Report; calls: ApiCall[]; exit: number }> {
  const s = setup(['api:probe:write', ...permissions]);
  const calls: ApiCall[] = [];
  const exit = await runPluginCommand(
    { pluginDir: s.pluginDir, manifest: s.manifest, command: 'probe', argv: [s.credFile, keychainAddonPath(), join(s.projectRoot, 'notes.txt')], projectRoot: s.projectRoot },
    {
      api: async (c) => {
        calls.push(c);
        return { status: 200, body: { ok: true } };
      },
      env: { ...process.env, REVITION_TOKEN: 'rvt_PARENT_TOKEN', HOME: '/Users/someone', REVITION_PROFILE: 'default' },
    }
  );
  const posted = calls.find((c) => c.path === '/dev/probe');
  assert.ok(posted, 'the plugin reported back');
  return { report: posted.body as Report, calls, exit };
}

describe('T4.2.2 plugin permission manifest + enforcement', () => {
  it('[CLI-T4.2.2-AC1] a plugin cannot read the credential store, cannot load the keychain addon, and gets no token', async () => {
    const { report, exit } = await probe([]);
    assert.equal(exit, 0);
    assert.equal(report.credStore.ok, false);
    assert.equal(report.credStore.code, 'ERR_ACCESS_DENIED', 'the credential file is outside the plugin sandbox');
    assert.equal(report.keychainAddon.ok, false, 'native addons are not allowed, so the keychain binding cannot load');
    assert.ok(!report.envKeys.includes('REVITION_TOKEN'), 'the parent token never reaches the plugin');
    assert.ok(!report.envKeys.includes('HOME'));
    assert.ok(!report.envKeys.some((k) => k.startsWith('REVITION_')), `env: ${report.envKeys.join(',')}`);
    assert.deepEqual(report.ctxKeys, ['api', 'argv', 'exec', 'fs', 'print'], 'the context carries capabilities, never a credential');
  });

  it('[CLI-T4.2.3-AC1] a plugin reached through a symlinked folder still runs, and is still sandboxed', async () => {
    // Found by the T4.2.3 live leg (2026-11-20): a config folder under a symlink (macOS /var -> /private/var, a
    // symlinked home or XDG folder) made Node deny the plugin its OWN files (ERR_ACCESS_DENIED, exit 4).
    const s = setup(['api:probe:write']);
    const link = join(realpathSync(mkdtempSync(join(tmpdir(), 'plugin-link-'))), 'linked');
    symlinkSync(dirname(dirname(s.pluginDir)), link, 'dir');
    const calls: ApiCall[] = [];
    const exit = await runPluginCommand(
      {
        pluginDir: join(link, 'plugins', 'acme__probe'),
        manifest: s.manifest,
        command: 'probe',
        argv: [s.credFile, keychainAddonPath(), join(s.projectRoot, 'notes.txt')],
        projectRoot: join(link, 'project'),
      },
      { api: async (c) => (calls.push(c), { status: 200, body: { ok: true } }), env: { ...process.env } }
    );
    assert.equal(exit, 0, 'the plugin ran through the symlinked path');
    const posted = calls.find((c) => c.path === '/dev/probe');
    assert.ok(posted, 'the plugin read its own entry and reported back');
    assert.equal((posted.body as Report).credStore.code, 'ERR_ACCESS_DENIED', 'still nothing outside its own folder');
  });

  it('[CLI-T4.2.2-AC2] undeclared file access is refused (by the context AND by the runtime)', async () => {
    const { report } = await probe([]);
    assert.equal(report.ctxProjectRead.ok, false);
    assert.equal(report.ctxProjectRead.code, 'PLUGIN_PERMISSION_DENIED');
    assert.equal(report.directProjectRead.code, 'ERR_ACCESS_DENIED', 'bypassing the context does not help');
    assert.equal(report.ctxProjectWrite.code, 'PLUGIN_PERMISSION_DENIED');
  });

  it('[CLI-T4.2.2-AC2] undeclared process execution is refused (by the context AND by the runtime)', async () => {
    const { report } = await probe([]);
    assert.equal(report.ctxExec.ok, false);
    assert.equal(report.ctxExec.code, 'PLUGIN_PERMISSION_DENIED');
    assert.equal(report.directExec.ok, false);
    assert.equal(report.directExec.code, 'ERR_ACCESS_DENIED', 'child_process is denied without a declared exec permission');
  });

  it('[CLI-T4.2.2-AC2] a declared fs:project:read reads project files, and still nothing outside the project', async () => {
    const { report } = await probe(['fs:project:read']);
    assert.equal(report.ctxProjectRead.ok, true);
    assert.equal(report.ctxProjectRead.v, 'project notes\n');
    assert.equal(report.directProjectRead.ok, true);
    assert.equal(report.credStore.code, 'ERR_ACCESS_DENIED');
    assert.equal(report.ctxProjectWrite.code, 'PLUGIN_PERMISSION_DENIED', 'read does not imply write');
  });

  it('[CLI-T4.2.2-AC1] API calls go through core with its credential; an undeclared resource is refused by core', async () => {
    const { report, calls } = await probe([]);
    assert.equal(report.undeclaredApi.code, 'PLUGIN_PERMISSION_DENIED');
    assert.ok(!calls.some((c) => c.path === '/dev/apps'), 'the refused call never reached the API');
    const m = parseManifest(JSON.stringify({ schemaVersion: 1, commands: { x: { entry: 'a.js', summary: 's' } }, permissions: ['api:apps:read'] }));
    assert.equal(apiRefusal(m, { method: 'GET', path: '/dev/apps' }), null);
    assert.match(apiRefusal(m, { method: 'POST', path: '/dev/apps' }) ?? '', /api:apps:write/u);
    assert.match(apiRefusal(m, { method: 'GET', path: '/dev/apps/../cli/sessions' }) ?? '', /not a Dev API path/u);
    assert.match(apiRefusal(m, { method: 'GET', path: '/settings/cli-policy' }) ?? '', /not a Dev API path/u);
  });

  it('[CLI-T4.2.2-AC1] the sandbox never grants addons, workers or WASI, and grants nothing undeclared', () => {
    const s = setup([]);
    const args = sandboxArgs({ pluginDir: s.pluginDir, manifest: s.manifest, command: 'probe', argv: [], projectRoot: s.projectRoot });
    assert.ok(args[0] === '--permission' || args[0] === '--experimental-permission');
    for (const forbidden of ['--allow-addons', '--allow-worker', '--allow-wasi', '--allow-child-process', '--allow-fs-write']) {
      assert.ok(!args.some((a) => a.startsWith(forbidden)), forbidden);
    }
    assert.deepEqual(args.filter((a) => a.startsWith('--allow-fs-read=')), [`--allow-fs-read=${s.pluginDir}`]);
    const env = sandboxEnv({ pluginDir: s.pluginDir, manifest: s.manifest, command: 'probe', argv: [], projectRoot: s.projectRoot }, { REVITION_TOKEN: 'x', PATH: '/bin', HOME: '/h' });
    assert.deepEqual(Object.keys(env), ['REVITION_PLUGIN_HOST']);
  });

  it('[CLI-T4.2.2-AC3] the install prompt lists every declared permission in plain words', () => {
    const m = parseManifest(
      JSON.stringify({ schemaVersion: 1, commands: { x: { entry: 'dist/x.js', summary: 's' } }, permissions: ['api:apps:read', 'fs:project:read', 'exec:none', 'network:none'] })
    );
    assert.deepEqual(describePermissions(m), [
      'Read your apps through the Revition API (as you; it never sees your sign-in)',
      'Read files in the current project folder',
    ]);
  });

  it('[CLI-T4.2.2-AC2] an unknown permission or a path-escaping entry is refused at install', () => {
    const mk = (o: object): string => JSON.stringify({ schemaVersion: 1, commands: { x: { entry: 'dist/x.js', summary: 's' } }, permissions: [], ...o });
    assert.throws(() => parseManifest(mk({ permissions: ['fs:home:read'] })), /unknown permission/u);
    assert.throws(() => parseManifest(mk({ permissions: ['exec:none', 'exec:git'] })), /cannot be combined/u);
    assert.throws(() => parseManifest(mk({ commands: { x: { entry: '../../etc/x.js', summary: 's' } } })), /relative .js path/u);
    assert.throws(() => parseManifest(mk({ commands: { x: { entry: '/abs/x.js', summary: 's' } } })), /relative .js path/u);
    assert.throws(() => parseManifest(mk({ extra: true })), /unknown field/u);
  });
});
