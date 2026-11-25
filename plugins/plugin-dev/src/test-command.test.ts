/**
 * T2.1.3 `revition test` (REVITION-CLI-PLAN.md:2015-2037; Q1 answered from the plan :2021-2024): the project's tests
 * run HERE against the stubbed SDK (fixtures.json), offline, with no credential. Through the real CLI process.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import * as legacy from '../../../legacy/src/local-run.js';

import { buildProgram, parseRun, preloadSpecifier } from './local/local-run.js';
import { interruptible, pressCtrlC } from './test-fixtures/ctrl-c.js';
import { CLI_BIN, dirs, runCli } from './test-fixtures/mock-platform.js';

/** Nothing listens here: any accidental platform call would fail the run. */
const NO_HOST = '127.0.0.1:9';

interface Cap {
  readonly id: string;
  readonly language: 'ts' | 'python';
  readonly source: string;
  readonly sdkPermissions?: readonly string[];
  readonly tests: readonly { name: string; input: unknown; expect: unknown }[];
}

function project(caps: readonly Cap[], fixtures?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'revtest-'));
  writeFileSync(
    join(dir, 'revition.json'),
    JSON.stringify({ summary: 'L', capabilities: caps.map((c) => ({ id: c.id, language: c.language, entrypoint: 'main', sdkPermissions: c.sdkPermissions ?? [] })) })
  );
  for (const c of caps) {
    mkdirSync(join(dir, 'capabilities', c.id), { recursive: true });
    writeFileSync(join(dir, 'capabilities', c.id, `main.${c.language === 'ts' ? 'ts' : 'py'}`), c.source);
    writeFileSync(join(dir, 'capabilities', c.id, 'tests.json'), JSON.stringify(c.tests));
  }
  if (fixtures !== undefined) writeFileSync(join(dir, 'fixtures.json'), JSON.stringify(fixtures));
  return dir;
}

const greet: Cap = {
  id: 'greet',
  language: 'ts',
  sdkPermissions: ['user:read'],
  source: "async function main(i: { name?: string }) {\n  const u = await revition.sdk('user.current');\n  return { hello: i.name ?? u.name };\n}\n",
  tests: [
    { name: 'from input', input: { name: 'Ada' }, expect: { hello: 'Ada' } },
    { name: 'from the user', input: {}, expect: { hello: 'Grace' } },
  ],
};
const searchPy: Cap = {
  id: 'search',
  language: 'python',
  sdkPermissions: ['effect:read', 'knowledge:read'],
  source: "def main(i):\n    hits = revition_sdk('knowledge.search', i['q'], 3)\n    return {'count': len(hits)}\n",
  tests: [{ name: 'counts hits', input: { q: 'refund' }, expect: { count: 2 } }],
};
const FIXTURES = { 'user.current': { name: 'Grace' }, 'knowledge.search': [{ id: 'a' }, { id: 'b' }] };

describe('T2.1.3 revition test (local, stubbed SDK, offline)', () => {
  it('[CLI-T2.1.3-AC1] parity with the legacy runner: the same program and the same result reading, byte for byte', () => {
    for (const lang of ['typescript', 'python'] as const) {
      const nonce = '__REVITION_RESULT_0123456789abcdef0123456789abcdef__';
      const ours = buildProgram(lang, 'SRC', 'main', { q: 1 }, nonce);
      const theirs = legacy.buildProgram(lang, 'SRC', 'main', { q: 1 }, nonce);
      assert.equal(ours, theirs, lang);
      const out = `log line\n${nonce}{"ok":true,"output":{"a":1}}\n`;
      assert.deepEqual(parseRun(out, nonce), legacy.parseRun(out, nonce));
    }
    assert.equal(buildProgram('typescript', 'SRC', 'not a name', 1, 'n'), null);
  });

  it('[CLI-T2.1.3-AC1] the legacy test cases pass here: TypeScript and Python, SDK answers from fixtures.json, no platform', async () => {
    const dir = project([greet, searchPy], FIXTURES);
    const r = await runCli(['test'], { cwd: dir, host: NO_HOST, env: await dirs() });
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /^PASS greet: from input$/m);
    assert.match(r.stdout, /^PASS greet: from the user$/m);
    assert.match(r.stdout, /^PASS search: counts hits$/m);
    assert.match(r.stdout, /^all tests passed locally$/m);
    // A wrong expectation fails with the legacy reason line, exit 1; an ungranted call is refused like the platform.
    const bad = project([{ ...greet, tests: [{ name: 'wrong', input: { name: 'Ada' }, expect: { hello: 'Bob' } }] }], FIXTURES);
    const failed = await runCli(['test'], { cwd: bad, host: NO_HOST, env: await dirs() });
    assert.equal(failed.code, 1);
    assert.match(failed.stdout, /returned \{"hello":"Ada"\}, expected \{"hello":"Bob"\}/);
    const denied = project([{ ...greet, sdkPermissions: [], tests: [{ name: 'no grant', input: {}, expect: {} }] }], FIXTURES);
    assert.match((await runCli(['test'], { cwd: denied, host: NO_HOST, env: await dirs() })).stdout, /SDK user\.current refused: AGENT_FORBIDDEN/);
    const missing = project([{ ...greet, tests: [{ name: 'no fixture', input: {}, expect: {} }] }], {});
    assert.match((await runCli(['test'], { cwd: missing, host: NO_HOST, env: await dirs() })).stdout, /no fixture \(add "user\.current" to fixtures\.json\)/);
  });

  it('[CLI-T2.1.3-AC2] a network attempt during test fails the run with a message (TypeScript fetch, Python socket)', async () => {
    const netTs: Cap = {
      id: 'netts',
      language: 'ts',
      source: "async function main() {\n  const r = await fetch('https://example.com/');\n  return r.status;\n}\n",
      tests: [{ name: 'calls out', input: {}, expect: 200 }],
    };
    const netPy: Cap = {
      id: 'netpy',
      language: 'python',
      source: "import urllib.request\ndef main(i):\n    return urllib.request.urlopen('https://example.com/', timeout=5).status\n",
      tests: [{ name: 'calls out', input: {}, expect: 200 }],
    };
    const dir = project([netTs, netPy], {});
    const r = await runCli(['test'], { cwd: dir, host: NO_HOST, env: await dirs() });
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, /^FAIL netts: calls out$/m);
    assert.match(r.stdout, /^FAIL netpy: calls out$/m);
    assert.equal((r.stdout.match(/the test tried to reach the network: `revition test` runs offline/g) ?? []).length, 2);
    assert.match(r.stdout, /REVITION_TEST_NETWORK_BLOCKED/);
  });

  it('[CLI-T2.1.3-AC3] --watch re-runs on a change, until Ctrl-C', async () => {
    const dir = project([greet], FIXTURES);
    const child = spawn(process.execPath, [CLI_BIN, 'test', '--watch'], interruptible({
      cwd: dir,
      env: { ...process.env, ...(await dirs()), NO_COLOR: '1', REVITION_NO_UPDATE_CHECK: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const until = async (re: RegExp): Promise<void> => {
      for (let i = 0; i < 100 && !re.test(err); i++) await new Promise((r) => setTimeout(r, 100));
      assert.match(err, re);
    };
    await until(/all tests passed locally/);
    writeFileSync(join(dir, 'capabilities', 'greet', 'tests.json'), JSON.stringify([{ name: 'changed', input: { name: 'Z' }, expect: { hello: 'Q' } }]));
    await until(/--- re-run ---[\s\S]*FAIL greet: changed/);
    const exited = new Promise<number | null>((r) => child.on('close', (c) => r(c)));
    pressCtrlC(child);
    assert.equal(await exited, 11);
  });

  it('[CLI-T2.1.3-AC4] --json: one envelope that conforms to the published revition.test.v1 schema, per-case results', async () => {
    const dir = project([greet, searchPy], FIXTURES);
    const r = await runCli(['test', '--json', '--filter', 'from'], { cwd: dir, host: NO_HOST, env: await dirs() });
    assert.equal(r.code, 0, r.stderr);
    const env = JSON.parse(r.stdout) as { ok: boolean; data: { passed: number; failed: number; cases: { capability: string; name: string; passed: boolean }[] } };
    assert.equal(env.ok, true);
    assert.deepEqual(env.data.cases.map((c) => [c.capability, c.name, c.passed]), [['greet', 'from input', true], ['greet', 'from the user', true]]);
    assert.equal(env.data.passed, 2);
    assert.equal(env.data.failed, 0);
  });
});

describe('T2.1.3 / T2.1.4 the local runner on every OS', () => {
  it('[CLI-T2.1.4-AC1] the network-block preload is passed to --import as a file: URL (a Windows path is not a specifier)', () => {
    // windows-latest CI: `--import C:\\...\\no-network.mjs` -> ERR_UNSUPPORTED_ESM_URL_SCHEME, so every local test FAILED.
    assert.equal(preloadSpecifier('C:\\Users\\dev\\AppData\\Local\\Temp\\revition-test-1\\no-network.mjs', true), 'file:///C:/Users/dev/AppData/Local/Temp/revition-test-1/no-network.mjs');
    assert.equal(preloadSpecifier('/tmp/revition-test-1/no-network.mjs', false), 'file:///tmp/revition-test-1/no-network.mjs');
    assert.match(preloadSpecifier(join(tmpdir(), 'no-network.mjs')), /^file:\/\/\//u);
  });
});
