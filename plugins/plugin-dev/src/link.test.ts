import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { dirs, err, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

async function platform() {
  return startMockPlatform((method, path) => {
    if (method === 'GET' && path === '/dev/apps') return ok({ apps: [{ appId: 'dapp_mine', manifestRef: 'plugin://m@0.1.0', manifest: {}, declaredScopes: [], createdAt: 'x' }] });
    if (method === 'GET' && path === '/dev/projects/dproj_mine') return ok({ projectId: 'dproj_mine', name: 'm', starterId: null, version: 3 });
    if (method === 'GET' && path.startsWith('/dev/projects/')) return err(404, 'AGENT_NOT_FOUND', 'not found');
    return null;
  });
}

describe('T2.1.1 link', () => {
  it('[CLI-T2.1.1-AC3] link to an app you do not own: exit 4 and nothing is written', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'link-'));
      const r = await runCli(['link', '--app', 'dapp_someone_else'], { cwd, host: p.host, env: await dirs() });
      assert.equal(r.code, 4, r.stderr);
      assert.match(r.stderr, /not one of your apps/);
      assert.equal(existsSync(join(cwd, '.revition')), false);
      // only reads: no server write
      assert.deepEqual([...new Set(p.log.map((x) => x.method))], ['GET']);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.1-AC3] a foreign or unknown cloud project: exit 4, nothing written; your own app and project link', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'link-'));
      const env = await dirs();
      const foreign = await runCli(['link', '--project', 'dproj_other'], { cwd, host: p.host, env });
      assert.equal(foreign.code, 4, foreign.stderr);
      assert.equal(existsSync(join(cwd, '.revition')), false);
      const mine = await runCli(['link', '--app', 'dapp_mine', '--project', 'dproj_mine'], { cwd, host: p.host, env });
      assert.equal(mine.code, 0, mine.stderr);
      assert.deepEqual(JSON.parse(readFileSync(join(cwd, '.revition', 'project.json'), 'utf8')), { schemaVersion: 1, appId: 'dapp_mine', projectId: 'dproj_mine' });
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.1-AC3] an existing link is replaced only after confirmation (--yes off a terminal)', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'link-'));
      await mkdir(join(cwd, '.revition'));
      await writeFile(join(cwd, '.revition', 'project.json'), JSON.stringify({ schemaVersion: 1, appId: 'dapp_old', projectId: null }));
      const env = await dirs();
      const r = await runCli(['link', '--app', 'dapp_mine'], { cwd, host: p.host, env });
      assert.equal(r.code, 2);
      assert.equal(JSON.parse(readFileSync(join(cwd, '.revition', 'project.json'), 'utf8')).appId, 'dapp_old');
      assert.equal((await runCli(['link', '--app', 'dapp_mine', '--yes'], { cwd, host: p.host, env })).code, 0);
      assert.equal(JSON.parse(readFileSync(join(cwd, '.revition', 'project.json'), 'utf8')).appId, 'dapp_mine');
    } finally {
      p.close();
    }
  });
});
