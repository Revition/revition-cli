import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CLI_BIN } from './test-fixtures/spawn-cli.js';

/**
 * T4.2.3 (REVITION-CLI-PLAN.md:3119-3135) - the `plugins` commands through the REAL CLI against a local platform: search
 * reads the registry index (the workspace verdict shown), install refuses a plugin the org does not allow BEFORE any
 * download, list / remove / run / update on a machine with nothing installed. The full install of a real signed plugin
 * published to npm is the L4 leg (step 8); the install -> use -> remove lifecycle is proven in cli-core
 * (plugin-lifecycle.test.ts).
 */
const ENTRIES = [
  { name: '@acme/revition-plugin-jira', publisherId: 'github.com:acme/revition-plugin-jira', publisherName: 'Acme', summary: 'Jira issues in the terminal', allowed: true },
  { name: '@acme/revition-plugin-lint', publisherId: 'github.com:acme/revition-plugin-jira', publisherName: 'Acme', summary: 'Lint agent definitions', allowed: false },
];

async function platform(): Promise<{ host: string; paths: string[]; close: () => void }> {
  const paths: string[] = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    paths.push(`${req.method} ${u.pathname}${u.search}`);
    let body: unknown = { error: { code: 'AGENT_NOT_FOUND', message: 'x' } };
    let status = 404;
    if (u.pathname === '/api/v1/foundry/dev/plugins') {
      const name = u.searchParams.get('name');
      const q = (u.searchParams.get('q') ?? '').toLowerCase();
      status = 200;
      body = { plugins: ENTRIES.filter((e) => (name === null ? `${e.name} ${e.summary}`.toLowerCase().includes(q) : e.name === name)) };
    }
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    paths,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

async function cli(args: string[], host: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const root = await mkdtemp(join(tmpdir(), 'plugcmd-'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd: root,
      env: {
        ...process.env,
        NO_COLOR: '1',
        REVITION_NO_UPDATE_CHECK: '1',
        REVITION_HOST: host,
        REVITION_TOKEN: `rvt_${'C'.repeat(40)}`,
        XDG_CONFIG_HOME: join(root, 'c'),
        XDG_STATE_HOME: join(root, 's'),
        XDG_CACHE_HOME: join(root, 'k'),
        APPDATA: join(root, 'a'),
        LOCALAPPDATA: join(root, 'l'),
        HTTPS_PROXY: 'http://127.0.0.1:9',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end('');
  });
}

describe('T4.2.3 the plugins commands (real CLI)', () => {
  it('[CLI-T4.2.3-AC1] search reads the registry index with the workspace verdict (table and --json)', async () => {
    const p = await platform();
    try {
      const t = await cli(['plugins', 'search', 'acme'], p.host);
      assert.equal(t.code, 0, t.stderr);
      assert.match(t.stdout, /@acme\/revition-plugin-jira.*allowed/u);
      assert.match(t.stdout, /@acme\/revition-plugin-lint.*not allowed/u);
      const j = await cli(['plugins', 'search', 'jira', '--json'], p.host);
      assert.equal(j.code, 0, j.stderr);
      const data = (JSON.parse(j.stdout) as { data: { plugins: Array<{ name: string; allowed: boolean }> } }).data;
      assert.deepEqual(data.plugins.map((e) => [e.name, e.allowed]), [['@acme/revition-plugin-jira', true]]);
      assert.ok(p.paths.includes('GET /api/v1/foundry/dev/plugins?q=jira'));
    } finally {
      p.close();
    }
  });

  it('[CLI-T4.2.3-AC2] an org-disallowed plugin is refused at install (exit 4), before anything is downloaded', async () => {
    const p = await platform();
    try {
      const r = await cli(['plugins', 'install', '@acme/revition-plugin-lint', '--yes'], p.host);
      assert.equal(r.code, 4, r.stderr);
      assert.match(r.stderr, /Your workspace does not allow the plugin @acme\/revition-plugin-lint/u);
      assert.match(r.stderr, /Command-line access/u);
      assert.deepEqual(p.paths, ['GET /api/v1/foundry/dev/plugins?name=%40acme%2Frevition-plugin-lint']);
    } finally {
      p.close();
    }
  });

  it('[CLI-T4.2.3-AC1] list / remove / run / update on a machine with nothing installed', async () => {
    const p = await platform();
    try {
      const list = await cli(['plugins', 'list', '--json'], p.host);
      assert.equal(list.code, 0, list.stderr);
      assert.deepEqual((JSON.parse(list.stdout) as { data: { plugins: unknown[] } }).data.plugins, []);
      const rm = await cli(['plugins', 'remove', '@acme/revition-plugin-jira', '--yes'], p.host);
      assert.equal(rm.code, 5, rm.stderr);
      const run = await cli(['plugins', 'run', '@acme/revition-plugin-jira', 'issues'], p.host);
      assert.equal(run.code, 5, run.stderr);
      assert.match(run.stderr, /revition plugins install @acme\/revition-plugin-jira/u);
      const up = await cli(['plugins', 'update', '@acme/revition-plugin-jira', '--yes'], p.host);
      assert.equal(up.code, 5, up.stderr);
    } finally {
      p.close();
    }
  });
});
