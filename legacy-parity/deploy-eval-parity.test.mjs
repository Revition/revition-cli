// REVITION-CLI-PLAN T2.3.2 AC1: `revition deploy` sends the legacy CLI's exact branch proposal (recorded requests) and
// prints the legacy lines, plus the server's impact summary and the review link (AC2); the next step names the new
// `branches eval`. T2.3.1 AC4: `revition branches eval` is the legacy `eval --agent --branch` (pipeline quote, then
// with --yes the pipeline): the same requests, the same lines, the same exit codes.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli as legacyRunCli } from '../legacy/src/commands.ts';

const CLI_BIN = fileURLToPath(new URL('../packages/cli/bin/run', import.meta.url));
const FILES = {
  'revition.json': '{"summary":"Hello","capabilities":[{"id":"hello","name":"Hello","language":"ts","entrypoint":"run"}]}\n',
  'capabilities/hello/run.ts': 'export async function run(i) { return i; }\n',
};
const IMPACT = { permission: { expanded: ['data:orders'], reduced: [] }, data: { expanded: [], reduced: [] }, ai: [], ui: [], cost: [], security: [], risky: true, flags: ['permission expanded: data:orders'] };
const PROPOSED = { branch: 'cli/hello-1', branchId: 'br_1', files: Object.keys(FILES), permissionDiff: [{ permission: 'data:orders' }], impact: IMPACT };
const QUOTE = { quoteId: 'pq_1', sandboxRuns: 2, limits: { wallMs: 30000, memoryMb: 256 } };
const PASSED = { artifactRef: 'art_9', stages: [{ stage: 'build', status: 'passed', detail: '' }, { stage: 'evaluation', status: 'passed', detail: '' }] };
const FAILED = { artifactRef: 'art_8', stages: [{ stage: 'build', status: 'passed', detail: '' }, { stage: 'evaluation', status: 'failed', detail: 'task_success fell' }] };

function answer(method, path, pipeline) {
  if (method === 'POST' && path.endsWith('/deployments/dep_1/code-branches')) return [201, PROPOSED];
  if (method === 'GET' && path.endsWith('/code-branches/br_1/pipeline-quote')) return [200, QUOTE];
  if (method === 'POST' && path.endsWith('/code-branches/br_1/pipeline')) return [200, pipeline];
  return [404, { error: { code: 'AGENT_NOT_FOUND', message: 'not found' } }];
}

function projectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-parity-'));
  for (const [f, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

async function legacy(argv, pipeline) {
  const lines = [];
  const requests = [];
  const exit = await legacyRunCli(argv, {
    cwd: tmpdir(),
    env: { REVITION_TOKEN: 'parity', REVITION_API_URL: 'https://api.mock.invalid/api/v1' },
    out: (l) => lines.push(l),
    err: (l) => lines.push(l),
    fetch: async (url, init = {}) => {
      const path = new URL(String(url)).pathname;
      requests.push(`${init.method} ${path} ${init.body ?? ''}`);
      const [status, body] = answer(init.method, path, pipeline);
      return new globalThis.Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    },
  });
  return { exit, lines, requests };
}

async function current(argv, pipeline) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = new URL(req.url, 'http://x').pathname;
      requests.push(`${req.method} ${path} ${body}`);
      const [status, out] = answer(req.method, path, pipeline);
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'deploy-xdg-'));
  try {
    const r = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI_BIN, ...argv], {
        env: {
          ...process.env,
          NO_COLOR: '1',
          REVITION_NO_UPDATE_CHECK: '1',
          REVITION_HOST: `127.0.0.1:${server.address().port}`,
          REVITION_TOKEN: `rvt_${'D'.repeat(40)}`,
          XDG_CONFIG_HOME: join(root, 'c'),
          XDG_STATE_HOME: join(root, 's'),
          XDG_CACHE_HOME: join(root, 'k'),
          APPDATA: join(root, 'a'),
          LOCALAPPDATA: join(root, 'l'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout }));
    });
    return { exit: r.code, lines: r.stdout.trimEnd().split('\n'), requests };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

test('[CLI-T2.3.2-AC1] deploy parity: the legacy proposal request and lines, plus the impact and the review link', async () => {
  const dir = projectDir();
  const before = await legacy(['deploy', '--agent', 'dep_1', '--dir', dir]);
  const after = await current(['deploy', '--agent', 'dep_1', '--dir', dir, '--yes']);
  assert.deepEqual(after.requests, before.requests);
  assert.equal(after.requests.length, 1);
  assert.deepEqual(JSON.parse(after.requests[0].slice(after.requests[0].indexOf('{'))), { mode: 'cli', files: FILES });
  assert.equal(before.exit, 0);
  assert.equal(after.exit, 0);
  // The legacy lines (proposal, permissions) come first and unchanged; then the impact and the review link (AC2).
  const legacyBody = before.lines.slice(0, -1);
  assert.deepEqual(after.lines.slice(0, legacyBody.length), legacyBody);
  assert.ok(after.lines.includes('impact: flagged: the reviewer must look before merging'));
  assert.ok(after.lines.some((l) => l.startsWith('review: https://app.revition.com/foundry/agents/dep_1/')));
  assert.equal(before.lines.at(-1), 'Next: an Owner or Admin reviews the branch; then revition eval --agent dep_1 --branch br_1');
  assert.equal(after.lines.at(-1), 'Next: an Owner or Admin reviews the branch; then revition branches eval br_1 --agent dep_1');
});

for (const [name, pipeline, yes, exit] of [
  ['quote only, no --yes', PASSED, false, 0],
  ['promoted', PASSED, true, 0],
  ['not promoted', FAILED, true, 1],
]) {
  test(`[CLI-T2.3.1-AC4] branches eval parity with legacy eval (${name}): requests, lines, exit code`, async () => {
    const before = await legacy(['eval', '--agent', 'dep_1', '--branch', 'br_1', ...(yes ? ['--yes'] : [])], pipeline);
    const after = await current(['branches', 'eval', 'br_1', '--agent', 'dep_1', ...(yes ? ['--yes'] : [])], pipeline);
    assert.deepEqual(after.requests, before.requests);
    assert.equal(after.requests.length, yes ? 2 : 1);
    if (yes) assert.deepEqual(JSON.parse(after.requests[1].slice(after.requests[1].indexOf('{'))), { quoteId: 'pq_1' });
    assert.deepEqual(after.lines, before.lines);
    assert.equal(before.exit, exit);
    assert.equal(after.exit, exit);
  });
}
