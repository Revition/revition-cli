import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { dirs, err, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

const APP = { appId: 'dapp_mine', developerId: 'auth0|d', manifestRef: 'plugin://order-sync@0.1.0', manifest: { pluginId: 'order-sync' }, declaredScopes: ['source:orders'], keyRefs: [], createdAt: '2026-11-18T10:00:00Z' };

async function platform() {
  let app = { ...APP };
  return startMockPlatform((method, path, body) => {
    if (method === 'GET' && path === '/dev/apps') return ok({ apps: [app] });
    if (method === 'POST' && path === '/dev/apps') return ok({ ...APP, appId: 'dapp_new', manifest: (body as { manifest: unknown }).manifest, declaredScopes: (body as { scopes: string[] }).scopes });
    if (method === 'PUT' && path === '/dev/apps/dapp_mine/scopes') {
      const b = body as { scopes: string[]; consent: boolean };
      const added = b.scopes.filter((s) => !app.declaredScopes.includes(s));
      if (added.length > 0 && !b.consent) return err(403, 'AGENT_CONSENT_REQUIRED', 'widening needs consent');
      app = { ...app, declaredScopes: b.scopes };
      return ok({ app, revokedKeys: added.length > 0 ? ['k1'] : [] });
    }
    if (method === 'GET' && path === '/dev/apps/dapp_mine/listing') return ok({ appId: 'dapp_mine', status: 'draft' });
    return null;
  });
}

describe('T2.2.1 apps', () => {
  it('[CLI-T2.2.1-AC1] create / list / view / listing; another developer\'s app is exit 4', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'apps-'));
      const env = await dirs();
      writeFileSync(join(cwd, 'm.json'), JSON.stringify({ pluginId: 'order-sync', brand: 'Order Sync', category: 'tools', description: 'x', version: '0.1.0', dataClasses: [] }));
      const created = await runCli(['apps', 'create', '--manifest', 'm.json', '--scopes', 'source:orders', '--yes', '--json'], { cwd, host: p.host, env });
      assert.equal(created.code, 0, created.stderr);
      assert.deepEqual(p.log.find((x) => x.method === 'POST')?.body, { manifest: JSON.parse('{"pluginId":"order-sync","brand":"Order Sync","category":"tools","description":"x","version":"0.1.0","dataClasses":[]}'), scopes: ['source:orders'] });
      assert.equal((await runCli(['apps', 'list', '--json'], { cwd, host: p.host, env })).code, 0);
      const view = await runCli(['apps', 'view', 'dapp_mine', '--json'], { cwd, host: p.host, env });
      assert.equal(JSON.parse(view.stdout).data.appId, 'dapp_mine');
      const other = await runCli(['apps', 'view', 'dapp_someone_else'], { cwd, host: p.host, env });
      assert.equal(other.code, 4);
      assert.equal(JSON.parse((await runCli(['apps', 'listing', 'dapp_mine', '--json'], { cwd, host: p.host, env })).stdout).data.status, 'draft');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.2.1-AC2] a scope widening shows the diff, then needs confirmation (--yes off a terminal); consent only after it', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'apps-'));
      const env = await dirs();
      const refused = await runCli(['apps', 'scopes', 'set', 'dapp_mine', '--scopes', 'source:orders,data.read:orders'], { cwd, host: p.host, env });
      assert.equal(refused.code, 2, refused.stderr);
      assert.match(refused.stderr, /Scopes of dapp_mine:\n {2}\+ data\.read:orders/);
      assert.match(refused.stderr, /re-issues every key/);
      assert.ok(refused.stderr.indexOf('+ data.read:orders') < refused.stderr.indexOf('needs confirmation'), 'the diff comes before the confirmation');
      assert.equal(p.log.filter((x) => x.method === 'PUT').length, 0, 'nothing changed without confirmation');
      const done = await runCli(['apps', 'scopes', 'set', 'dapp_mine', '--scopes', 'source:orders,data.read:orders', '--yes', '--json'], { cwd, host: p.host, env });
      assert.equal(done.code, 0, done.stderr);
      assert.deepEqual(p.log.find((x) => x.method === 'PUT')?.body, { scopes: ['data.read:orders', 'source:orders'], consent: true });
      const out = JSON.parse(done.stdout).data as { added: string[]; removed: string[]; revokedKeys: string[] };
      assert.deepEqual([out.added, out.removed, out.revokedKeys], [['data.read:orders'], [], ['k1']]);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.2.1-AC3] --json: one envelope per command with its schema id (list, view, scopes set)', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'apps-'));
      const env = await dirs();
      for (const args of [['apps', 'list'], ['apps', 'view', 'dapp_mine'], ['apps', 'scopes', 'set', 'dapp_mine', '--scopes', 'source:orders', '--yes']]) {
        const r = await runCli([...args, '--json'], { cwd, host: p.host, env });
        const doc = JSON.parse(r.stdout) as { schemaVersion: number; command: string; ok: boolean };
        assert.deepEqual([doc.schemaVersion, doc.ok], [1, true], args.join(' '));
        assert.equal(doc.command, args.filter((a) => !a.startsWith('-') && !a.startsWith('dapp_') && !a.includes(':')).join(':'));
      }
    } finally {
      p.close();
    }
  });
});
