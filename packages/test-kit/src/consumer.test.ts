/**
 * T1.2.6 (REVITION-CLI-PLAN.md:1310-1337) - the CLI's contract-CONSUMER test: the real CLI's commands run against the
 * mock generated from the published contract (mock-server.ts), which rejects any request that does not match it.
 * AC1: this suite runs in the CLI repo CI (`pnpm test` runs every workspace package's tests).
 * AC2: an intentionally wrong request is rejected by the consumer mock.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CLI_BIN, runCli } from '../../cli/src/test-fixtures/spawn-cli.js';

import { checkRequest, loadContract, startContractMock } from './mock-server.js';

const PAT = `rvt_${'K'.repeat(40)}`;

/** Commands that call the platform and need nothing beyond a CI token (a linked project for the project-scoped ones). */
const CASES: readonly (readonly string[])[] = [
  ['whoami'],
  // The nightly smoke's four commands (nightly-contract.yml) are all here: doctor, whoami, apps list, docs sdk.
  ['doctor'],
  ['token', 'list'],
  ['token', 'create', '--name', 'contract', '--scopes', 'cli:read', '--yes'],
  ['token', 'revoke', 'tok_1', '--yes'],
  ['apps', 'list'],
  ['starters', 'list'],
  ['extension-points'],
  ['docs', 'sdk'],
  ['changelog'],
  ['wallet', 'show'],
  ['audit'],
  ['secrets', 'list', '--app', 'dapp_1'],
  ['apps', 'keys', 'list', 'dapp_1'],
  ['runs', 'list', '--app', 'dapp_1'],
  ['eval', 'list', '--app', 'dapp_1'],
  ['submissions', 'list', '--app', 'dapp_1'],
  ['versions', 'channels', '--app', 'dapp_1'],
  ['analytics', '--app', 'dapp_1'],
  ['agents', 'list'],
  ['agents', 'templates'],
];

function envFor(host: string): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'rv-consumer-'));
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, 'c'),
    XDG_STATE_HOME: join(home, 's'),
    XDG_CACHE_HOME: join(home, 'k'),
    REVITION_HOST: host,
    REVITION_TOKEN: PAT,
    REVITION_NO_UPDATE_CHECK: '1',
    DO_NOT_TRACK: '1',
  };
}

describe('T1.2.6 the contract-consumer test', () => {
  it('[CLI-T1.2.6-AC1] every request the CLI commands make matches a contract operation (no violation)', async () => {
    const mock = await startContractMock();
    try {
      const cwd = mkdtempSync(join(tmpdir(), 'rv-consumer-cwd-'));
      mkdirSync(join(cwd, '.revition'));
      writeFileSync(join(cwd, '.revition', 'project.json'), JSON.stringify({ schemaVersion: 1, appId: 'dapp_1', projectId: 'dproj_1' }));
      const issues: string[] = [];
      for (const argv of CASES) {
        const before = mock.calls.length;
        const r = await runCli(CLI_BIN, [...argv, '--json'], { env: { ...envFor(mock.host), PWD: cwd } });
        const made = mock.calls.slice(before);
        if (made.length === 0) issues.push(`${argv.join(' ')}: no platform call (exit ${String(r.code)}: ${r.stdout.slice(0, 200)}${r.stderr.slice(0, 200)})`);
        for (const c of made.filter((x) => x.problems.length > 0)) issues.push(`${argv.join(' ')}: ${c.method} ${c.path}: ${c.problems.join('; ')}`);
      }
      assert.deepEqual(issues, []);
      const operations = new Set(mock.calls.map((c) => c.operation));
      assert.ok(operations.size >= 15, `operations exercised: ${[...operations].join(', ')}`);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.2.6-AC2] an intentionally wrong request fails the consumer check (400 CONTRACT_VIOLATION)', async () => {
    const contract = loadContract();
    const q = new URLSearchParams();
    // missing the required `scopes`, an unknown field, a scope outside the enum, an unknown route, a stray query
    assert.deepEqual(checkRequest(contract, 'POST', '/api/v1/foundry/dev/tokens', q, JSON.stringify({ name: 'x' })).problems, ['body.scopes: required']);
    assert.match(checkRequest(contract, 'POST', '/api/v1/foundry/dev/tokens', q, JSON.stringify({ name: 'x', scopes: ['cli:read'], color: 'red' })).problems.join(), /body\.color: not allowed/);
    assert.match(checkRequest(contract, 'POST', '/api/v1/foundry/dev/tokens', q, JSON.stringify({ name: 'x', scopes: ['root'] })).problems.join(), /not one of/);
    assert.match(checkRequest(contract, 'GET', '/api/v1/foundry/dev/nope', q, '').problems.join(), /no such operation/);
    assert.match(checkRequest(contract, 'GET', '/api/v1/foundry/dev/me', new URLSearchParams('debug=1'), '').problems.join(), /query debug: not in the contract/);
    assert.deepEqual(checkRequest(contract, 'POST', '/api/v1/foundry/dev/tokens', q, JSON.stringify({ name: 'x', scopes: ['cli:read'] })).problems, []);
    // Over the wire: the mock refuses the wrong request, so a command sending it would fail its test.
    const mock = await startContractMock();
    try {
      const res = await fetch(`http://${mock.host}/api/v1/foundry/dev/tokens`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${PAT}` },
        body: JSON.stringify({ name: 'x' }),
      });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'CONTRACT_VIOLATION');
      assert.equal(mock.violations().length, 1);
    } finally {
      mock.close();
    }
  });
});
