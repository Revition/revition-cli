import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { cliDirs, cliPathsOf, type CliDirs } from './test-fixtures/cli-dirs.js';
import { startMockAuth } from './test-fixtures/mock-auth.js';
import { CLI_BIN, FIXTURE_RUN, runCli } from './test-fixtures/spawn-cli.js';

const PAT = `rvt_${'B'.repeat(40)}`;

interface Dirs extends CliDirs {
  readonly [key: string]: string;
  readonly root: string;
}

async function dirs(): Promise<Dirs> {
  const root = await mkdtemp(join(tmpdir(), 'revlife-'));
  return { root, ...cliDirs(root) };
}

/** Writes the delivered flag cache where the CLI reads it on this OS. */
async function writeFlagCache(d: Dirs, flags: Record<string, boolean>): Promise<void> {
  const { cacheDir } = cliPathsOf(d);
  await mkdir(cacheDir, { recursive: true });
  await writeFile(join(cacheDir, 'flags-default.json'), JSON.stringify({ fetchedAt: Date.now(), ttl: 3600, flags }));
}

async function until(check: () => boolean, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return check();
}

describe('Set 4 lifecycle through the real CLI', () => {
  it('[CLI-T1.4.1-AC1] the update check adds ~0 ms: it returns at once and the slow registry is read in the background', async () => {
    let served = 0;
    const slow = http.createServer((req, res) => {
      setTimeout(() => {
        served++;
        const body = (req.url ?? '').includes('dist-tags') ? { latest: '9.9.9' } : {};
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      }, 1500);
    });
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
    const d = await dirs();
    const saved = { ...process.env };
    Object.assign(process.env, d, { npm_config_registry: `http://127.0.0.1:${(slow.address() as AddressInfo).port}` });
    try {
      // The BUILT module (what ships), named through a variable so the typecheck, which runs before the build, never
      // resolves dist; the type is the source module's.
      const builtModule = '../dist/update-notifier.js';
      const { scheduleUpdateCheck } = (await import(builtModule)) as typeof import('./update-notifier.js');
      const started = performance.now();
      assert.equal(await scheduleUpdateCheck([], '0.1.0', process.env, true), true);
      const spent = performance.now() - started;
      assert.ok(spent < 100, `scheduling took ${spent.toFixed(1)} ms with a 1.5 s registry`);
      // The background check itself is measured separately: it completes and writes the cache.
      assert.ok(await until(() => existsSync(join(cliPathsOf(d).cacheDir, 'update.json'))), 'the background check never wrote its cache');
      assert.ok(served >= 1);
    } finally {
      process.env = saved;
      slow.close();
      slow.closeAllConnections();
    }
  });

  it('[CLI-T1.4.1-AC4] a 426 from the platform gives exit 10 with the server message and `revition upgrade`', async () => {
    const mock = await startMockAuth({ upgradeRequired: true });
    try {
      const r = await runCli(CLI_BIN, ['whoami'], { env: { ...(await dirs()), REVITION_HOST: mock.apiHost, REVITION_TOKEN: PAT } });
      assert.equal(r.code, 10);
      assert.match(r.stderr, /This CLI is too old: upgrade to 0\.2\.0 or later\./);
      assert.match(r.stderr, /revition upgrade/);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.4.2-AC1] [CLI-T1.4.2-AC2] without an opt-in (or with DO_NOT_TRACK=1 over config on) zero telemetry calls', async () => {
    const mock = await startMockAuth();
    try {
      const off = { ...(await dirs()), REVITION_HOST: mock.apiHost, REVITION_TOKEN: PAT };
      for (const args of [['whoami'], ['token', 'list'], ['config', 'list']]) await runCli(CLI_BIN, args, { env: off });
      const dnt = { ...(await dirs()), REVITION_HOST: mock.apiHost, REVITION_TOKEN: PAT, DO_NOT_TRACK: '1' };
      assert.equal((await runCli(CLI_BIN, ['telemetry', 'enable'], { env: dnt })).code, 0);
      for (const args of [['whoami'], ['token', 'list']]) await runCli(CLI_BIN, args, { env: dnt });
      await new Promise((r) => setTimeout(r, 1500));
      assert.deepEqual(mock.apiLog.filter((r) => r.path.endsWith('/dev/cli/telemetry')), []);
      assert.equal(existsSync(join(cliPathsOf(dnt).stateDir, 'telemetry-queue.json')), false);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.4.2-AC4] [CLI-T1.4.2-AC3] after opting in, show-last equals exactly the payload the platform received (flag names only)', async () => {
    const mock = await startMockAuth();
    try {
      // This run opts in on purpose (the suite-wide telemetry spy, CLI-T1.4.2-AC1, counts it as allowed).
      const env = { ...(await dirs()), REVITION_HOST: mock.apiHost, REVITION_TOKEN: PAT, REVITION_TEST_TELEMETRY_OPTIN: '1' };
      assert.equal((await runCli(CLI_BIN, ['telemetry', 'enable'], { env })).code, 0);
      assert.equal((await runCli(CLI_BIN, ['whoami', '--profile', 'default'], { env })).code, 0);
      const postedEvents = (): Array<Record<string, unknown>> =>
        mock.apiLog
          .filter((r) => r.path.endsWith('/dev/cli/telemetry'))
          .flatMap((r) => (JSON.parse(r.body) as { events: Array<Record<string, unknown>> }).events);
      // Both runs (the opt-in itself and whoami) are counted; wait until the whoami batch has arrived too.
      assert.ok(await until(() => postedEvents().some((e) => e['command'] === 'whoami')), 'the whoami event was never sent');
      await new Promise((r) => setTimeout(r, 300));
      const posted = postedEvents();
      const shown = JSON.parse((await runCli(CLI_BIN, ['telemetry', 'show-last', '--json'], { env })).stdout).data.events as Array<Record<string, unknown>>;
      assert.deepEqual(shown, posted);
      const whoamiEvent = shown.find((e) => e['command'] === 'whoami');
      assert.deepEqual(whoamiEvent?.['flagsUsed'], ['profile']);
      assert.doesNotMatch(JSON.stringify(posted), /default|rvt_|auth0\|/);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.4.3-AC1] [CLI-T1.4.3-AC2] a flagged command is hidden and refused while the flag is off, and works when on', async () => {
    const off = await dirs();
    const help = await runCli(FIXTURE_RUN, ['fixture', '--help'], { env: off });
    assert.doesNotMatch(help.stdout, /fixture flagged/);
    const refused = await runCli(FIXTURE_RUN, ['fixture', 'flagged'], { env: off });
    assert.equal(refused.code, 4);
    assert.match(refused.stderr, /not available on your account yet/);
    // the client's cache says on (the server delivered it): visible and runs
    const on = await dirs();
    await writeFlagCache(on, { 'cli.fixture': true });
    assert.match((await runCli(FIXTURE_RUN, ['fixture', '--help'], { env: on })).stdout, /fixture flagged/);
    assert.equal((await runCli(FIXTURE_RUN, ['fixture', 'flagged'], { env: on })).code, 0);
    // AC2: the server turned it on but this client's cache still says off: the client still hides it
    const stale = await dirs();
    await writeFlagCache(stale, { 'cli.fixture': false });
    assert.doesNotMatch((await runCli(FIXTURE_RUN, ['fixture', '--help'], { env: stale })).stdout, /fixture flagged/);
  });

  it('[CLI-T1.4.3-AC4] experimental commands need the opt-in (REVITION_EXPERIMENTAL=1 or --experimental)', async () => {
    const d = await dirs();
    assert.equal((await runCli(FIXTURE_RUN, ['fixture', 'lab'], { env: d })).code, 2);
    assert.equal((await runCli(FIXTURE_RUN, ['fixture', 'lab', '--experimental'], { env: d })).code, 0);
    assert.equal((await runCli(FIXTURE_RUN, ['fixture', 'lab'], { env: { ...d, REVITION_EXPERIMENTAL: '1' } })).code, 0);
  });
});
