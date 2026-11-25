import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ApiClient, effectivePolicy } from '@revition/cli-core';

import { LocalExecutor, type ToolRequest } from './executor.js';

/**
 * T3.3.2 AC5 - a file holding a (fake) key is never transmitted. The executor's results for every local tool that
 * touches it are sent to a spy server through the real CLI transport (the turn route's shape); the spy's raw request
 * bytes never contain the key.
 */
const KEYS = [`sk-ant-${'K'.repeat(40)}`, `rvt_${'S'.repeat(40)}`, 'AKIAIOSFODNN7EXAMPLE', `ghp_${'G'.repeat(36)}`];

let received: string[] = [];
let server: http.Server;
let host = '';

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"events":[]}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  server.closeAllConnections();
});

describe('T3.3.2 no secret upload', () => {
  it('[CLI-T3.3.2-AC5] read / search / list / a command over files with fake keys: the transport spy never sees a key', async () => {
    received = [];
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nsu-')));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, '.env'), `ANTHROPIC_API_KEY=${KEYS[0]}\n`);
    writeFileSync(join(root, 'src', 'config.ts'), `export const token = '${KEYS[1]}'; // findme\n`);
    writeFileSync(join(root, 'src', 'aws.ts'), `const id = "${KEYS[2]}"; // findme\n`);
    writeFileSync(join(root, 'src', 'ok.ts'), 'export const ok = 1; // findme\n');
    writeFileSync(join(root, 'notes.md'), `gh ${KEYS[3]}\n`);
    const ex = new LocalExecutor({ policy: effectivePolicy(root, {}, { network: 'allow' }), approve: async () => true });
    const requests: ToolRequest[] = [
      { tool: 'read_file', args: { path: '.env' }, reason: 'model asks for the env file' },
      { tool: 'read_file', args: { path: 'src/config.ts' }, reason: 'r' },
      { tool: 'read_file', args: { path: 'src/aws.ts' }, reason: 'r' },
      { tool: 'read_file', args: { path: 'notes.md' }, reason: 'r' },
      { tool: 'search', args: { query: 'findme' }, reason: 'r' },
      { tool: 'search', args: { query: 'sk-ant' }, reason: 'r' },
      { tool: 'list_dir', args: { path: '.' }, reason: 'r' },
      { tool: 'run_command', args: { command: 'cat .env src/config.ts notes.md' }, reason: 'r' },
      { tool: 'read_file', args: { path: 'src/ok.ts' }, reason: 'r' },
    ];
    const toolResults = [];
    for (const r of requests) toolResults.push(await ex.handle(r));
    const api = new ApiClient({ host, token: async () => null, cliVersion: '0.0.0' });
    await api.request({ method: 'POST', path: '/dev/assist/sessions/s_1/turns', body: { userMessage: 'continue', toolResults } });

    assert.equal(received.length, 1);
    for (const k of KEYS) assert.ok(!received[0]?.includes(k), `the key ${k.slice(0, 8)}... was transmitted`);
    // What the model learns instead: the block, never the bytes; a clean file still flows.
    const sent = (JSON.parse(received[0] ?? '{}') as { toolResults: { tool: string; ok: boolean; error?: string; output?: unknown }[] }).toolResults;
    for (const i of [0, 1, 2, 3]) assert.match(String(sent[i]?.error), /blocked by policy/, `request ${i}`);
    assert.deepEqual((sent[4]?.output as { hits: { path: string }[] }).hits.map((h) => h.path), ['src/ok.ts']);
    assert.equal((sent[6]?.output as { entries: { name: string }[] }).entries.some((e) => e.name === '.env'), false);
    assert.equal((sent[8]?.output as { content: string }).content, 'export const ok = 1; // findme\n');
  });
});
