import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { Config } from '@oclif/core';
import { DoctorReport, isEnvelope, runDoctor, type DoctorDeps } from '@revition/cli-core';

import { completionScript, SHELLS } from './completion.js';
import { suggestCommand } from './suggest.js';
import { cliDirs } from './test-fixtures/cli-dirs.js';
import { CLI_BIN, runCli } from './test-fixtures/spawn-cli.js';

const CLI_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SECRET = 'rvt_' + 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8L9z0';

function has(bin: string): boolean {
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const HEALTHY: DoctorDeps = {
  cliVersion: '0.1.0',
  channel: 'stable',
  latestVersion: async () => '0.1.0',
  nodeVersion: 'v22.22.3',
  platform: 'darwin',
  arch: 'arm64',
  host: 'api.revition.com',
  env: {},
  configReadable: async () => ({ ok: true, detail: 'readable' }),
  credentialBackend: async () => 'keychain',
  tokenState: async () => 'valid',
  probeHost: async () => ({ reachable: true, tls: 'ok', serverDate: new Date(1_800_000_000_000).toUTCString(), error: null }),
  telemetry: async () => 'off',
  flagCacheAgeMs: async () => null,
  now: () => 1_800_000_000_000,
};
const statusOf = (r: DoctorReport, id: string): string | undefined => r.checks.find((c) => c.id === id)?.status;

describe('T1.1.6 help, suggestions, completion, doctor', () => {
  it('[CLI-T1.1.6-AC1] every command has >= 1 example (manifest); help works offline', async () => {
    const config = await Config.load(CLI_ROOT);
    for (const c of config.commands) {
      assert.ok((c.examples ?? []).length >= 1, `${c.id} has no example`);
      const meta = (c as unknown as { meta?: { examples?: string[] } }).meta;
      assert.ok((meta?.examples ?? []).length >= 1, `${c.id} meta has no example`);
    }
    const dead = { HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' };
    const topic = await runCli(CLI_BIN, ['config', '--help'], { env: dead });
    assert.equal(topic.code, 0);
    assert.match(topic.stdout, /config set/);
    const command = await runCli(CLI_BIN, ['config', 'set', '--help'], { env: dead });
    assert.equal(command.code, 0);
    assert.match(command.stdout, /EXAMPLES/);
    assert.match(command.stdout, /revition config set telemetry off/);
  });

  it('[CLI-T1.1.6-AC2] a typo yields a suggestion and exit 2, never execution', async () => {
    assert.equal(suggestCommand('confg get', ['config:get', 'config:set', 'doctor']), 'config get');
    assert.equal(suggestCommand('doctr', ['config:get', 'doctor']), 'doctor');
    assert.equal(suggestCommand('zzzzzzzz', ['config:get', 'doctor']), null);
    const home = await mkdtemp(join(tmpdir(), 'revsug-'));
    const r = await runCli(CLI_BIN, ['confg', 'set', 'telemetry', 'on'], { env: { ...cliDirs(home) } });
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Did you mean 'config set'\?/);
    assert.equal(r.stdout, '');
    // never executed: nothing was written
    const after = await runCli(CLI_BIN, ['config', 'get', 'telemetry'], { env: { ...cliDirs(home) } });
    assert.equal(after.stdout, 'unset\n');
  });

  it('[CLI-T1.1.6-AC3] completion scripts are generated for 4 shells (each parses in its shell where installed)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'revcomp-'));
    for (const shell of SHELLS) {
      const r = await runCli(CLI_BIN, ['autocomplete', shell]);
      assert.equal(r.code, 0, `${shell}: ${r.stderr}`);
      assert.match(r.stdout, /config/);
      assert.match(r.stdout, /doctor/);
      const file = join(dir, `c.${shell}`);
      await writeFile(file, r.stdout);
      const parser: Record<string, [string, string[]]> = {
        bash: ['bash', ['-n', file]],
        zsh: ['zsh', ['-n', file]],
        fish: ['fish', ['--no-execute', file]],
        powershell: ['pwsh', ['-NoProfile', '-Command', `$null = [ScriptBlock]::Create((Get-Content -Raw '${file}'))`]],
      };
      const [bin, args] = parser[shell] ?? ['', []];
      if (has(bin)) execFileSync(bin, args, { stdio: 'pipe' });
    }
    const script = completionScript('bash', 'revition', [{ words: 'config get', summary: '', flags: ['json'] }]);
    assert.match(script, /'config get'\) opts='--json'/);
    assert.match(script, /''\) opts='config'/);
  });

  it('[CLI-T1.1.6-AC4] doctor --json matches its schema, and the leak suite finds no secret in its output', async () => {
    const home = await mkdtemp(join(tmpdir(), 'revdoc-'));
    const r = await runCli(CLI_BIN, ['doctor', '--json'], {
      env: { ...cliDirs(home), REVITION_TOKEN: SECRET, REVITION_HOST: '127.0.0.1', HTTPS_PROXY: `http://user:${SECRET}@127.0.0.1:9` },
    });
    const doc = JSON.parse(r.stdout) as { data: unknown };
    assert.ok(isEnvelope(doc));
    DoctorReport.parse(doc.data);
    assert.ok(!r.stdout.includes(SECRET.slice(4)) && !r.stderr.includes(SECRET.slice(4)), 'doctor leaked a secret');
    const human = await runCli(CLI_BIN, ['doctor'], { env: { ...cliDirs(home), REVITION_TOKEN: SECRET, HTTPS_PROXY: `http://u:${SECRET}@127.0.0.1:9` } });
    assert.ok(!human.stdout.includes(SECRET.slice(4)) && !human.stderr.includes(SECRET.slice(4)));
    assert.match(human.stdout, /\d+ ok, \d+ warn, \d+ failed/);
  });

  it('[CLI-T1.1.6-AC5] a check fails correctly when the keychain is unavailable, the clock is skewed or the host is unreachable', async () => {
    const healthy = await runDoctor(HEALTHY);
    assert.equal(healthy.summary.fail, 0);
    assert.equal(statusOf(healthy, 'clock'), 'ok');
    const noKeychain = await runDoctor({ ...HEALTHY, credentialBackend: async () => 'none' });
    assert.equal(statusOf(noKeychain, 'credential-store'), 'fail');
    assert.equal(statusOf(await runDoctor({ ...HEALTHY, credentialBackend: async () => 'encrypted-file' }), 'credential-store'), 'warn');
    const skewed = await runDoctor({ ...HEALTHY, now: () => 1_800_000_000_000 + 5 * 60_000 });
    assert.equal(statusOf(skewed, 'clock'), 'warn');
    assert.match(skewed.checks.find((c) => c.id === 'clock')?.message ?? '', /off by 300 s/);
    const down = await runDoctor({ ...HEALTHY, probeHost: async () => ({ reachable: false, tls: 'unknown', serverDate: null, error: 'ECONNREFUSED' }), tokenState: async () => 'unreachable' });
    assert.equal(statusOf(down, 'host'), 'fail');
    assert.match(down.checks.find((c) => c.id === 'host')?.message ?? '', /ECONNREFUSED/);
    // edge case: not logged in is a warning, not a failure
    const anon = await runDoctor({ ...HEALTHY, tokenState: async () => 'not_logged_in' });
    assert.equal(statusOf(anon, 'credential'), 'warn');
    assert.equal(anon.summary.fail, 0);
  });
});
