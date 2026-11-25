import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { infoOnlyRun } from './startup-path.js';
import { CLI_BIN, FIXTURE_RUN, runCli } from './test-fixtures/spawn-cli.js';

/** A file: URL: a Windows path is not a valid --import specifier (ERR_UNSUPPORTED_ESM_URL_SCHEME, PR #11 run 45564271218). */
const RECORDER = new URL('./test-fixtures/record-loads.mjs', import.meta.url).href;
/** The full core entry and the libraries that load only on first use (packages/core/src/lazy-deps.ts LAZY_PACKAGES). */
const FULL_CORE = /\/packages\/core\/dist\/index\.js$|\/@revition\/cli-core\/dist\/index\.js$/u;
const LAZY = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:undici|@sigstore\/(?:bundle|protobuf-specs|verify)|@napi-rs\/keyring)\//u;

async function loadsOf(bin: string, args: readonly string[]): Promise<readonly string[]> {
  const out = join(await mkdtemp(join(tmpdir(), 'revition-loads-')), 'loads.txt');
  const nodeOptions = `${(process.env['NODE_OPTIONS'] ?? '').replace(/--import=\S*telemetry-spy\.mjs/u, '').trim()} --import=${RECORDER}`;
  const r = await runCli(bin, args, { env: { NODE_OPTIONS: nodeOptions.trim(), REVITION_RECORD_LOADS: out } });
  assert.equal(r.code, 0, r.stderr);
  return (await readFile(out, 'utf8')).split('\n').filter((u) => u !== '');
}

// CI runs these with the suite; the timing budget itself is the isolated "Startup budget" step (fixture-plugin.test.ts).
describe('[CLI-T1.1.1-AC6] the startup path loads only what --version / --help need', () => {
  it('[CLI-T1.1.1-AC6] oclif\'s own version/help rule: version flag first, help flag before --, or no arguments', () => {
    assert.equal(infoOnlyRun([]), true);
    assert.equal(infoOnlyRun(['--version']), true);
    assert.equal(infoOnlyRun(['--help']), true);
    assert.equal(infoOnlyRun(['config:set', '--help']), true);
    assert.equal(infoOnlyRun(['-v'], { additionalVersionFlags: ['-v'] }), true);
    assert.equal(infoOnlyRun(['config:get', '-h'], { additionalHelpFlags: ['-h'] }), true);
    // A command run: the setup (services, Ctrl-C, update notice) is needed.
    assert.equal(infoOnlyRun(['config:get', 'host']), false);
    assert.equal(infoOnlyRun(['config:get', '--version']), false, 'a version flag after a command is the command\'s');
    assert.equal(infoOnlyRun(['plugins:run', '--', '--help']), false, 'after -- the flag is the plugin\'s argument');
    assert.equal(infoOnlyRun(['-h']), false, 'not a help flag unless the CLI declares it');
  });

  it('[CLI-T1.1.1-AC6] `revition --version` loads neither the full core nor the lazy libraries', async () => {
    const loads = await loadsOf(CLI_BIN, ['--version']);
    assert.ok(loads.some((u) => u.includes('@oclif/core')), 'the recorder saw the run');
    assert.deepEqual(loads.filter((u) => FULL_CORE.test(u) || LAZY.test(u)), []);
  });

  it('[CLI-T1.1.1-AC6] `revition --help` loads neither the full core nor the lazy libraries', async () => {
    const loads = await loadsOf(CLI_BIN, ['--help']);
    assert.ok(loads.some((u) => u.endsWith('/dist/help.js')), 'the help class ran');
    assert.deepEqual(loads.filter((u) => FULL_CORE.test(u) || LAZY.test(u)), []);
  });

  it('[CLI-T1.1.1-AC6] control: a command run DOES load the core (the setup is only skipped for version/help)', async () => {
    const loads = await loadsOf(FIXTURE_RUN, ['fixture', 'hello']);
    assert.ok(loads.some((u) => FULL_CORE.test(u)), 'a command run loads the core');
  });
});
