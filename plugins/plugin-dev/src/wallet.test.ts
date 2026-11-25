import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { walletOf } from './commands/wallet/show.js';
import { dirs, err, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

const CONTRACT = fileURLToPath(new URL('../../../packages/api-client/openapi/v1.json', import.meta.url));
const PAYMENT = /card|last4|cvc|cvv|\bpan\b|iban|routing|accountnumber|paymentmethod|billingaddress|expmonth|expyear/i;

describe('T2.4.3 wallet', () => {
  it('[CLI-T2.4.3-AC1] wallet show prints the server balance (Mint), credits and usd as given', async () => {
    const p = await startMockPlatform((method, path) => (method === 'GET' && path === '/dev/wallet' ? ok({ credits: 1250, usd: 12.5, usedPct: 37 }) : null));
    try {
      const env = await dirs();
      const r = await runCli(['wallet', 'show'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /^Balance: \$12\.50 \(1250 credits\), 37% used\./);
      const j = await runCli(['wallet', 'show', '--json'], { cwd: tmpdir(), host: p.host, env });
      const d = (JSON.parse(j.stdout) as { data: Record<string, unknown> }).data;
      assert.deepEqual([d['credits'], d['usd'], d['usedPct']], [1250, 12.5, 37]);
      // The subject is the caller: the CLI sends no wallet or developer id.
      assert.deepEqual(p.log.map((l) => `${l.method} ${l.path}${l.query}`), ['GET /dev/wallet', 'GET /dev/wallet']);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.4.3-AC3] no card or payment field reaches the CLI output, even if a server sent one; the contract has none', async () => {
    const leaky = { credits: 1, usd: 0.01, usedPct: 0, card: { last4: '4242', brand: 'visa' }, paymentMethod: 'pm_123' };
    assert.deepEqual(Object.keys(walletOf(leaky)).sort(), ['credits', 'open', 'topUpUrl', 'usd', 'usedPct']);
    const p = await startMockPlatform((method, path) => (method === 'GET' && path === '/dev/wallet' ? ok(leaky) : null));
    try {
      const r = await runCli(['wallet', 'show', '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      assert.doesNotMatch(r.stdout, /4242|pm_123|last4|card|paymentMethod/);
    } finally {
      p.close();
    }
    // Every property name in every schema of the CLI contract: none is a payment field.
    const names: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') {
        for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
          if (k === 'properties' && x !== null && typeof x === 'object') names.push(...Object.keys(x as object));
          walk(x);
        }
      }
    };
    walk(JSON.parse(readFileSync(CONTRACT, 'utf8')));
    assert.ok(names.length > 20, `${names.length} property names scanned`);
    assert.deepEqual(names.filter((n) => PAYMENT.test(n)), []);
  });

  it('edge: no wallet row yet -> 0 credits with the portal top-up link; wallet open names the portal wallet page', async () => {
    const p = await startMockPlatform((method, path) => (method === 'GET' && path === '/dev/wallet' ? err(404, 'WALLET_NOT_OPEN', 'no developer wallet is open yet') : null));
    try {
      const env = { ...(await dirs()), SSH_CONNECTION: 'test' };
      const r = await runCli(['wallet', 'show'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, 'No developer wallet yet: 0 credits.\nTop up in the Developer Portal: https://developer.revition.com/\n');
      const o = await runCli(['wallet', 'open', '--json'], { cwd: tmpdir(), host: p.host, env });
      assert.equal((JSON.parse(o.stdout) as { data: { url: string } }).data.url, 'https://developer.revition.com/');
    } finally {
      p.close();
    }
  });
});
