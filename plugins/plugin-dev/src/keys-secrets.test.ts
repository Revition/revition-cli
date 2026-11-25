import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { Config } from '@oclif/core';

import { CLI_BIN, dirs, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

const SECRET_KEY = `rdk_0123abcd4567ef89_${'S'.repeat(43)}`;
const VIEW = { keyId: '0123abcd4567ef89', appId: 'dapp_mine', scopes: ['source:orders'], issuedAt: 'x', expiresAt: '2027-02-16T00:00:00Z', revokeAt: null };

async function platform(opts: { firstSetCost?: { monthlyUsd: number; note: string } | null } = {}) {
  const names = new Set<string>(['EXISTING']);
  return startMockPlatform((method, path, body) => {
    if (method === 'POST' && path === '/dev/apps/dapp_mine/keys') return ok({ keyRef: 'r', key: SECRET_KEY, view: VIEW });
    if (method === 'POST' && path === '/dev/apps/dapp_mine/keys/0123abcd4567ef89/rotate') return ok({ keyRef: 'r', key: SECRET_KEY.replace('S', 'T'), view: { ...VIEW, keyId: 'fedcba9876543210' } });
    if (method === 'DELETE' && path === '/dev/apps/dapp_mine/keys/0123abcd4567ef89') return ok({ revoked: true });
    if (method === 'GET' && path === '/runtime-secrets') return ok({ names: [...names].sort(), audit: [{ name: 'EXISTING', by: 'Owner One', at: 'x' }] });
    if (method === 'GET' && path === '/dev/apps/dapp_mine/secrets') return ok({ names: [...names].sort().map((n) => ({ name: n, updatedAt: 'x' })), firstSetCost: opts.firstSetCost ?? null });
    const put = /^\/(runtime-secrets|dev\/apps\/dapp_mine\/secrets)\/([^/]+)$/.exec(path);
    if (method === 'PUT' && put !== null) {
      names.add(put[2] ?? '');
      return ok({ name: put[2], names: [...names] });
    }
    if (method === 'DELETE' && put !== null) return ok({ name: put[2] });
    void body;
    return null;
  });
}

function files(dir: string): string[] {
  let out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    out = statSync(p).isDirectory() ? [...out, ...files(p)] : [...out, p];
  }
  return out;
}

describe('T2.2.2 apps keys', () => {
  it('[CLI-T2.2.2-AC1] the secret appears in the creation output only: stdout once; never in stderr, the debug log or any CLI file', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'keys-'));
      const env = await dirs();
      const r = await runCli(['apps', 'keys', 'create', 'dapp_mine', '--yes', '--debug'], { cwd, host: p.host, env });
      assert.equal(r.code, 0, r.stderr);
      assert.equal(r.stdout, `${SECRET_KEY}\n`);
      assert.doesNotMatch(r.stderr, /rdk_/);
      for (const f of files(env['XDG_STATE_HOME'] ?? '').concat(files(env['XDG_CACHE_HOME'] ?? ''), files(env['XDG_CONFIG_HOME'] ?? ''))) {
        assert.equal(readFileSync(f, 'utf8').includes(SECRET_KEY), false, `stored in ${f}`);
      }
      const json = await runCli(['apps', 'keys', 'create', 'dapp_mine', '--yes', '--json'], { cwd, host: p.host, env });
      const doc = JSON.parse(json.stdout) as { data: { secret: string }; warnings: string[] };
      assert.equal(doc.data.secret, SECRET_KEY);
      assert.match(doc.warnings.join(' '), /data\.secret is shown once/);
      const list = await runCli(['apps', 'keys', 'list', 'dapp_mine', '--json'], { cwd, host: p.host, env });
      assert.doesNotMatch(list.stdout, /rdk_/);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.2.2-AC2] rotate prints the new key once and names the replacement (the old key stops after the grace, server-side)', async () => {
    const p = await platform();
    try {
      const r = await runCli(['apps', 'keys', 'rotate', 'dapp_mine', '0123abcd4567ef89', '--yes', '--json'], { cwd: tmpdir(), host: p.host, env: await dirs() });
      assert.equal(r.code, 0, r.stderr);
      const d = JSON.parse(r.stdout).data as { keyId: string; secret: string };
      assert.equal(d.keyId, 'fedcba9876543210');
      assert.notEqual(d.secret, SECRET_KEY);
      assert.equal(p.log.at(-1)?.path, '/dev/apps/dapp_mine/keys/0123abcd4567ef89/rotate');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.2.2-AC3] revoke needs the typed key id or --yes: off a terminal without --yes it is exit 2 and nothing is revoked', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      const no = await runCli(['apps', 'keys', 'revoke', 'dapp_mine', '0123abcd4567ef89'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(no.code, 2);
      assert.equal(p.log.filter((x) => x.method === 'DELETE').length, 0);
      const yes = await runCli(['apps', 'keys', 'revoke', 'dapp_mine', '0123abcd4567ef89', '--yes'], { cwd: tmpdir(), host: p.host, env });
      assert.equal(yes.code, 0, yes.stderr);
      assert.equal(p.log.filter((x) => x.method === 'DELETE').length, 1);
      const config = await Config.load(join(CLI_BIN, '..', '..'));
      assert.equal((config.findCommand('apps:keys:revoke') as unknown as { meta: { confirm: string } }).meta.confirm, 'typed');
    } finally {
      p.close();
    }
  });
});

describe('T2.2.3 secrets', () => {
  it('[CLI-T2.2.3-AC1] no flag or argument carries a value: secrets set takes the NAME only (manifest scan)', async () => {
    const config = await Config.load(join(CLI_BIN, '..', '..'));
    for (const id of ['secrets:set', 'secrets:unset', 'secrets:list']) {
      const c = config.findCommand(id);
      assert.ok(c !== undefined, id);
      assert.deepEqual(Object.keys(c.args ?? {}).filter((a) => /value|secret/i.test(a)), [], `${id} args`);
      assert.deepEqual(Object.keys(c.flags ?? {}).filter((f) => /value|secret|password|token/i.test(f)), [], `${id} flags`);
    }
    assert.deepEqual(Object.keys(config.findCommand('secrets:set')?.args ?? {}), ['name']);
  });

  it('[CLI-T2.2.3-AC2] list returns names only, never values (workspace and app), and passes on nothing else', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      for (const args of [['secrets', 'list'], ['secrets', 'list', '--app', 'dapp_mine']]) {
        const r = await runCli([...args, '--json'], { cwd: tmpdir(), host: p.host, env });
        assert.equal(r.code, 0, r.stderr);
        const d = JSON.parse(r.stdout).data as { names: Array<Record<string, unknown>> };
        for (const n of d.names) assert.deepEqual(Object.keys(n).sort(), ['name', 'updatedAt']);
        assert.doesNotMatch(r.stdout, /Owner One/, 'the audit is not part of the list');
      }
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.2.3-AC1] [CLI-T2.2.3-AC2] --env picks the workspace secret\'s environment (ruling #313); no flag sends none (prod); --env with --app is refused', async () => {
    const p = await platform();
    try {
      const env = await dirs();
      assert.equal((await runCli(['secrets', 'set', 'DEV_KEY', '--env', 'dev', '--yes'], { cwd: tmpdir(), host: p.host, env, input: 'v1\n' })).code, 0);
      assert.deepEqual(p.log.filter((x) => x.method === 'PUT').at(-1)?.body, { value: 'v1', env: 'dev' });
      assert.equal((await runCli(['secrets', 'set', 'PROD_KEY', '--yes'], { cwd: tmpdir(), host: p.host, env, input: 'v2\n' })).code, 0);
      assert.deepEqual(p.log.filter((x) => x.method === 'PUT').at(-1)?.body, { value: 'v2' }, 'no --env: the route default (prod) is unchanged');
      assert.equal((await runCli(['secrets', 'list', '--env', 'dev', '--json'], { cwd: tmpdir(), host: p.host, env })).code, 0);
      assert.equal(p.log.filter((x) => x.method === 'GET' && x.path === '/runtime-secrets').at(-1)?.query, '?env=dev');
      assert.equal((await runCli(['secrets', 'unset', 'DEV_KEY', '--env', 'dev', '--yes'], { cwd: tmpdir(), host: p.host, env })).code, 0);
      assert.equal(p.log.filter((x) => x.method === 'DELETE').at(-1)?.query, '?env=dev');
      const before = p.log.length;
      const refused = await runCli(['secrets', 'set', 'K', '--app', 'dapp_mine', '--env', 'dev', '--yes'], { cwd: tmpdir(), host: p.host, env, input: 'v\n' });
      assert.equal(refused.code, 2);
      assert.match(refused.stderr, /--env applies to the workspace's secrets only/);
      assert.equal(p.log.slice(before).filter((x) => x.method === 'PUT').length, 0, 'nothing is set');
      assert.notEqual((await runCli(['secrets', 'set', 'K', '--env', 'qa', '--yes'], { cwd: tmpdir(), host: p.host, env, input: 'v\n' })).code, 0, 'an unknown environment is refused');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.2.3-AC3] set via stdin works and the value appears in no sink; [CLI-T2.2.3-AC4] the first app secret shows its cost first', async () => {
    const value = 'value-that-must-not-leak-9f3c';
    const p = await platform({ firstSetCost: { monthlyUsd: 0.4, note: 'one secret store per developer' } });
    try {
      const env = await dirs();
      const r = await runCli(['secrets', 'set', 'API_KEY', '--app', 'dapp_mine', '--yes', '--debug'], { cwd: tmpdir(), host: p.host, env, input: `${value}\n` });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, /Your first secret creates your secret store: \$0\.40 a month \(one secret store per developer\)/);
      assert.deepEqual(p.log.find((x) => x.method === 'PUT')?.body, { value });
      assert.equal(`${r.stdout}${r.stderr}`.includes(value), false);
      for (const f of files(env['XDG_STATE_HOME'] ?? '').concat(files(env['XDG_CACHE_HOME'] ?? ''))) assert.equal(readFileSync(f, 'utf8').includes(value), false, f);
      const pem = '-----BEGIN CERTIFICATE-----\nAAA\nBBB\n-----END CERTIFICATE-----\n';
      assert.equal((await runCli(['secrets', 'set', 'TLS_CERT', '--yes'], { cwd: tmpdir(), host: p.host, env, input: pem })).code, 0);
      assert.deepEqual(p.log.filter((x) => x.method === 'PUT').at(-1)?.body, { value: pem }, 'a multi-line value is kept exactly');
      assert.equal((await runCli(['secrets', 'set', 'EMPTY', '--yes'], { cwd: tmpdir(), host: p.host, env, input: '' })).code, 2);
    } finally {
      p.close();
    }
  });
});
