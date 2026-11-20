import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { flagCacheFile, loadFlags, readFlagCache } from '../flags/flags.js';
import { buildEvent, flagNames, flushQueue, enqueue, lastSent, telemetryEnabled, telemetryForcedOff, TelemetryEvent } from '../telemetry/telemetry.js';
import { ApiClient } from '../transport/client.js';

import { readUpdateCache } from './cache.js';
import { channelOf, isNewer, runUpdateCheck, updateCheckAllowed, updateNotice } from './check.js';
import { detectInstaller, runUpgrade, upgradeCommand } from './installer-detect.js';

async function registry(handler: (path: string) => { status: number; body: unknown }): Promise<string> {
  const s = http.createServer((req, res) => {
    const r = handler(req.url ?? '');
    res.writeHead(r.status, { 'content-type': 'application/json' }).end(JSON.stringify(r.body));
  });
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  s.unref();
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

const NOW = new Date('2026-11-18T10:00:00.000Z');

describe('Set 4 lifecycle (core)', () => {
  it('[CLI-T1.4.1-AC2] the notifier is suppressed with --json, in CI, on a non-TTY stderr and when turned off', () => {
    const ok = { json: false, env: {}, stderrIsTTY: true, configUpdateCheck: true };
    assert.equal(updateCheckAllowed(ok), true);
    assert.equal(updateCheckAllowed({ ...ok, json: true }), false);
    assert.equal(updateCheckAllowed({ ...ok, env: { CI: 'true' } }), false);
    assert.equal(updateCheckAllowed({ ...ok, env: { GITHUB_ACTIONS: 'true' } }), false);
    assert.equal(updateCheckAllowed({ ...ok, stderrIsTTY: false }), false);
    assert.equal(updateCheckAllowed({ ...ok, env: { REVITION_NO_UPDATE_CHECK: '1' } }), false);
    assert.equal(updateCheckAllowed({ ...ok, configUpdateCheck: false }), false);
  });

  it('[CLI-T1.4.1-AC3] upgrade runs exactly the package-manager command, never another binary', async () => {
    assert.equal(detectInstaller('/usr/local/lib/node_modules/@revition/cli'), 'npm');
    assert.equal(detectInstaller('/Users/u/Library/pnpm/global/5/node_modules/@revition/cli'), 'pnpm');
    assert.equal(detectInstaller('/Users/u/.config/yarn/global/node_modules/@revition/cli'), 'yarn');
    assert.equal(detectInstaller('/Users/u/.bun/install/global/node_modules/@revition/cli'), 'bun');
    assert.equal(detectInstaller('/opt/revition/standalone'), 'unknown');
    assert.equal(upgradeCommand('unknown', 'latest'), null);
    const calls: Array<{ cmd: string; args: readonly string[]; shell: boolean }> = [];
    const spy = (cmd: string, args: readonly string[], opts: { shell: boolean }) => {
      calls.push({ cmd, args, shell: opts.shell });
      return { on: (ev: string, cb: (a?: unknown) => void) => (ev === 'close' ? setImmediate(() => cb(0)) : undefined) };
    };
    const cmd = upgradeCommand('npm', 'next');
    assert.ok(cmd !== null);
    assert.equal(await runUpgrade(cmd, spy, 'darwin'), 0);
    assert.equal(await runUpgrade(upgradeCommand('pnpm', 'latest') ?? cmd, spy, 'win32'), 0);
    assert.deepEqual(calls, [
      { cmd: 'npm', args: ['install', '--global', '@revition/cli@next'], shell: false },
      { cmd: 'pnpm.cmd', args: ['add', '--global', '@revition/cli@latest'], shell: true },
    ]);
  });

  it('[CLI-T1.1.3-AC1] [CLI-T1.4.1-AC3] the package manager never writes to the CLI stdout (one --json envelope)', async () => {
    // L3 on the installed CLI (2026-11-18): with stdio 'inherit', npm's "added 1 package" landed on stdout before the
    // envelope. The child's stdout and stderr both go to the CLI's stderr (fd 2); stdin stays shared for prompts.
    const seen: unknown[] = [];
    const spy = (_c: string, _a: readonly string[], opts: { stdio: unknown; shell: boolean }) => {
      seen.push(opts.stdio);
      return { on: (ev: string, cb: (a?: unknown) => void) => (ev === 'close' ? setImmediate(() => cb(0)) : undefined) };
    };
    const cmd = upgradeCommand('npm', 'latest');
    assert.ok(cmd !== null);
    await runUpgrade(cmd, spy, 'darwin');
    await runUpgrade(cmd, spy, 'win32');
    assert.deepEqual(seen, [
      [0, 2, 2],
      [0, 2, 2],
    ]);
  });

  it('[CLI-T1.4.2-AC2] DO_NOT_TRACK / REVITION_TELEMETRY=0 force telemetry off (the consent question is then never asked)', () => {
    for (const env of [{ DO_NOT_TRACK: '1' }, { DO_NOT_TRACK: 'true' }, { REVITION_TELEMETRY: '0' }, { REVITION_TELEMETRY: 'off' }, { REVITION_TELEMETRY: 'FALSE' }]) {
      assert.equal(telemetryForcedOff(env), true, JSON.stringify(env));
      assert.equal(telemetryEnabled(env, 'on'), false, JSON.stringify(env));
    }
    for (const env of [{}, { DO_NOT_TRACK: '' }, { DO_NOT_TRACK: '0' }, { REVITION_TELEMETRY: '1' }]) {
      assert.equal(telemetryForcedOff(env), false, JSON.stringify(env));
    }
  });

  it('[CLI-T1.4.1-AC5] a deprecated installed version gets a warning (mock registry); a newer one gets the update notice', async () => {
    const base = await registry((path) =>
      path.startsWith('/-/package/@revition/cli/dist-tags')
        ? { status: 200, body: { latest: '1.5.0', next: '1.6.0-next.1' } }
        : path === '/@revition/cli/1.4.2'
          ? { status: 200, body: { name: '@revition/cli', version: '1.4.2', deprecated: 'This version leaks nothing but is old: upgrade to 1.5.' } }
          : { status: 404, body: {} }
    );
    const cacheDir = await mkdtemp(join(tmpdir(), 'revupd-'));
    const c = await runUpdateCheck({ installedVersion: '1.4.2', cacheDir, env: { npm_config_registry: base }, now: NOW.getTime() });
    assert.deepEqual([c.latest, c.channel], ['1.5.0', 'latest']);
    assert.deepEqual(await readUpdateCache(cacheDir), c);
    const notice = updateNotice(c, '1.4.2') ?? '';
    assert.match(notice, /warn revition 1\.4\.2 is deprecated: This version leaks nothing but is old/);
    assert.match(notice, /Update available 1\.4\.2 -> 1\.5\.0 \(stable\)\. Run: revition upgrade/);
    assert.equal(updateNotice({ ...c, deprecated: null, latest: '1.4.2' }, '1.4.2'), null);
    assert.equal(channelOf('1.6.0-next.1'), 'next');
    assert.equal(isNewer('1.10.0', '1.9.9'), true);
    assert.equal(isNewer('1.5.0', '1.5.0-next.1'), true);
    // offline: silently skipped (no throw), latest unknown
    const offline = await runUpdateCheck({ installedVersion: '1.4.2', cacheDir, env: { npm_config_registry: 'http://127.0.0.1:9' }, now: NOW.getTime() });
    assert.equal(offline.latest, null);
  });

  it('[CLI-T1.4.2-AC2] DO_NOT_TRACK=1 beats config on; unset is off', () => {
    assert.equal(telemetryEnabled({}, 'on'), true);
    assert.equal(telemetryEnabled({ DO_NOT_TRACK: '1' }, 'on'), false);
    assert.equal(telemetryEnabled({ REVITION_TELEMETRY: '0' }, 'on'), false);
    assert.equal(telemetryEnabled({}, 'unset'), false);
    assert.equal(telemetryEnabled({}, 'off'), false);
  });

  it('[CLI-T1.4.2-AC3] an event with a value-bearing flag records the flag name only', () => {
    const argv = ['--profile', 'work-secret', '--name=very-secret-value', '-y', '--json', 'positional-secret'];
    assert.deepEqual(flagNames(argv), ['json', 'name', 'profile', 'y']);
    const e = buildEvent({
      installId: '7b0e7b8e-1b1a-4a54-9d0b-36f1a6a4e0a1',
      cliVersion: '0.1.0',
      platform: 'darwin',
      nodeVersion: 'v22.22.3',
      command: 'token:create',
      argv,
      exitCode: 0,
      durationMs: 12.4,
      env: {},
      now: NOW,
    });
    assert.ok(e !== null);
    TelemetryEvent.parse(e);
    assert.doesNotMatch(JSON.stringify(e), /secret/);
    assert.deepEqual(e.flagsUsed, ['json', 'name', 'profile', 'y']);
  });

  it('[CLI-T1.4.2-AC4] show-last equals the payloads that were sent', async () => {
    const state = await mkdtemp(join(tmpdir(), 'revtel-'));
    const make = (command: string) =>
      buildEvent({ installId: '7b0e7b8e-1b1a-4a54-9d0b-36f1a6a4e0a1', cliVersion: '0.1.0', platform: 'linux', nodeVersion: 'v22.1.0', command, argv: [], exitCode: 0, durationMs: 1, env: {}, now: NOW });
    await enqueue(state, make('apps:list') as TelemetryEvent);
    await enqueue(state, make('whoami') as TelemetryEvent);
    const sent: unknown[] = [];
    assert.equal(await flushQueue(state, async (p) => void sent.push(p)), 2);
    assert.deepEqual(await lastSent(state), (sent[0] as { events: unknown[] }).events);
    assert.equal(await flushQueue(state, async (p) => void sent.push(p)), 0, 'the queue is empty after a send');
  });

  it('[CLI-T1.4.3-AC3] the offline path uses the cache; no cache = defaults (all off)', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'revflag-'));
    const offline = new ApiClient({ host: '127.0.0.1:9', token: async () => 'rvt_x', cliVersion: '0.1.0', retries: 0 }, { env: {} });
    assert.deepEqual(await loadFlags({ client: offline, cacheDir, profile: 'default', version: '0.1.0', channel: 'latest', now: NOW.getTime() }), {});
    await writeFile(flagCacheFile(cacheDir, 'default'), JSON.stringify({ fetchedAt: NOW.getTime() - 7200_000, ttl: 3600, flags: { 'cli.x': true } }));
    assert.deepEqual(await loadFlags({ client: offline, cacheDir, profile: 'default', version: '0.1.0', channel: 'latest', now: NOW.getTime() }), { 'cli.x': true });
    const server = await registry(() => ({ status: 200, body: { flags: { 'cli.x': false, 'cli.y': true }, ttl: 60 } }));
    const online = new ApiClient({ host: new URL(server).host, token: async () => 'rvt_x', cliVersion: '0.1.0' }, { env: {} });
    assert.deepEqual(await loadFlags({ client: online, cacheDir, profile: 'default', version: '0.1.0', channel: 'latest', now: NOW.getTime() }), { 'cli.x': false, 'cli.y': true });
    assert.equal(readFlagCache(cacheDir, 'default')?.ttl, 60);
  });
});
