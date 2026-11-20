import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { CLIENT_ID, startMockAuth, type MockAuth } from './test-fixtures/mock-auth.js';
import { CLI_BIN, runCli, type Spawned } from './test-fixtures/spawn-cli.js';

const TOKEN_SHAPES = /rvs_[A-Za-z0-9]{20,}|rvt_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.|rt-\d+|"refresh_token"/;

async function envFor(mock: MockAuth): Promise<Record<string, string> & { TEST_DIRS: string }> {
  // The real HOME stays (macOS finds the login keychain through it); every CLI directory is redirected via XDG_*.
  const home = await mkdtemp(join(tmpdir(), 'revlogin-'));
  return {
    TEST_DIRS: home,
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_STATE_HOME: join(home, 'state'),
    XDG_CACHE_HOME: join(home, 'cache'),
    REVITION_HOST: mock.apiHost,
    REVITION_AUTH_ISSUER: mock.issuer,
    REVITION_AUTH_CLIENT_ID: CLIENT_ID,
    // A remote shell: the CLI prints the URL instead of opening a browser (the test is the browser).
    SSH_CONNECTION: '10.0.0.1 1 10.0.0.2 22',
  };
}

function get(url: string, host?: string): Promise<{ status: number; body: string } | { error: string }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.get({ hostname: u.hostname, port: u.port, path: `${u.pathname}${u.search}`, headers: host === undefined ? {} : { host } }, (res) => {
      let body = '';
      res.on('data', (d: Buffer) => (body += d.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ error: e.code ?? 'error' }));
  });
}

/** Runs `revition login`, plays the browser: a wrong state first, then the real callback. */
async function browserLogin(mock: MockAuth, env: Record<string, string>): Promise<{ run: Spawned; pages: Array<{ status: number; body: string } | { error: string }> }> {
  const pages: Array<{ status: number; body: string } | { error: string }> = [];
  let acted = false;
  let buffered = '';
  const run = await runCli(CLI_BIN, ['login'], {
    env,
    onStderr: (chunk) => {
      buffered += chunk;
      const m = /(http:\/\/127\.0\.0\.1:\d+\/authorize\?\S+)/.exec(buffered);
      if (acted || m === null) return;
      acted = true;
      const auth = new URL(m[1] ?? '');
      mock.state.challenge = auth.searchParams.get('code_challenge') ?? '';
      mock.state.nonce = auth.searchParams.get('nonce') ?? '';
      const redirect = new URL(auth.searchParams.get('redirect_uri') ?? '');
      const state = auth.searchParams.get('state') ?? '';
      void (async () => {
        pages.push(await get(`${redirect.href}?code=code-1&state=wrong`));
        pages.push(await get(`${redirect.href}?code=code-1&state=${state}`, 'evil.example:80'));
        pages.push(await get(`${redirect.href}?code=code-1&state=${state}`));
        await new Promise((r) => setTimeout(r, 50));
        pages.push(await get(`${redirect.href}?code=code-1&state=${state}`));
      })();
    },
  });
  return { run, pages };
}

describe('T1.3.1 / T1.3.2 / T1.3.4 / T1.3.6 login, logout and CI auth through the real CLI', () => {
  it('[CLI-T1.3.1-AC2] [CLI-T1.3.3-AC4] [CLI-T1.3.2-AC1] browser login: wrong state, wrong Host and a second request are refused; no token anywhere', async () => {
    const mock = await startMockAuth();
    const env = await envFor(mock);
    try {
      const { run, pages } = await browserLogin(mock, env);
      assert.equal(run.code, 0, run.stderr);
      assert.match(run.stdout, new RegExp(`Logged in as dev@e2e.test \\(org_e2e\\) on ${mock.apiHost.replace(/\./g, '\\.')}\\. Session sess-1`));
      assert.equal((pages[0] as { status: number }).status, 400, 'wrong state');
      assert.equal((pages[1] as { status: number }).status, 400, 'wrong Host header');
      assert.equal((pages[2] as { status: number }).status, 200, 'the real callback');
      assert.match((pages[2] as { body: string }).body, /You can close this tab/);
      assert.ok('error' in (pages[3] ?? {}), 'a second request after success must find the listener closed');
      // the leak suite: no token or credential in stdout, stderr or the page
      for (const text of [run.stdout, run.stderr, (pages[2] as { body: string }).body]) assert.doesNotMatch(text, TOKEN_SHAPES);
      // T1.3.2 AC1 spy: without --device the device endpoints are never called
      assert.ok(!mock.idpLog.some((r) => r.path === '/oauth/device/code'));
      // T1.3.3 AC4: the state, config and cache directories hold no token
      for (const dir of ['state', 'config', 'cache']) {
        const files = await readdir(join(env['TEST_DIRS'] ?? '', dir), { recursive: true }).catch(() => []);
        for (const f of files) {
          const text = await readFile(join(env['TEST_DIRS'] ?? '', dir, String(f)), 'utf8').catch(() => '');
          assert.doesNotMatch(text, TOKEN_SHAPES, `${dir}/${String(f)}`);
        }
      }
      // the session works: whoami through the stored credential
      const who = await runCli(CLI_BIN, ['whoami', '--json'], { env });
      assert.equal(who.code, 0, who.stderr);
      const data = JSON.parse(who.stdout).data as { user: string; workspace: string; sessionId: string; method: string };
      assert.deepEqual([data.user, data.workspace, data.sessionId, data.method], ['dev@e2e.test', 'org_e2e', 'sess-1', 'browser']);
      assert.ok(mock.apiLog.some((r) => r.path === '/api/v1/foundry/dev/me' && r.headers.authorization === `Bearer ${mock.state.credential}`));
    } finally {
      await runCli(CLI_BIN, ['logout'], { env });
      mock.close();
    }
  });

  it('[CLI-T1.3.4-AC3] logout calls both revoke endpoints and deletes the local credential', async () => {
    const mock = await startMockAuth();
    const env = await envFor(mock);
    try {
      assert.equal((await browserLogin(mock, env)).run.code, 0);
      const out = await runCli(CLI_BIN, ['logout', '--json'], { env });
      assert.equal(out.code, 0, out.stderr);
      const r = JSON.parse(out.stdout).data.results[0] as { hadSession: boolean; auth0Revoked: boolean; sessionRevoked: boolean; queued: boolean };
      assert.deepEqual(r, { profile: 'default', host: mock.apiHost, hadSession: true, auth0Revoked: true, sessionRevoked: true, queued: false });
      assert.ok(mock.idpLog.some((x) => x.path === '/oauth/revoke' && x.body.includes(`token=${mock.state.refreshTokens[1]}`)));
      assert.ok(mock.apiLog.some((x) => x.method === 'DELETE' && x.path === '/api/v1/foundry/dev/cli/sessions/sess-1'));
      const after = await runCli(CLI_BIN, ['whoami'], { env });
      assert.equal(after.code, 3);
      const again = await runCli(CLI_BIN, ['logout'], { env });
      assert.match(again.stdout, /nothing to do/);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.3.2-AC3] [CLI-T1.3.2-AC4] [CLI-T1.3.2-AC5] --device: the warning text, no complete URL; an org policy deny is exit 4 with a clear message', async () => {
    const mock = await startMockAuth({ devicePolls: ['authorization_pending'] });
    const env = await envFor(mock);
    try {
      const run = await runCli(CLI_BIN, ['login', '--device'], { env });
      assert.equal(run.code, 0, run.stderr);
      assert.match(run.stderr, /To sign in, open http:\/\/127\.0\.0\.1:\d+\/activate on any device and confirm the code ABCD-EFGH\./);
      assert.match(run.stderr, /Only continue if YOU just ran 'revition login --device' on .+\. Never enter a code someone sent you\./);
      assert.doesNotMatch(run.stderr, /user_code=/);
      const who = JSON.parse((await runCli(CLI_BIN, ['whoami', '--json'], { env })).stdout).data as { method: string };
      assert.equal(who.method, 'device');
    } finally {
      await runCli(CLI_BIN, ['logout'], { env });
      mock.close();
    }
    const deny = await startMockAuth({ denyDevice: true });
    const denyEnv = await envFor(deny);
    try {
      const run = await runCli(CLI_BIN, ['login', '--device'], { env: denyEnv });
      assert.equal(run.code, 4);
      assert.match(run.stderr, /does not allow the device sign-in/);
    } finally {
      deny.close();
    }
  });

  it('[CLI-T1.3.6-AC2] [CLI-T1.3.6-AC3] REVITION_TOKEN drives commands with the state directories unchanged; --with-token reads stdin only', async () => {
    const mock = await startMockAuth();
    const env = { ...(await envFor(mock)), REVITION_TOKEN: `rvt_${'A'.repeat(40)}` };
    try {
      for (const args of [['whoami', '--json'], ['token', 'list', '--json']]) {
        const r = await runCli(CLI_BIN, args, { env });
        assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
      }
      assert.ok(mock.apiLog.every((r) => !r.path.startsWith('/api/v1/foundry/dev/') || r.headers.authorization === `Bearer rvt_${'A'.repeat(40)}` || r.method === 'POST'));
      for (const dir of ['state', 'config', 'cache']) {
        assert.deepEqual(await readdir(join(env.TEST_DIRS, dir)).catch(() => []), [], `${dir} must stay untouched`);
      }
      // --with-token: there is no flag that takes the token; a TTY-less empty stdin is refused as malformed
      const empty = await runCli(CLI_BIN, ['login', '--with-token'], { env: { ...env, REVITION_TOKEN: '' } });
      assert.equal(empty.code, 2);
      assert.match(empty.stderr, /not a Revition token/);
    } finally {
      mock.close();
    }
  });

  it('[CLI-T1.3.6-AC4] CI=true with a missing confirmation exits 2, never a hang', async () => {
    const mock = await startMockAuth();
    const env = { ...(await envFor(mock)), REVITION_TOKEN: `rvt_${'A'.repeat(40)}`, CI: 'true' };
    try {
      const r = await runCli(CLI_BIN, ['token', 'revoke', 'tok_1'], { env });
      assert.equal(r.code, 2);
      assert.match(r.stderr, /--yes/);
      assert.ok(!mock.apiLog.some((x) => x.method === 'DELETE'), 'nothing was revoked');
      assert.ok(r.ms < 10_000);
    } finally {
      mock.close();
    }
  });
});
