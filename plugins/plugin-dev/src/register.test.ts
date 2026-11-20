import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { dirs, err, ok, runCli, startMockPlatform } from './test-fixtures/mock-platform.js';

const ACCOUNT = { developerId: 'auth0|dev1', kind: 'independent', linkedOrgId: null, verified: false, developerWalletId: 'developer:auth0|dev1', agreementAccepted: true };

async function platform() {
  // The platform's register is idempotent (putIfAbsent, then the existing account): the mock answers the same way.
  return startMockPlatform((method, path, body) => {
    if (method === 'POST' && path === '/dev/register') return ok(ACCOUNT);
    if (method === 'GET' && path === '/dev/me') return ok(ACCOUNT);
    if (method === 'POST' && path === '/dev/link') {
      return (body as { orgId?: string }).orgId === 'org_member' ? ok({ ...ACCOUNT, kind: 'tenant_member', linkedOrgId: 'org_member' }) : err(403, 'AGENT_FORBIDDEN', 'you are not a member of that workspace');
    }
    return null;
  });
}

describe('T2.1.1 account', () => {
  it('[CLI-T2.1.1-AC4] register is idempotent: the same account twice, agreement accepted explicitly', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'reg-'));
      const env = await dirs();
      const a = await runCli(['account', 'register', '--accept-terms', '--yes', '--json'], { cwd, host: p.host, env });
      const b = await runCli(['account', 'register', '--accept-terms', '--yes', '--json'], { cwd, host: p.host, env });
      assert.equal(a.code, 0, a.stderr);
      assert.deepEqual(JSON.parse(a.stdout).data, JSON.parse(b.stdout).data);
      const posts = p.log.filter((x) => x.path === '/dev/register');
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[0]?.body, { kind: 'independent', agreementAccepted: true });
      const status = await runCli(['account', 'status', '--json'], { cwd, host: p.host, env });
      assert.equal(JSON.parse(status.stdout).data.developerWalletId, 'developer:auth0|dev1');
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.1-AC4] off a terminal, register without --accept-terms is exit 2 and nothing is sent', async () => {
    const p = await platform();
    try {
      const r = await runCli(['account', 'register', '--yes'], { cwd: await mkdtemp(join(tmpdir(), 'reg-')), host: p.host, env: await dirs() });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /developer agreement/);
      assert.equal(p.log.filter((x) => x.path === '/dev/register').length, 0);
    } finally {
      p.close();
    }
  });

  it('[CLI-T2.1.1-AC4] account link-workspace to an org you are not a member of: exit 4 (the server check)', async () => {
    const p = await platform();
    try {
      const cwd = await mkdtemp(join(tmpdir(), 'reg-'));
      const env = await dirs();
      const no = await runCli(['account', 'link-workspace', '--org', 'org_not_mine', '--yes'], { cwd, host: p.host, env });
      assert.equal(no.code, 4, no.stderr);
      const yes = await runCli(['account', 'link-workspace', '--org', 'org_member', '--yes', '--json'], { cwd, host: p.host, env });
      assert.equal(yes.code, 0, yes.stderr);
      assert.equal(JSON.parse(yes.stdout).data.linkedOrgId, 'org_member');
    } finally {
      p.close();
    }
  });
});
