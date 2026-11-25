// REVITION-CLI-PLAN T2.1.1 AC5: `revition scaffold` in the new CLI writes byte-equal files and the same lines as the
// legacy CLI (legacy/src/commands.ts) for the same starter, and asks the platform the same thing (GET the starter).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli as legacyRunCli } from '../legacy/src/commands.ts';

const CLI_BIN = fileURLToPath(new URL('../packages/cli/bin/run', import.meta.url));
const STARTER = {
  id: 'hello-tool',
  title: 'Hello tool',
  extensionPoint: 'code_tool',
  language: 'ts',
  files: {
    'revition.json': '{"summary":"Hello","capabilities":["hello"]}\n',
    'capabilities/hello/index.ts': 'export async function run(input) {\n  return { hello: input };\n}\n',
    'capabilities/hello/tests.json': '[{"name":"echo","input":1,"expect":{"hello":1}}]\n',
    'fixtures.json': '{}\n',
  },
};

function tree(dir) {
  const out = {};
  const walk = (at) => {
    for (const n of readdirSync(at).sort()) {
      const p = join(at, n);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

async function legacy() {
  const cwd = mkdtempSync(join(tmpdir(), 'scaffold-legacy-'));
  const out = [];
  const requests = [];
  const exit = await legacyRunCli(['scaffold', 'hello-tool', 'proj'], {
    cwd,
    env: { REVITION_TOKEN: 'parity', REVITION_API_URL: 'https://api.mock.invalid/api/v1' },
    out: (l) => out.push(l),
    err: (l) => out.push(l),
    fetch: async (url, init = {}) => {
      requests.push(`${init.method ?? 'GET'} ${new URL(String(url)).pathname}`);
      return new globalThis.Response(JSON.stringify(STARTER), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  return { exit, dir: join(cwd, 'proj'), lines: out.map((l) => l.replace(cwd, '<cwd>')), requests };
}

async function current() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${new URL(req.url, 'http://x').pathname}`);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(STARTER));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const cwd = mkdtempSync(join(tmpdir(), 'scaffold-new-'));
  const root = mkdtempSync(join(tmpdir(), 'scaffold-xdg-'));
  try {
    const r = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI_BIN, 'scaffold', 'hello-tool', 'proj'], {
        cwd,
        env: {
          ...process.env,
          NO_COLOR: '1',
          REVITION_NO_UPDATE_CHECK: '1',
          REVITION_HOST: `127.0.0.1:${server.address().port}`,
          REVITION_TOKEN: `rvt_${'S'.repeat(40)}`,
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
    // The child reports its cwd through realpath (/private/var/... on macOS); both spellings are the same directory.
    const real = realpathSync(cwd);
    return { exit: r.code, dir: join(cwd, 'proj'), lines: r.stdout.trimEnd().split('\n').map((l) => l.replace(real, '<cwd>').replace(cwd, '<cwd>')), requests };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

test('[CLI-T2.1.1-AC5] scaffold: byte-equal files, the same lines and the same platform call as the legacy CLI', async () => {
  const before = await legacy();
  const after = await current();
  assert.equal(before.exit, 0);
  assert.equal(after.exit, 0);
  assert.deepEqual(tree(after.dir), tree(before.dir));
  assert.deepEqual(tree(after.dir), STARTER.files);
  assert.deepEqual(after.lines, before.lines);
  assert.deepEqual(after.requests, before.requests);
});
