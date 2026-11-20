import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { MCP_PROTOCOL_VERSION } from './server.js';
import { CLI_BIN, connect, ok, PAT, startMockPlatform, type MockPlatform } from './test-fixtures/harness.js';

/**
 * T3.2.2 - protocol conformance: the official MCP SDK client (the conformance harness) drives the real
 * `revition mcp serve` over stdio; raw JSON-RPC lines check the error codes the SDK never sends.
 */
const APP = { appId: 'dapp_mine', developerId: 'auth0|d', manifestRef: 'plugin://order-sync@0.1.0', manifest: { pluginId: 'order-sync' }, declaredScopes: ['source:orders'], keyRefs: [], createdAt: '2026-11-18T10:00:00Z' };

/** Raw lines in, raw lines out (until `want` answers arrived). */
async function raw(host: string, lines: readonly string[], want: number): Promise<Record<string, unknown>[]> {
  const root = await mkdtemp(join(tmpdir(), 'revmcp-raw-'));
  const env = { PATH: process.env['PATH'] ?? '', HOME: root, XDG_CONFIG_HOME: join(root, 'c'), XDG_STATE_HOME: join(root, 's'), XDG_CACHE_HOME: join(root, 'k'), REVITION_HOST: host, REVITION_TOKEN: PAT, REVITION_NO_UPDATE_CHECK: '1' };
  const child = spawn(process.execPath, [CLI_BIN, 'mcp', 'serve'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const out: Record<string, unknown>[] = [];
  let buf = '';
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${buf}`)), 20_000);
    child.stdout.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        out.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
        buf = buf.slice(i + 1);
      }
      if (out.length >= want) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  for (const l of lines) child.stdin.write(`${l}\n`);
  await done;
  child.stdin.end();
  await new Promise((r) => child.on('close', r));
  return out;
}

describe('T3.2.2 MCP protocol conformance (the official SDK client against the real server)', () => {
  let mock: MockPlatform;
  let revoked = false;
  before(async () => {
    mock = await startMockPlatform((method, path) => {
      if (revoked) return { status: 401, body: { error: { code: 'CLI_SESSION_REVOKED', message: 'This CLI session was revoked.' } } };
      if (method === 'GET' && path === '/dev/apps') return ok({ apps: [APP] });
      return null;
    });
  });
  after(() => mock.close());

  it('initialize negotiates the pinned protocol revision; the server names itself and offers tools only', async () => {
    const s = await connect(mock.host);
    try {
      assert.equal(s.client.getServerVersion()?.name, 'revition');
      assert.deepEqual(Object.keys(s.client.getServerCapabilities() ?? {}), ['tools']);
      await s.client.ping();
      const { tools } = await s.client.listTools();
      for (const t of tools) assert.equal(t.inputSchema.type, 'object', t.name);
    } finally {
      await s.close();
    }
  });

  it('[CLI-T3.2.2-AC4] (local half) list apps through a tool: the result is the CLI command\'s own JSON envelope', async () => {
    const s = await connect(mock.host);
    try {
      const r = await s.client.callTool({ name: 'revition_apps_list', arguments: {} });
      assert.equal(r.isError, false, JSON.stringify(r));
      const env = r.structuredContent as { command: string; ok: boolean; data: { apps: { appId: string }[] } };
      assert.equal(env.command, 'apps:list');
      assert.deepEqual(env.data.apps.map((a) => a.appId), ['dapp_mine']);
      assert.deepEqual(JSON.parse((r.content as { text: string }[])[0]?.text ?? ''), env);
    } finally {
      await s.close();
    }
  });

  it('[CLI-T3.2.2-AC5] every platform call a tool makes carries Revition-Client: mcp (the audit label); the plain CLI sends none', async () => {
    const s = await connect(mock.host);
    const before = mock.log.length;
    try {
      const r = await s.client.callTool({ name: 'revition_apps_list', arguments: {} });
      assert.equal(r.isError, false, JSON.stringify(r));
    } finally {
      await s.close();
    }
    const made = mock.log.slice(before);
    assert.ok(made.length > 0, 'the tool called the platform');
    assert.deepEqual(made.map((c) => c.client), made.map(() => 'mcp'));
    // The same command run directly (not under mcp serve) is not labelled.
    const root = await mkdtemp(join(tmpdir(), 'revmcp-plain-'));
    const plainBefore = mock.log.length;
    const child = spawn(process.execPath, [CLI_BIN, 'apps', 'list', '--json'], {
      env: { PATH: process.env['PATH'] ?? '', HOME: root, XDG_CONFIG_HOME: join(root, 'c'), XDG_STATE_HOME: join(root, 's'), XDG_CACHE_HOME: join(root, 'k'), REVITION_HOST: mock.host, REVITION_TOKEN: PAT, REVITION_NO_UPDATE_CHECK: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((r) => child.on('close', r));
    const plain = mock.log.slice(plainBefore);
    assert.ok(plain.length > 0, 'the plain CLI called the platform');
    assert.deepEqual(plain.map((c) => c.client), plain.map(() => undefined));
  });

  it('edge: a revoked credential is a tool error with the re-auth hint (the server keeps running)', async () => {
    const s = await connect(mock.host);
    try {
      revoked = true;
      const r = await s.client.callTool({ name: 'revition_apps_list', arguments: {} });
      assert.equal(r.isError, true);
      const env = r.structuredContent as { ok: boolean; error: { code: string; hint: string | null } };
      assert.equal(env.ok, false);
      // The CLI's own re-auth guidance for the credential in use (a PAT here: a new token; a session: `revition login`).
      assert.match(env.error.hint ?? '', /revition (login|token create)/);
      revoked = false;
      await s.client.ping();
    } finally {
      revoked = false;
      await s.close();
    }
  });

  it('raw JSON-RPC: parse error, unknown method, unknown tool, a batch, and an older protocol revision answered with ours', async () => {
    const out = await raw(
      mock.host,
      [
        '{not json',
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'revition_nope', arguments: {} } }),
        JSON.stringify([{ jsonrpc: '2.0', id: 3, method: 'ping' }]),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } }),
      ],
      5
    );
    const byId = new Map(out.map((m) => [m['id'] as number | null, m]));
    assert.equal((out.find((m) => m['id'] === null && (m['error'] as { code: number }).code === -32700) as object | undefined) !== undefined, true, 'parse error');
    assert.equal((byId.get(1)?.['error'] as { code: number }).code, -32601);
    assert.equal((byId.get(2)?.['error'] as { code: number }).code, -32602);
    assert.ok(out.some((m) => m['id'] === null && (m['error'] as { code: number } | undefined)?.code === -32600), 'batch refused');
    assert.equal((byId.get(4)?.['result'] as { protocolVersion: string }).protocolVersion, MCP_PROTOCOL_VERSION);
    assert.equal(out.length, 5, 'a notification gets no answer');
  });
});
