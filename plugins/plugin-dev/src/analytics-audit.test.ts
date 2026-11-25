import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import { analyticsLines, type PublisherAnalytics } from './commands/analytics.js';
import { filterAudit, type AuditEvent } from './commands/audit.js';
import { dirs, ok, runCli, startMockPlatform, type MockPlatform } from './test-fixtures/mock-platform.js';

const A: PublisherAnalytics = {
  appId: 'dapp_mine',
  published: true,
  period: { days: 30, startMs: 0, endMs: 1 },
  stats: { installs: 12, active: 9, revenueUsd: 1234.5, rating: 4.25, errorRate: 0.0123, upliftTrend: [0.1, -0.02] },
  sources: {
    installs: { state: 'recorded' },
    active: { state: 'recorded' },
    revenueUsd: { state: 'recorded' },
    rating: { state: 'not_recorded', why: 'the marketplace ratings are not connected in this deployment' },
    errorRate: { state: 'recorded' },
    upliftTrend: { state: 'recorded' },
  },
  payouts: { grossUsd: 100, feeUsd: 20, netUsd: 80, pendingUsd: 5 },
  upliftVersions: ['1.0.0', '1.1.0'],
};

describe('T2.4.2 analytics', () => {
  it("[CLI-T2.4.2-AC1] the values in the portal's formats (analytics-panel.tsx metricText), for the period asked", () => {
    assert.deepEqual(analyticsLines(A), [
      'dapp_mine: last 30 days',
      '  Installs: 12',
      '  Active installs: 9',
      '  Revenue (all your apps): $1,234.50',
      '  Rating: not recorded: the marketplace ratings are not connected in this deployment',
      '  Error rate: 1.2%',
      '  Eval uplift (task success, per published version): 1.0.0 +10.0%, 1.1.0 -2.0%',
      '  Payouts: gross $100.00, fee $20.00, net $80.00, pending $5.00',
    ]);
  });

  it('[CLI-T2.4.2-AC3] a not_recorded metric prints its reason and never a zero', () => {
    const zeroed = { ...A, stats: { ...A.stats, rating: 0 } };
    const line = analyticsLines(zeroed).find((l) => l.includes('Rating')) ?? '';
    assert.equal(line, '  Rating: not recorded: the marketplace ratings are not connected in this deployment');
    assert.doesNotMatch(line, /\b0\b/);
  });

  it('edge: an unpublished app shows published: false and no metric figures', () => {
    const lines = analyticsLines({ ...A, published: false });
    assert.equal(lines.length, 2);
    assert.match(lines[1] ?? '', /once a certified version is published/);
  });
});

describe('T2.4.2 audit', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const ev = (event: string, at: number, client?: string): AuditEvent => ({ event, at, ...(client === undefined ? {} : { client }), appId: 'dapp_mine' });
  it('--since and --action filter the events locally', () => {
    const events = [ev('app_registered', now - 60_000, 'cli'), ev('key_issued', now - 3_600_000 * 3, 'web'), ev('app_registered', now - 86_400_000 * 10)];
    assert.deepEqual(filterAudit(events, { sinceMs: 3_600_000, action: null, nowMs: now }).map((e) => e.event), ['app_registered']);
    assert.equal(filterAudit(events, { sinceMs: null, action: 'app_registered', nowMs: now }).length, 2);
  });
});

async function linked(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'analytics-'));
  const f = join(dir, '.revition/project.json');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify({ schemaVersion: 1, appId: 'dapp_mine', projectId: 'dproj_1' }));
  return dir;
}

function platform(): Promise<MockPlatform> {
  return startMockPlatform((method, path, _b, query) => {
    if (method === 'GET' && path === '/dev/apps/dapp_mine/analytics') return ok({ ...A, period: { ...A.period, days: Number(query.get('days')) } });
    if (method === 'GET' && path === '/dev/audit') {
      return ok({ events: [{ event: 'key_issued', at: Date.now() - 1000, client: 'cli', keyId: 'k1' }, { event: 'app_registered', at: Date.now() - 5000, appId: 'dapp_mine' }] });
    }
    return null;
  });
}

describe('T2.4.2 through the real CLI', () => {
  it('[CLI-T2.4.2-AC1] analytics asks the server for the same --days and prints its values; audit shows each client', async () => {
    const p = await platform();
    try {
      const cwd = await linked();
      const env = await dirs();
      const a = await runCli(['analytics', '--days', '7'], { cwd, host: p.host, env });
      assert.equal(a.code, 0, a.stderr);
      assert.equal(p.log.find((l) => l.path === '/dev/apps/dapp_mine/analytics')?.query, '?days=7');
      assert.match(a.stdout, /^dapp_mine: last 7 days/);
      assert.match(a.stdout, /Rating: not recorded: /);
      const bad = await runCli(['analytics', '--days', '12'], { cwd, host: p.host, env });
      assert.equal(bad.code, 2);
      const au = await runCli(['audit'], { cwd, host: p.host, env });
      assert.equal(au.code, 0, au.stderr);
      assert.match(au.stdout, /key_issued\s+cli\s+keyId=k1/);
      assert.match(au.stdout, /app_registered\s+-\s+appId=dapp_mine/);
    } finally {
      p.close();
    }
  });
});
