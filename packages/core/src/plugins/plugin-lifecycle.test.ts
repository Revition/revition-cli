import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';

import { RevitionCliError } from '../errors/cli-error.js';

import { listInstalled, unpackTarball } from './install.js';
import {
  installPlugin,
  parseSpec,
  removePlugin,
  runInstalledPlugin,
  type PluginIndex,
  type PluginIndexEntry,
} from './lifecycle.js';
import { sri512, type PublisherDirectory, type PublisherStatus, type VerifiedPlugin, type verifyPlugin } from './verify.js';

/**
 * T4.2.3 (REVITION-CLI-PLAN.md:3119-3135): search -> install -> use -> remove through the real lifecycle (real unpack,
 * real install folder, real sandboxed run), the org allowlist enforced at install and at every run, and a revoked
 * publisher's plugin disabled on its next run. The package is built here as a real gzipped ustar tarball; its Sigstore
 * verification is proven on a real published package in plugin-verify.test.ts, so this file passes a verifier that
 * returns the package as verified.
 */

function tarEntry(name: string, body: Buffer, type = '0'): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write('0000644\0', 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

function tgz(files: Record<string, string>, extra: Buffer[] = []): Buffer {
  const parts = Object.entries(files).map(([p, c]) => tarEntry(`package/${p}`, Buffer.from(c)));
  return gzipSync(Buffer.concat([...parts, ...extra, Buffer.alloc(1024)]));
}

const NAME = '@acme/revition-plugin-hello';
const PUBLISHER = 'github.com:acme/revition-plugin-hello';
const HELLO = `export async function run(ctx) {
  const r = await ctx.api.request('GET', '/dev/apps');
  ctx.print('hello ' + ctx.argv.join(' ') + ' apps=' + r.body.apps.length);
  try { await ctx.api.request('POST', '/dev/apps-seen', { n: r.body.apps.length }); } catch (e) { ctx.print('write refused: ' + e.code); }
  return 0;
}`;
const PACKAGE = tgz({
  'package.json': JSON.stringify({ name: NAME, version: '1.0.0', type: 'module' }),
  'revition-plugin.json': JSON.stringify({ schemaVersion: 1, commands: { hello: { entry: 'dist/hello.mjs', summary: 'Say hello' } }, permissions: ['api:apps:read', 'exec:none', 'network:none'] }),
  'dist/hello.mjs': HELLO,
});

function world(o: { allowed?: boolean; status?: PublisherStatus } = {}): {
  index: PluginIndex;
  publishers: PublisherDirectory;
  state: { allowed: boolean; status: PublisherStatus };
} {
  const state = { allowed: o.allowed ?? true, status: o.status ?? ('registered' as PublisherStatus) };
  const entry = (): PluginIndexEntry => ({ name: NAME, publisherId: PUBLISHER, publisherName: 'Acme', summary: 'Say hello', allowed: state.allowed });
  return {
    state,
    index: {
      search: async (q) => (`${NAME} say hello`.includes(q.toLowerCase()) && state.status === 'registered' ? [entry()] : []),
      lookup: async (n) => (n === NAME && state.status === 'registered' ? entry() : null),
    },
    publishers: { status: async (id) => (id === PUBLISHER ? state.status : 'unknown') },
  };
}

const verified: typeof verifyPlugin = async (spec) => {
  const v: VerifiedPlugin = { name: spec.name, version: '1.0.0', integrity: sri512(PACKAGE), publisherId: PUBLISHER, builtBy: 'https://github.com/acme/revition-plugin-hello/.github/workflows/release.yml@refs/tags/v1.0.0', tarball: PACKAGE };
  return v;
};

function dirs(): { configDir: string; projectRoot: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-life-')));
  const configDir = join(base, 'config');
  const projectRoot = join(base, 'project');
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(join(projectRoot, 'x.txt'), 'x');
  return { configDir, projectRoot };
}

const noRegistry = {} as never;

describe('T4.2.3 plugin allowlist / registry + install UX', () => {
  it('[CLI-T4.2.3-AC1] search -> install (permissions shown first) -> use -> remove', async () => {
    const w = world();
    const d = dirs();
    assert.deepEqual((await w.index.search('hello')).map((p) => p.name), [NAME]);
    const shown: string[][] = [];
    const rec = await installPlugin(NAME, {
      registry: noRegistry,
      index: w.index,
      publishers: w.publishers,
      configDir: d.configDir,
      verify: verified,
      confirm: async (p) => {
        shown.push([...p.permissions]);
        return true;
      },
      nowIso: () => '2026-11-19T00:00:00.000Z',
    });
    assert.deepEqual(shown, [['Read your apps through the Revition API (as you; it never sees your sign-in)']]);
    assert.equal(rec.publisherId, PUBLISHER);
    assert.deepEqual((await listInstalled(d.configDir)).map((p) => [p.name, p.version]), [[NAME, '1.0.0']]);

    const calls: { method: string; path: string; body?: unknown }[] = [];
    const exit = await runInstalledPlugin(NAME, 'hello', ['world'], {
      index: w.index,
      publishers: w.publishers,
      configDir: d.configDir,
      projectRoot: d.projectRoot,
      api: async (c) => {
        calls.push(c);
        return { status: 200, body: c.path === '/dev/apps' ? { apps: [{ id: 'a' }, { id: 'b' }] } : {} };
      },
    });
    assert.equal(exit, 0);
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ['GET /dev/apps'], 'the undeclared write never reached the API');

    assert.equal(await removePlugin(NAME, d.configDir), true);
    assert.deepEqual(await listInstalled(d.configDir), []);
    assert.equal(existsSync(join(d.configDir, 'plugins', '@acme__revition-plugin-hello')), false);
  });

  it('[CLI-T4.2.3-AC2] an org-disallowed plugin is refused at install', async () => {
    const w = world({ allowed: false });
    const d = dirs();
    await assert.rejects(
      installPlugin(NAME, { registry: noRegistry, index: w.index, publishers: w.publishers, configDir: d.configDir, verify: verified, confirm: async () => true, nowIso: () => 'x' }),
      (e: unknown) => e instanceof RevitionCliError && e.error.code === 'PLUGIN_NOT_ALLOWED' && e.exitCode === 4
    );
    assert.deepEqual(await listInstalled(d.configDir), []);
  });

  it('[CLI-T4.2.3-AC2] a plugin the org disallows AFTER install is refused on its next run (org policy wins)', async () => {
    const w = world();
    const d = dirs();
    await installPlugin(NAME, { registry: noRegistry, index: w.index, publishers: w.publishers, configDir: d.configDir, verify: verified, confirm: async () => true, nowIso: () => 'x' });
    w.state.allowed = false;
    let reached = false;
    await assert.rejects(
      runInstalledPlugin(NAME, 'hello', [], {
        index: w.index,
        publishers: w.publishers,
        configDir: d.configDir,
        projectRoot: d.projectRoot,
        api: async () => {
          reached = true;
          return { status: 200, body: {} };
        },
      }),
      (e: unknown) => e instanceof RevitionCliError && e.error.code === 'PLUGIN_NOT_ALLOWED'
    );
    assert.equal(reached, false, 'the plugin never started');
  });

  it('[CLI-T4.2.3-AC2] edge :3090 - a revoked publisher disables the installed plugin on the next run, with a message', async () => {
    const w = world();
    const d = dirs();
    await installPlugin(NAME, { registry: noRegistry, index: w.index, publishers: w.publishers, configDir: d.configDir, verify: verified, confirm: async () => true, nowIso: () => 'x' });
    w.state.status = 'revoked';
    await assert.rejects(
      runInstalledPlugin(NAME, 'hello', [], { index: w.index, publishers: w.publishers, configDir: d.configDir, projectRoot: d.projectRoot, api: async () => ({ status: 200, body: {} }) }),
      (e: unknown) => e instanceof RevitionCliError && e.error.code === 'PLUGIN_PUBLISHER_REVOKED' && /disabled/u.test(e.error.message)
    );
  });

  it('[CLI-T4.2.3-AC1] a declined permission prompt installs nothing; a provenance publisher that differs from the listing is refused', async () => {
    const w = world();
    const d = dirs();
    await assert.rejects(
      installPlugin(NAME, { registry: noRegistry, index: w.index, publishers: w.publishers, configDir: d.configDir, verify: verified, confirm: async () => false, nowIso: () => 'x' }),
      (e: unknown) => e instanceof RevitionCliError && e.error.code === 'CANCELLED'
    );
    assert.deepEqual(await listInstalled(d.configDir), []);
    const other: typeof verifyPlugin = async (s) => ({ ...(await verified(s, { registry: noRegistry, publishers: w.publishers })), publisherId: 'github.com:mallory/hello' });
    await assert.rejects(
      installPlugin(NAME, { registry: noRegistry, index: w.index, publishers: w.publishers, configDir: d.configDir, verify: other, confirm: async () => true, nowIso: () => 'x' }),
      (e: unknown) => e instanceof RevitionCliError && e.error.code === 'PLUGIN_PROVENANCE_INVALID'
    );
  });

  it('[CLI-T4.2.3-AC1] the package unpacker refuses links and escaping paths; specs parse name@version', () => {
    assert.throws(() => unpackTarball(tgz({ 'package.json': '{}' }, [tarEntry('package/evil', Buffer.from(''), '2')])), /link or special file/u);
    assert.throws(() => unpackTarball(tgz({ '../../etc/x': 'x' })), /leaves the package/u);
    assert.deepEqual(parseSpec('@acme/x@1.2.3'), { name: '@acme/x', range: '1.2.3' });
    assert.deepEqual(parseSpec('plain'), { name: 'plain', range: 'latest' });
    assert.throws(() => parseSpec('@acme/x@^1.0.0'), /exact version/u);
  });
});
