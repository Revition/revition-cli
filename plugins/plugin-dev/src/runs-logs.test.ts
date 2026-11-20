import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { follow, FOLLOW_MAX_MS, FOLLOW_MIN_MS, grepLines, logLines, type LogBundle, type RunSummary } from './commands/logs.js';
import { filterRuns, parseDuration } from './commands/runs/list.js';
import { CLI_BIN, PAT, dirs, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

const run = (id: string, at: string, okv = true, kind: RunSummary['kind'] = 'execution'): RunSummary => ({ runId: id, kind, at, ok: okv, label: `run ${id}` });
const bundle = (id: string, extra: Partial<LogBundle> = {}): LogBundle => ({
  runId: id,
  kind: 'execution',
  build: [],
  exec: [{ at: '2026-11-18T03:04:05.000Z', node: 'tool.invoke', status: 'ok', durationMs: 12, attributes: { status: 'ok', tool: 'orders', durationMs: 12 } }],
  errors: [],
  eval: [],
  withheld: 0,
  notes: [],
  ...extra,
});

describe('T2.4.1 logs: the portal rendering', () => {
  it('[CLI-T2.4.1-AC1] the lines are the portal LogBundle: notes, build, execution (details without status/durationMs), errors with frames, eval, withheld', () => {
    const b = bundle('r1', {
      build: ['hello: compiled'],
      errors: [{ at: 'x', kind: 'TypeError: x is undefined', frames: ['capabilities/hello/run.ts:3'] }],
      eval: ['task_success 0.75'],
      withheld: 2,
      notes: ['Sense is not connected in this deployment'],
    });
    assert.deepEqual(logLines(b), [
      'run r1 (execution)',
      '  Sense is not connected in this deployment.',
      'Build log',
      '  hello: compiled',
      'Execution',
      '  03:04:05 tool.invoke ok 12 ms tool=orders',
      'Errors',
      '  TypeError: x is undefined',
      '    capabilities/hello/run.ts:3',
      'Eval log',
      '  task_success 0.75',
      "2 fields were withheld: you see a run's execution metadata, never a customer's data.",
    ]);
    assert.deepEqual(logLines(bundle('r2', { exec: [] })), ['run r2 (execution)', '  This run has no logs.']);
  });

  it('edge: withheld events: the count and the notes, never guessed content', () => {
    const lines = logLines(bundle('r3', { exec: [], withheld: 1, notes: ['customer content withheld'] }));
    assert.ok(lines.includes("1 field was withheld: you see a run's execution metadata, never a customer's data."));
    assert.ok(lines.includes('  customer content withheld.'));
  });

  it('--grep keeps the matching lines under the run header; no match = nothing', () => {
    const lines = logLines(bundle('r4'));
    assert.deepEqual(grepLines(lines, 'ORDERS'), ['run r4 (execution)', '  03:04:05 tool.invoke ok 12 ms tool=orders']);
    assert.deepEqual(grepLines(lines, 'nothing-like-this'), []);
  });
});

describe('T2.4.1 logs --follow', () => {
  it('[CLI-T2.4.1-AC2] a new run prints once: no duplicates across polls; existing runs are the baseline; backoff 5 s -> 30 s when idle', async () => {
    const polls: RunSummary[][] = [
      [run('old', '2026-11-18T01:00:00Z')],
      [run('a', '2026-11-18T02:00:00Z'), run('old', '2026-11-18T01:00:00Z')],
      [run('a', '2026-11-18T02:00:00Z'), run('old', '2026-11-18T01:00:00Z')],
      [run('c', '2026-11-18T02:02:00Z'), run('b', '2026-11-18T02:01:00Z'), run('a', '2026-11-18T02:00:00Z'), run('old', '2026-11-18T01:00:00Z')],
      [run('c', '2026-11-18T02:02:00Z'), run('b', '2026-11-18T02:01:00Z'), run('a', '2026-11-18T02:00:00Z')],
      [run('c', '2026-11-18T02:02:00Z')],
      [run('c', '2026-11-18T02:02:00Z')],
      [run('c', '2026-11-18T02:02:00Z')],
    ];
    let i = 0;
    const emitted: string[] = [];
    const fetched: string[] = [];
    const waits: number[] = [];
    const printed = await follow(
      {
        listRuns: () => Promise.resolve(polls[Math.min(i++, polls.length - 1)] ?? []),
        logs: (id) => {
          fetched.push(id);
          return Promise.resolve(bundle(id));
        },
        emit: (r) => emitted.push(r.runId),
        sleep: (ms) => {
          waits.push(ms);
          return Promise.resolve();
        },
      },
      polls.length - 1
    );
    assert.deepEqual(emitted, ['a', 'b', 'c']);
    assert.deepEqual(printed, ['a', 'b', 'c']);
    assert.deepEqual(fetched, ['a', 'b', 'c']);
    assert.deepEqual(waits, [FOLLOW_MIN_MS, FOLLOW_MIN_MS, 10_000, FOLLOW_MIN_MS, 10_000, 20_000, FOLLOW_MAX_MS]);
  });
});

describe('T2.4.1 runs list', () => {
  it('--ok / --failed / --since filter the server list locally; a bad duration is a usage error', () => {
    const now = Date.parse('2026-11-18T12:00:00Z');
    const runs = [run('new-ok', '2026-11-18T11:30:00Z'), run('new-bad', '2026-11-18T11:00:00Z', false), run('old', '2026-11-10T00:00:00Z')];
    assert.deepEqual(filterRuns(runs, { ok: false, failed: true, sinceMs: null, nowMs: now }).map((r) => r.runId), ['new-bad']);
    assert.deepEqual(filterRuns(runs, { ok: true, failed: false, sinceMs: parseDuration('1h'), nowMs: now }).map((r) => r.runId), ['new-ok']);
    assert.deepEqual(filterRuns(runs, { ok: false, failed: false, sinceMs: parseDuration('7d'), nowMs: now }).length, 2);
    assert.throws(() => parseDuration('soon'), /not a duration/);
  });
});

async function linked(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'logs-'));
  const f = join(dir, '.revition/project.json');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ schemaVersion: 1, appId: 'dapp_mine', projectId: 'dproj_1' }));
  return dir;
}

function platform(): Promise<MockPlatform> {
  let polls = 0;
  return startMockPlatform((method, path) => {
    if (method === 'GET' && path === '/dev/apps/dapp_mine/runs') {
      polls += 1;
      const base = [run('build:1.0.0', '2026-11-18T01:00:00Z', true, 'build')];
      // A run appears after the first poll, with a secret-shaped value in its logs (redaction applies).
      return ok({ runs: polls > 1 ? [run('exec_1', '2026-11-18T02:00:00Z'), ...base] : base, notes: [] });
    }
    const logs = /^\/dev\/apps\/dapp_mine\/runs\/([^/]+)\/logs$/.exec(path);
    if (method === 'GET' && logs !== null) {
      // `authorization: ...` is redacted to the END OF THE LINE: on a serialized NDJSON line it would eat the JSON's own
      // quotes and braces, so each value must be redacted before serialization.
      return ok(bundle(decodeURIComponent(logs[1] ?? ''), { eval: [`token ${PAT}`, 'authorization: Basic dXNlcjpwYXNz'] }));
    }
    return null;
  });
}

describe('T2.4.1 through the real CLI', () => {
  it('[CLI-T2.4.1-AC1] logs <runId> and runs list read the platform routes; output is redacted', async () => {
    const p = await platform();
    try {
      const cwd = await linked();
      const env = await dirs();
      const l = await runCli(['logs', 'build:1.0.0'], { cwd, host: p.host, env });
      assert.equal(l.code, 0, l.stderr);
      assert.match(l.stdout, /^run build:1\.0\.0 \(execution\)/);
      assert.doesNotMatch(l.stdout, /rvt_P{10}/);
      assert.ok(p.log.some((x) => x.path === '/dev/apps/dapp_mine/runs/build%3A1.0.0/logs' || x.path === '/dev/apps/dapp_mine/runs/build:1.0.0/logs'));
      const r = await runCli(['runs', 'list', '--json'], { cwd, host: p.host, env });
      assert.equal(r.code, 0, r.stderr);
      assert.equal((JSON.parse(r.stdout) as { data: { runs: RunSummary[] } }).data.runs.length, 1);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.4.1-AC3] logs --follow --json is NDJSON: every line parses, one object per new run, redacted', { timeout: 30_000 }, async () => {
    const p = await platform();
    try {
      const cwd = await linked();
      const env = { ...process.env, ...(await dirs()), NO_COLOR: '1', REVITION_NO_UPDATE_CHECK: '1', REVITION_HOST: p.host, REVITION_TOKEN: PAT };
      const child = spawn(process.execPath, [CLI_BIN, 'logs', '--follow', '--json'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d: Buffer) => (out += d.toString()));
      await new Promise<void>((resolveDone) => {
        const t = setInterval(() => {
          if (out.includes('\n')) {
            clearInterval(t);
            resolveDone();
          }
        }, 100);
      });
      child.kill('SIGINT');
      await new Promise((r) => child.on('close', r));
      const lines = out.split('\n').filter((l) => l !== '');
      assert.ok(lines.length >= 1);
      const objs = lines.map((l) => JSON.parse(l) as { run: RunSummary; logs: LogBundle });
      assert.deepEqual(objs.map((o) => o.run.runId), ['exec_1']);
      assert.doesNotMatch(out, /rvt_P{10}/);
      assert.match(objs[0]?.logs.eval[0] ?? '', /\[REDACTED\]/);
      assert.equal(objs[0]?.logs.eval[1], '[REDACTED]');
      assert.doesNotMatch(out, /dXNlcjpwYXNz/);
    } finally {
      p.close();
    }
  });
});
