import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { infoOnlyRun } from './startup-path.js';
import { CLI_BIN, FIXTURE_RUN, runCli } from './test-fixtures/spawn-cli.js';

/** A file: URL: a Windows path is not a valid --import specifier (ERR_UNSUPPORTED_ESM_URL_SCHEME, PR #11 run 45564271218). */
const RECORDER = new URL('./test-fixtures/record-loads.mjs', import.meta.url).href;
/** bin/run's start before the startup bundle (unbundled @oclif/core), and the help-class parity child. */
const UNBUNDLED_RUN = fileURLToPath(new URL('./test-fixtures/unbundled-run.mjs', import.meta.url));
const HELP_PARITY = fileURLToPath(new URL('./test-fixtures/help-parity.mjs', import.meta.url));
/** The full core entry and the libraries that load only on first use (packages/core/src/lazy-deps.ts LAZY_PACKAGES). */
const FULL_CORE = /\/packages\/core\/dist\/index\.js$|\/@revition\/cli-core\/dist\/index\.js$/u;
const LAZY = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:undici|@sigstore\/(?:bundle|protobuf-specs|verify)|@napi-rs\/keyring)\//u;
/** The schema library: ~95 modules, 317 ms --help median on macOS CI (PR #11 run 45569816900). The flag cache that
 * --help reads is checked without it (core flags/flag-cache.ts). */
const ZOD = /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?zod\//u;

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

  it('[CLI-T1.1.1-AC6] `revition --version` loads neither the full core, the lazy libraries nor zod', async () => {
    const loads = await loadsOf(CLI_BIN, ['--version']);
    assert.ok(loads.length > 0, 'the recorder saw the run');
    assert.deepEqual(loads.filter((u) => FULL_CORE.test(u) || LAZY.test(u) || ZOD.test(u)), []);
    // bin/run's fast path: off Linux, --version loads no oclif at all (Linux keeps oclif for its WSL platform name).
    if (process.platform !== 'linux') assert.deepEqual(loads.filter((u) => u.includes('@oclif/core')), []);
  });

  it('[CLI-T1.1.1-AC6] the --version fast path prints exactly the line oclif prints (its config.userAgent)', async () => {
    const r = await runCli(CLI_BIN, ['--version']);
    assert.equal(r.code, 0, r.stderr);
    const { Config } = await import('@oclif/core');
    const config = await Config.load(pathToFileURL(CLI_BIN).href);
    assert.equal(r.stdout, `${config.userAgent}\n`);
  });

  it('[CLI-T1.1.1-AC6] `revition --help` loads neither the full core, the lazy libraries nor zod', async () => {
    const loads = await loadsOf(CLI_BIN, ['--help']);
    assert.deepEqual(loads.filter((u) => FULL_CORE.test(u) || LAZY.test(u) || ZOD.test(u)), []);
  });

  // windows-latest: --help 537 ms median through ~110 module files (PR #11). The root help now runs oclif, the help
  // class and the flag cache it reads from ONE bundled file (scripts/bundle-startup.mjs, as oclif's plugin-test-esbuild).
  it('[CLI-T1.1.1-AC6] the root help runs from the startup bundle: no @oclif/core module file is loaded', async () => {
    for (const args of [['--help'], []]) {
      const loads = await loadsOf(CLI_BIN, args);
      assert.ok(loads.some((u) => u.endsWith('/dist/bundle/startup.js')), `the bundle ran (${args.join(' ')})`);
      assert.deepEqual(loads.filter((u) => u.includes('/@oclif/core/')), [], args.join(' '));
      // bin/run, the bundle, and the init hook with its two imports (unbundled ~113 module files, macOS).
      const files = loads.filter((u) => u.startsWith('file:'));
      assert.ok(files.length <= 6, `${files.length} module files: ${files.join(', ')}`);
    }
  });

  it('[CLI-T1.1.1-AC6] the bundle changes no output: --help, no arguments and --version byte-identical to unbundled oclif', async () => {
    for (const args of [['--help'], [], ['--version']]) {
      const bundled = await runCli(CLI_BIN, args);
      const unbundled = await runCli(UNBUNDLED_RUN, args);
      assert.deepEqual([bundled.code, bundled.stdout, bundled.stderr], [unbundled.code, unbundled.stdout, unbundled.stderr], args.join(' '));
      assert.notEqual(bundled.stdout, '', args.join(' '));
    }
  });

  it('[CLI-T1.1.1-AC6] the help of the root, every topic and every command (plugins included) is unchanged by the bundled help class', async () => {
    const r = await runCli(HELP_PARITY, []);
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout) as { cases: number; commands: number; mismatches: unknown[] };
    assert.ok(out.commands >= 90, `${out.commands} commands loaded (the CLI and its 4 plugins)`);
    assert.deepEqual(out.mismatches, [], `${out.mismatches.length} of ${out.cases} help pages differ`);
  });

  it('[CLI-T1.1.1-AC6] control: a command run DOES load the core (the setup is only skipped for version/help)', async () => {
    const loads = await loadsOf(FIXTURE_RUN, ['fixture', 'hello']);
    assert.ok(loads.some((u) => FULL_CORE.test(u)), 'a command run loads the core');
  });
});
