import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';

import { entryLines } from './commands/changelog.js';
import { docLines, searchLines } from './commands/docs.js';
import { OPEN_TARGETS, targetUrl } from './commands/open.js';
import { assertOpenable } from './commands/submissions/open.js';
import { dirs, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

const SDK = {
  version: '1.0.0',
  namespaces: [
    { name: 'knowledge', calls: [{ call: 'knowledge.search', signature: 'knowledge.search(query: string): Promise<Hit[]>', doc: 'Search the knowledge base.', permissions: ['knowledge:read'] }] },
    { name: 'tool', calls: [{ call: 'tool.invoke', signature: 'tool.invoke(id: string, args: object): Promise<unknown>', doc: null, permissions: ['tool:invoke'] }] },
  ],
  types: [{ name: 'Hit', fields: [{ name: 'score', type: 'number', doc: null }] }],
};
const CHANGELOG = [{ version: '1.0.0', date: '2026-09-18', summary: 'The first Extension SDK.', added: ['tool.invoke'], changed: [], deprecated: [{ call: 'agent.old', removeIn: '2.0.0', windowDays: 90 }], removed: [] }];

describe('T2.4.4 docs', () => {
  it('renders the SDK reference; --search keeps the matching entries with their heading', () => {
    const lines = docLines('sdk', SDK);
    assert.equal(lines[0], 'Extension SDK 1.0.0');
    assert.ok(lines.includes('  knowledge.search(query: string): Promise<Hit[]>  [needs knowledge:read]'));
    assert.deepEqual(searchLines(lines, 'invoke'), ['tool', '  tool.invoke(id: string, args: object): Promise<unknown>  [needs tool:invoke]']);
  });

  it('[CLI-T2.4.4-AC1] the docs render offline from the cache when available; with no cache, a clear offline error', async () => {
    const env = await dirs();
    const p = await startMockPlatform((method, path) => (method === 'GET' && path === '/dev/docs/sdk' ? ok(SDK) : null));
    let online: Awaited<ReturnType<typeof runCli>>;
    try {
      online = await runCli(['docs', 'sdk'], { cwd: tmpdir(), host: p.host, env });
    } finally {
      p.close();
    }
    assert.equal(online.code, 0, online.stderr);
    // The platform is gone (a closed port): the saved copy, said to be one.
    const offline = await runCli(['docs', 'sdk'], { cwd: tmpdir(), host: '127.0.0.1:9', env });
    assert.equal(offline.code, 0, offline.stderr);
    assert.equal(offline.stdout, online.stdout);
    assert.match(offline.stderr, /Offline: the saved copy of the sdk reference/);
    const none = await runCli(['docs', 'ui', '--json'], { cwd: tmpdir(), host: '127.0.0.1:9', env });
    assert.equal(none.code, 9);
    assert.equal((JSON.parse(none.stdout) as { error: { code: string } }).error.code, 'OFFLINE_NO_DOCS');
  });
});

describe('T2.4.4 open / extension-points / changelog', () => {
  it('[CLI-T2.4.4-AC2] open refuses a non-allowlisted URL; every target is a Revition https page', () => {
    for (const bad of ['https://evil.example.com/', 'http://developer.revition.com/', 'https://developer.revition.com.evil.io/', 'javascript:alert(1)']) {
      assert.throws(() => assertOpenable(bad), /not a Revition page|Invalid URL/, bad);
    }
    for (const t of OPEN_TARGETS) assert.equal(assertOpenable(targetUrl(t, 'dproj_1')), targetUrl(t, 'dproj_1'));
    assert.equal(targetUrl('project', 'dproj 1'), 'https://developer.revition.com/ide/dproj%201');
    assert.equal(targetUrl('sessions', null), 'https://developer.revition.com/cli-sessions');
  });

  it('edge: no browser: open prints the URL', async () => {
    const r = await runCli(['open', 'docs'], { cwd: tmpdir(), host: '127.0.0.1:9', env: { ...(await dirs()), SSH_CONNECTION: 'test' } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'Open https://developer.revition.com/docs\n');
  });

  it('extension-points and changelog read the platform; changelog --cli names this version', async () => {
    const p = await startMockPlatform((method, path) => {
      if (method === 'GET' && path === '/dev/extension-points') return ok({ extensionPoints: [{ id: 'code_tool', title: 'Code tool', description: 'A function.', surface: 'agent tools' }] });
      if (method === 'GET' && path === '/dev/docs/changelog') return ok({ entries: CHANGELOG });
      return null;
    });
    try {
      const env = await dirs();
      const e = await runCli(['extension-points'], { cwd: tmpdir(), host: p.host, env });
      assert.match(e.stdout, /code_tool.*Code tool.*agent tools/);
      const c = await runCli(['changelog'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(c.stdout, `${entryLines(CHANGELOG[0]!).join('\n')}\n`);
      assert.match(c.stdout, /deprecated: agent\.old \(removed in 2\.0\.0, at least 90 days\)/);
      const cli = await runCli(['changelog', '--cli', '--json'], { cwd: tmpdir(), host: p.host, env });
      assert.match((JSON.parse(cli.stdout) as { data: { version: string } }).data.version, /^\d+\.\d+\.\d+/);
    } finally {
      p.close();
    }
  });
});
