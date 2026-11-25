// REVITION-CLI-PLAN T2.1.2 AC3: `revition build` in the new CLI sends the legacy CLI's exact request (the same project
// files to POST /dev/authoring/check) and prints the same lines for the server's answer. Exit codes follow the plan
// (0 ok, 6 failed) instead of the legacy 0 / 1.
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
  'capabilities/hello/tests.json': '[{"name":"echo","input":1,"expect":1}]\n',
  'fixtures.json': '{}\n',
};
const ANSWERS = {
  ok: { ok: true, problems: [], warnings: [{ file: 'capabilities/hello/run.ts', message: 'slow import' }], buildLogs: { hello: ['compiled', 'scanned'] }, project: null, granted: {} },
  failed: { ok: false, problems: [{ file: 'revition.json', message: 'capabilities.0: a permission is not allowed' }], warnings: [], buildLogs: {}, project: null, granted: {} },
};

function projectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'build-parity-'));
  for (const [f, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return dir;
}

async function legacy(answer) {
  const dir = projectDir();
  const lines = [];
  const bodies = [];
  const exit = await legacyRunCli(['build', '--dir', dir], {
    cwd: dir,
    env: { REVITION_TOKEN: 'parity', REVITION_API_URL: 'https://api.mock.invalid/api/v1' },
    out: (l) => lines.push(l),
    err: (l) => lines.push(l),
    fetch: async (url, init = {}) => {
      bodies.push(`${init.method} ${new URL(String(url)).pathname} ${init.body}`);
      return new globalThis.Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  return { exit, lines, bodies };
}

async function current(answer) {
  const bodies = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      bodies.push(`${req.method} ${new URL(req.url, 'http://x').pathname} ${body}`);
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const root = mkdtempSync(join(tmpdir(), 'build-xdg-'));
  try {
    const r = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI_BIN, 'build', '--dir', projectDir()], {
        env: {
          ...process.env,
          NO_COLOR: '1',
          REVITION_NO_UPDATE_CHECK: '1',
          REVITION_HOST: `127.0.0.1:${server.address().port}`,
          REVITION_TOKEN: `rvt_${'B'.repeat(40)}`,
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
    return { exit: r.code, lines: r.stdout.trimEnd().split('\n').filter((l) => !l.startsWith('warn Using the custom host')), bodies };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

for (const [name, answer] of Object.entries(ANSWERS)) {
  test(`[CLI-T2.1.2-AC3] build parity (${name}): the legacy request and the legacy lines`, async () => {
    const before = await legacy(answer);
    const after = await current(answer);
    assert.deepEqual(after.bodies, before.bodies.map((b) => b));
    assert.equal(after.bodies.length, 1);
    assert.deepEqual(JSON.parse(after.bodies[0].slice(after.bodies[0].indexOf('{'))), { files: FILES });
    assert.deepEqual(after.lines, before.lines);
    assert.equal(before.exit, name === 'ok' ? 0 : 1);
    assert.equal(after.exit, name === 'ok' ? 0 : 6);
  });
}
