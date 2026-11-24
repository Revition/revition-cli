import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { isEnvelope } from '@revition/cli-core';

import { CLI_BIN, FIXTURE_RUN, runCli } from './test-fixtures/spawn-cli.js';

const CORE_SRC = fileURLToPath(new URL('../../core/src', import.meta.url));

describe('T1.1.1 a command is a module: the fixture plugin', () => {
  it('[CLI-T1.1.1-AC5] a sample command module runs with no change in packages/core', async () => {
    const r = await runCli(FIXTURE_RUN, ['fixture', 'hello']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, 'hello from a module the core never saw\n');
    const json = await runCli(FIXTURE_RUN, ['fixture', 'hello', '--json']);
    const doc = JSON.parse(json.stdout) as unknown;
    assert.ok(isEnvelope(doc));
    assert.deepEqual((doc as { data: unknown }).data, { greeting: 'hello from a module the core never saw' });
    // The fixture lives outside packages/core, and nothing in core names it.
    const coreFiles = await readdir(CORE_SRC, { recursive: true });
    assert.ok(!coreFiles.some((f) => String(f).includes('fixture')), 'core must not know the fixture');
  });

  it('[CLI-T1.1.1-AC2] a mutating command without --yes and with --no-input exits 2 with guidance', async () => {
    const r = await runCli(FIXTURE_RUN, ['fixture', 'delete', '--no-input']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /needs confirmation/);
    assert.match(r.stderr, /--yes/);
    assert.equal(r.stdout, '');
    const json = await runCli(FIXTURE_RUN, ['fixture', 'delete', '--json']);
    assert.equal(json.code, 2);
    assert.equal(JSON.parse(json.stdout).error.code, 'CONFIRMATION_REQUIRED');
    const yes = await runCli(FIXTURE_RUN, ['fixture', 'delete', '--no-input', '--yes', '--json']);
    assert.equal(yes.code, 0, yes.stderr);
    assert.deepEqual(JSON.parse(yes.stdout).data, { deleted: true });
  });

  it('[CLI-T1.1.1-AC3] an experimental command without its flag is hidden from help and refuses to run', async () => {
    const help = await runCli(FIXTURE_RUN, ['fixture', '--help']);
    assert.match(help.stdout, /fixture hello/);
    assert.doesNotMatch(help.stdout, /fixture lab/);
    const optedHelp = await runCli(FIXTURE_RUN, ['fixture', '--help'], { env: { REVITION_EXPERIMENTAL: '1' } });
    assert.match(optedHelp.stdout, /fixture lab/);

    const refused = await runCli(FIXTURE_RUN, ['fixture', 'lab']);
    assert.equal(refused.code, 2);
    assert.match(refused.stderr, /experimental/);
    assert.match(refused.stderr, /--experimental/);
    assert.equal((await runCli(FIXTURE_RUN, ['fixture', 'lab', '--experimental'])).code, 0);
    assert.equal((await runCli(FIXTURE_RUN, ['fixture', 'lab'], { env: { REVITION_EXPERIMENTAL: '1' } })).code, 0);
  });

  // A latency budget is measured ALONE: inside the parallel suite (node --test runs every file at once) the timing is
  // the runner's CPU contention, not the CLI's startup. CI runs it as its own step (ci.yml "Startup budget",
  // REVITION_STARTUP_BUDGET=1, --test-concurrency=1); the parallel suite skips it.
  it('[CLI-T1.1.1-AC6] startup within budget: --version and --help under 300 ms (this OS; the CI matrix runs the others)', {
    skip: process.env['REVITION_STARTUP_BUDGET'] === '1' ? false : 'measured in isolation (REVITION_STARTUP_BUDGET=1, its own CI step)',
  }, async () => {
    // Warm the module cache once, then measure the median of 5 runs of each. The CLI is timed as a user runs it: the
    // suite-wide telemetry spy (a TEST-ONLY preload in NODE_OPTIONS, scripts/test-all.mjs) is left out of these runs.
    const env = { NODE_OPTIONS: (process.env['NODE_OPTIONS'] ?? '').replace(/--import=\S*telemetry-spy\.mjs/u, '').trim() };
    await runCli(CLI_BIN, ['--version'], { env });
    for (const args of [['--version'], ['--help']]) {
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await runCli(CLI_BIN, args, { env });
        assert.equal(r.code, 0, r.stderr);
        runs.push(r.ms);
      }
      const median = runs.sort((a, b) => a - b)[2] ?? Infinity;
      assert.ok(median <= 300, `${args.join(' ')} median ${median.toFixed(0)} ms > 300 ms`);
    }
  });

  it('[CLI-T1.1.1-AC6] Ctrl-C during a long command exits 11 within 200 ms', async () => {
    let sentAt = 0;
    const r = await runCli(FIXTURE_RUN, ['fixture', 'wait'], {
      onStderr: (chunk, kill) => {
        if (sentAt === 0 && chunk.includes('waiting')) {
          sentAt = performance.now();
          kill('SIGINT');
        }
      },
    });
    const elapsed = performance.now() - sentAt;
    assert.ok(sentAt > 0, 'the command never started');
    assert.equal(r.code, 11);
    assert.ok(elapsed <= 200, `exit took ${elapsed.toFixed(0)} ms after SIGINT`);
  });
});
