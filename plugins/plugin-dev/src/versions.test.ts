import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { dirs, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

const SUBMISSIONS = [
  { submissionId: 'dsub_2', appId: 'dapp_mine', version: '1.2.0', state: 'published', projectId: 'p', projectVersion: 4, autoResults: {}, reviewNotes: [], history: [], createdAt: '2026-11-17T00:00:00.000Z', updatedAt: '2026-11-18T00:00:00.000Z' },
  { submissionId: 'dsub_1', appId: 'dapp_mine', version: '1.1.0', state: 'rejected', projectId: 'p', projectVersion: 3, autoResults: {}, reviewNotes: [], history: [], createdAt: '2026-11-16T00:00:00.000Z', updatedAt: '2026-11-16T00:00:00.000Z' },
];
const CHANNELS = {
  publisherOrgId: 'org_1',
  appId: 'dapp_mine',
  heads: { stable: { version: '1.2.0', at: '2026-11-18T00:00:00.000Z', by: 'auth0|owner' }, beta: { version: '1.3.0-rc', at: '2026-11-18T01:00:00.000Z', by: 'auth0|owner' } },
  history: [{ channel: 'stable', version: '1.2.0', at: '2026-11-18T00:00:00.000Z', by: 'auth0|owner' }],
  listed: ['1.2.0'],
};
const ROLLOUTS = [
  { publisherOrgId: 'org_1', appId: 'dapp_mine', channel: 'stable', version: '1.2.0', previous: '1.1.0', plan: { stages: [5, 25, 50, 100] }, stageIndex: 1, status: 'rolling', history: [] },
];

async function linked(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'versions-'));
  const f = join(dir, '.revition/project.json');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ schemaVersion: 1, appId: 'dapp_mine', projectId: 'dproj_1' }));
  return dir;
}

function platform(empty = false): Promise<MockPlatform> {
  return startMockPlatform((method, path) => {
    if (method === 'GET' && path === '/dev/apps/dapp_mine/submissions') return ok({ submissions: empty ? [] : SUBMISSIONS });
    if (method === 'GET' && path === '/release/apps/dapp_mine/channels') return ok(empty ? { ...CHANNELS, heads: {}, history: [], listed: [] } : CHANNELS);
    if (method === 'GET' && path === '/release/apps/dapp_mine/rollouts') return ok({ rollouts: empty ? [] : ROLLOUTS });
    return null;
  });
}

describe('T2.3.4 versions (read only; release changes in the portal)', () => {
  it('[CLI-T2.3.4-AC1] list / channels / rollouts show what the platform returns for the portal', async () => {
    const p = await platform();
    try {
      const cwd = await linked();
      const env = await dirs();
      const list = await runCli(['versions', 'list'], { cwd, host: p.host, env });
      assert.equal(list.code, 0, list.stderr);
      assert.match(list.stdout, /1\.2\.0.*published/);
      assert.match(list.stdout, /1\.1\.0.*rejected/);
      const ch = await runCli(['versions', 'channels'], { cwd, host: p.host, env });
      assert.match(ch.stdout, /stable.*1\.2\.0.*2026-11-18.*auth0\|owner/);
      assert.match(ch.stdout, /beta.*1\.3\.0-rc/);
      assert.match(ch.stdout, /listed: 1\.2\.0/);
      const ro = await runCli(['versions', 'rollouts'], { cwd, host: p.host, env });
      assert.match(ro.stdout, /stable.*1\.2\.0.*1\.1\.0.*25%.*rolling/);
      // Read only: every call was a GET.
      assert.deepEqual([...new Set(p.log.map((l) => l.method))], ['GET']);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.4-AC4] --json: one envelope per command with the platform data (schema ids revition.versions.*.v1)', async () => {
    const p = await platform();
    try {
      const cwd = await linked();
      const env = { ...(await dirs()), SSH_CONNECTION: 'test' };
      const shapes: [string[], (d: Record<string, unknown>) => void][] = [
        [['versions', 'list'], (d) => assert.deepEqual((d['versions'] as { version: string }[]).map((v) => v.version), ['1.2.0', '1.1.0'])],
        [['versions', 'channels'], (d) => assert.deepEqual(Object.keys(d['heads'] as object).sort(), ['beta', 'stable'])],
        [['versions', 'rollouts'], (d) => assert.equal((d['rollouts'] as { stageIndex: number }[])[0]?.stageIndex, 1)],
        [['versions', 'open', '--action', 'rollback'], (d) => assert.equal(d['action'], 'rollback')],
      ];
      for (const [argv, check] of shapes) {
        const r = await runCli([...argv, '--json'], { cwd, host: p.host, env });
        assert.equal(r.code, 0, r.stderr);
        const doc = JSON.parse(r.stdout) as { command: string; data: Record<string, unknown>; error: unknown };
        assert.equal(doc.command, `versions:${argv[1]}`);
        assert.equal(doc.error ?? null, null);
        assert.equal(doc.data['appId'], 'dapp_mine');
        check(doc.data);
      }
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.3.4-AC2] versions open --action rollback lands on the portal release page; nothing is called', async () => {
    const p = await platform();
    try {
      const env = { ...(await dirs()), SSH_CONNECTION: 'test' };
      const r = await runCli(['versions', 'open', '--action', 'rollback'], { cwd: await linked(), host: p.host, env });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /^Open https:\/\/app\.revition\.com\/foundry\/distribution to take the rollback for dapp_mine/);
      assert.deepEqual(p.log, []);
      const bad = await runCli(['versions', 'open', '--action', 'delete'], { cwd: await linked(), host: p.host, env });
      assert.equal(bad.code, 2);
    } finally {
      p.close();
    }
  });

  it('edge: an app with no releases yet: empty lists, exit 0', async () => {
    const p = await platform(true);
    try {
      const cwd = await linked();
      const env = await dirs();
      for (const sub of ['list', 'channels', 'rollouts']) {
        const r = await runCli(['versions', sub], { cwd, host: p.host, env });
        assert.equal(r.code, 0, r.stderr);
      }
    } finally {
      p.close();
    }
  });
});
