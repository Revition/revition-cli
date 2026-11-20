import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, randomUUID, sign, verify } from 'node:crypto';
import { mkdtemp, readdir, readFile, stat } from 'node:fs/promises';
import http, { type IncomingMessage } from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

import { executeCommand } from '../command/base-command.js';
import { EncryptedFileStore } from '../credentials/encrypted-file.js';
import { KeychainStore } from '../credentials/keychain.js';
import { MemoryStore } from '../credentials/memory.js';
import { selectStore } from '../credentials/select.js';
import type { StoredCredential } from '../credentials/store.js';
import { RevitionCliError } from '../errors/cli-error.js';
import { actingBanner, describeIdentity } from '../identity/identity.js';
import { memoryIo } from '../output/io.js';
import { ApiClient } from '../transport/client.js';

import { impliedNoInput } from './ci-detect.js';
import { newDeviceKey, reauthMessage } from './device-key.js';
import { deviceWarning, pollForTokens } from './device-flow.js';
import { verifyIdToken } from './id-token-verify.js';
import { logoutAndQueue, readQueue, retryQueued } from './logout.js';
import { startLoopback } from './loopback-server.js';
import { challengeOf, newPkce } from './pkce.js';
import { ensureFresh, REUSE_HINT, SESSION_ENDED, SESSIONS_PAGE_URL } from './reauth.js';
import { effectiveNow, needsReauth, skewMs } from './skew.js';
import { OAuthError, type AuthConfig, type TokenSet } from './token-exchange.js';

const CFG: AuthConfig = { issuerBase: 'https://tenant.example.auth0.com', clientId: 'cli', audience: 'https://api.revition.com' };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWKS = { keys: [{ ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1' }] };
const NOW = 1_800_000_000;
const idToken = (claims: Record<string, unknown>, key = privateKey): string => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
};
const GOOD = { iss: `${CFG.issuerBase}/`, aud: 'cli', sub: 'auth0|u', exp: NOW + 600, nonce: 'n-1' };
const cred = (over: Partial<StoredCredential> = {}): StoredCredential => ({
  credential: `rvs_${'a'.repeat(40)}`,
  auth0RefreshToken: 'rt-1',
  devicePrivateKey: (generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer).toString('base64'),
  sessionId: 'sess-1',
  authFreshUntil: Date.now() - 1000,
  method: 'browser',
  email: 'dev@e2e.test',
  ...over,
});
const tokenSet = (rt: string): TokenSet => ({
  accessToken: `h.${Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000) })).toString('base64url')}.s`,
  refreshToken: rt,
  idToken: null,
  expiresIn: 3600,
});

describe('Set 3 authentication (core)', () => {
  it('[CLI-T1.3.1-AC2] PKCE is S256 (checked against WebCrypto); the listener binds 127.0.0.1 only', async () => {
    const p = newPkce();
    assert.equal(p.method, 'S256');
    const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p.verifier))).toString('base64url');
    assert.equal(challengeOf(p.verifier), digest);
    assert.equal(p.challenge, digest);
    assert.match(p.verifier, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(p.state, p.nonce);
    const l = await startLoopback('state-1', { ports: [0] });
    const outside = Object.values(networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;
    if (outside !== undefined) {
      const refused = await new Promise<boolean>((resolve) => {
        const s = net.connect(l.port, outside);
        s.on('connect', () => {
          s.destroy();
          resolve(false);
        });
        s.on('error', () => resolve(true));
      });
      assert.equal(refused, true, `the listener answered on ${outside}`);
    }
    assert.equal(l.redirectUri, `http://127.0.0.1:${l.port}/callback`);
    l.close();
    await l.code.catch(() => undefined);
  });

  it('[CLI-T1.3.1-AC3] timeout is exit 3; every registered port busy is exit 3 with the --device hint', async () => {
    const t = await startLoopback('s', { ports: [0], timeoutMs: 50 });
    await assert.rejects(t.code, (e) => e instanceof RevitionCliError && e.exitCode === 3 && /timed out/.test(e.message));
    const busy = http.createServer();
    await new Promise<void>((r) => busy.listen(0, '127.0.0.1', r));
    const port = (busy.address() as AddressInfo).port;
    await assert.rejects(startLoopback('s', { ports: [port] }), (e) => e instanceof RevitionCliError && e.exitCode === 3 && /--device/.test(e.error.hint ?? ''));
    busy.close();
  });

  it('[CLI-T1.3.1-AC4] an id_token with a bad nonce or a bad signature is rejected', () => {
    assert.equal(verifyIdToken(idToken(GOOD), { jwks: JWKS, cfg: CFG, nonce: 'n-1', nowSec: NOW })['sub'], 'auth0|u');
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const cases: Array<[string, string]> = [
      [idToken({ ...GOOD, nonce: 'n-2' }), 'nonce'],
      [idToken(GOOD, other), 'signature'],
      [idToken({ ...GOOD, aud: 'someone-else' }), 'audience'],
      [idToken({ ...GOOD, iss: 'https://evil.example/' }), 'issuer'],
      [idToken({ ...GOOD, exp: NOW - 3600 }), 'expired'],
    ];
    for (const [tok, why] of cases) {
      assert.throws(() => verifyIdToken(tok, { jwks: JWKS, cfg: CFG, nonce: 'n-1', nowSec: NOW }), (e) => e instanceof RevitionCliError && e.exitCode === 3 && e.message.includes(why), why);
    }
  });

  it('[CLI-T1.3.2-AC2] slow_down increases the interval by 5 s; expired_token exits 3 with guidance', async () => {
    const waits: number[] = [];
    let clock = 0;
    const script = ['authorization_pending', 'slow_down', 'authorization_pending'];
    const got = await pollForTokens(
      { deviceCode: 'd', userCode: 'U', verificationUri: 'https://x/activate', expiresIn: 600, interval: 5 },
      {
        sleep: async (ms) => {
          waits.push(ms);
          clock += ms;
        },
        now: () => clock,
        attempt: async () => {
          const next = script.shift();
          if (next !== undefined) throw new OAuthError(400, next, next);
          return tokenSet('rt');
        },
      }
    );
    assert.equal(got.refreshToken, 'rt');
    assert.deepEqual(waits, [5000, 5000, 10000, 10000]);
    await assert.rejects(
      pollForTokens(
        { deviceCode: 'd', userCode: 'U', verificationUri: 'u', expiresIn: 600, interval: 1 },
        { sleep: async () => undefined, now: () => 0, attempt: async () => { throw new OAuthError(400, 'expired_token', 'x'); } }
      ),
      (e) => e instanceof RevitionCliError && e.exitCode === 3 && /login --device/.test(e.error.hint ?? '')
    );
  });

  it('[CLI-T1.3.2-AC3] the device warning text (snapshot)', () => {
    assert.equal(
      deviceWarning({ userCode: 'ABCD-EFGH', verificationUri: 'https://revition.us.auth0.com/activate' }, 'build-box'),
      'To sign in, open https://revition.us.auth0.com/activate on any device and confirm the code ABCD-EFGH.\n' +
        "Only continue if YOU just ran 'revition login --device' on build-box. Never enter a code someone sent you.\n"
    );
  });

  it('[CLI-T1.3.3-AC1] keychain round trip on this OS (the CI matrix runs the others)', async () => {
    const store = new KeychainStore();
    const key = { profile: `__test__${randomUUID()}`, host: 'test.invalid' };
    try {
      await store.set(key, cred());
      assert.equal((await store.get(key))?.sessionId, 'sess-1');
      await store.delete(key);
      assert.equal(await store.get(key), null);
    } finally {
      await store.delete(key);
    }
  });

  it('[CLI-T1.3.3-AC2] no keychain: the store refuses with guidance and nothing is written to disk', async () => {
    const state = await mkdtemp(join(tmpdir(), 'revnokc-'));
    const broken = () => ({
      setPassword: () => {
        throw new Error('no secret service');
      },
      getPassword: () => {
        throw new Error('no secret service');
      },
      deletePassword: () => false,
    });
    await assert.rejects(
      selectStore({ profile: 'default', stateDir: state, env: {}, insecureStorageFlag: false, askPassphrase: async () => 'x', entry: broken }),
      (e) => e instanceof RevitionCliError && e.exitCode === 3 && /--insecure-storage/.test(e.error.hint ?? '') && /REVITION_TOKEN/.test(e.error.hint ?? '')
    );
    assert.deepEqual(await readdir(state), []);
    // A PAT in the environment never touches any store.
    assert.equal((await selectStore({ profile: 'default', stateDir: state, env: { REVITION_TOKEN: 'rvt_x' }, insecureStorageFlag: false, askPassphrase: async () => 'x', entry: broken })).backend, 'memory');
  });

  it('[CLI-T1.3.3-AC3] --insecure-storage creates only the encrypted file (0600); it is not decodable without the passphrase', async () => {
    const state = await mkdtemp(join(tmpdir(), 'revenc-'));
    const store = await selectStore({ profile: 'p', stateDir: state, env: {}, insecureStorageFlag: true, askPassphrase: async () => 'correct horse battery', entry: () => { throw new Error('none'); } });
    assert.equal(store.backend, 'encrypted-file');
    await store.set({ profile: 'p', host: 'api.revition.com' }, cred());
    assert.deepEqual((await readdir(state)).sort(), ['credentials.enc', 'insecure-storage.json']);
    const raw = await readFile(join(state, 'credentials.enc'), 'utf8');
    assert.doesNotMatch(raw, /rvs_|rt-1|sess-1|dev@e2e/);
    if (process.platform !== 'win32') assert.equal((await stat(join(state, 'credentials.enc'))).mode & 0o777, 0o600);
    const wrong = new EncryptedFileStore(join(state, 'credentials.enc'), async () => 'wrong passphrase!');
    await assert.rejects(wrong.get({ profile: 'p', host: 'api.revition.com' }), (e) => e instanceof RevitionCliError && e.error.code === 'CREDENTIAL_FILE_LOCKED');
    const right = new EncryptedFileStore(join(state, 'credentials.enc'), async () => 'correct horse battery');
    assert.equal((await right.get({ profile: 'p', host: 'api.revition.com' }))?.sessionId, 'sess-1');
  });

  it('[CLI-T1.3.3-AC5] the keychain binding has no install scripts and ships prebuilt binaries for the 3 OS', async () => {
    const require = createRequire(import.meta.url);
    const pkg = JSON.parse(await readFile(require.resolve('@napi-rs/keyring/package.json'), 'utf8')) as { scripts?: Record<string, string>; optionalDependencies?: Record<string, string>; license?: string; version: string };
    for (const hook of ['preinstall', 'install', 'postinstall']) assert.equal(pkg.scripts?.[hook], undefined, hook);
    const prebuilt = Object.keys(pkg.optionalDependencies ?? {});
    for (const target of ['darwin-arm64', 'darwin-x64', 'linux-x64-gnu', 'linux-arm64-gnu', 'win32-x64-msvc', 'win32-arm64-msvc']) {
      assert.ok(prebuilt.some((p) => p.endsWith(target)), target);
    }
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.version, '2.1.2');
  });

  it('[CLI-T2.5.2-AC1] review finding 5: the reuse hint names the portal sessions page that exists (developer host /cli-sessions)', () => {
    // The platform serves it at apps/web/src/app/developer/cli-sessions, on the developer host (middleware devPortalRewrite).
    assert.equal(SESSIONS_PAGE_URL, 'https://developer.revition.com/cli-sessions');
    assert.ok(REUSE_HINT.endsWith(`review sessions at ${SESSIONS_PAGE_URL}.`));
    assert.doesNotMatch(REUSE_HINT, /settings\/cli/);
  });

  it('[CLI-T1.3.4-AC2] [CLI-T1.2.1-AC3] a revoked session gives exit 3 with the message; a reused refresh token (invalid_grant) ends the session with the copy hint; the local credential is gone', async () => {
    const state = await mkdtemp(join(tmpdir(), 'revlock-'));
    const key = { profile: 'default', host: 'api.revition.com' };
    const base = { key, stateDir: state, now: Date.now, sleep: async () => undefined, warn: () => undefined, skew: () => null };
    const revokedStore = new MemoryStore();
    await revokedStore.set(key, cred());
    await assert.rejects(
      ensureFresh({ ...base, store: revokedStore, refresh: async () => tokenSet('rt-2'), reauthCall: async () => { throw new RevitionCliError({ code: 'session_revoked', message: 'revoked' }, 3); } }),
      (e) => e instanceof RevitionCliError && e.exitCode === 3 && e.message === SESSION_ENDED
    );
    assert.equal(await revokedStore.get(key), null);
    const reused = new MemoryStore();
    await reused.set(key, cred());
    await assert.rejects(
      ensureFresh({ ...base, store: reused, refresh: async () => { throw new OAuthError(400, 'invalid_grant', 'reuse'); }, reauthCall: async () => Date.now() }),
      (e) => e instanceof RevitionCliError && e.exitCode === 3 && /copied/.test(e.error.hint ?? '')
    );
    assert.equal(await reused.get(key), null);
  });

  it('[CLI-T4.3.2-AC3] the normal renewal on this OS: this machine\'s device key signs a reauth the platform rule accepts', async () => {
    // T4.3.2 (REVITION-CLI-PLAN.md:3163-3185): the reauth carries an Ed25519 signature over
    // `sessionId|Auth0 token iat|timestamp` by the device key; the platform (sentinel/cli-sessions/device-signature.ts)
    // verifies it with the registered SPKI public key inside a 60 s window. This runs the CLI's REAL path (ensureFresh
    // -> signReauth) with a key generated on this OS and checks the request with the platform's rule.
    const device = newDeviceKey();
    const state = await mkdtemp(join(tmpdir(), 'revlock-'));
    const key = { profile: 'default', host: 'api.revition.com' };
    const store = new MemoryStore();
    await store.set(key, cred({ devicePrivateKey: device.privateKey }));
    const iat = Math.floor(Date.now() / 1000);
    // Assigned inside the reauth callback, so the declared type is kept (no narrowing to null).
    let seen = null as { sessionId: string; signature: string; timestamp: number } | null;
    const platformAccepts = (sessionId: string, signature: string, timestamp: number, publicKeySpki: string): boolean => {
      if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 60) return false;
      const pub = createPublicKey({ key: Buffer.from(publicKeySpki, 'base64'), format: 'der', type: 'spki' });
      return pub.asymmetricKeyType === 'ed25519' && verify(null, reauthMessage(sessionId, iat, timestamp), pub, Buffer.from(signature, 'base64'));
    };
    const fresh = await ensureFresh({
      key,
      store,
      stateDir: state,
      now: Date.now,
      sleep: async () => undefined,
      warn: () => undefined,
      skew: () => null,
      refresh: async () => ({ ...tokenSet('rt-2'), accessToken: `h.${Buffer.from(JSON.stringify({ iat })).toString('base64url')}.s` }),
      reauthCall: async (sessionId, _token, proof) => {
        seen = { sessionId, signature: proof.signature, timestamp: proof.timestamp };
        if (!platformAccepts(sessionId, proof.signature, proof.timestamp, device.publicKey)) throw new Error('platform refused');
        return Date.now() + 3600_000;
      },
    });
    assert.ok(seen !== null, 'the CLI sent a reauth');
    assert.equal(seen!.sessionId, 'sess-1');
    assert.ok(fresh.authFreshUntil > Date.now(), 'the session is fresh again');
    assert.equal((await store.get(key))?.auth0RefreshToken, 'rt-2');
    // Control: the same request signed by ANOTHER machine's key is refused by the same rule.
    const other = newDeviceKey();
    assert.equal(platformAccepts(seen!.sessionId, seen!.signature, seen!.timestamp, other.publicKey), false);
  });

  it('[CLI-T1.3.4-AC1] concurrent callers near authFreshUntil: exactly 1 refresh and 1 reauth; the new refresh token is stored first', async () => {
    const state = await mkdtemp(join(tmpdir(), 'revlock-'));
    const key = { profile: 'default', host: 'api.revition.com' };
    const store = new MemoryStore();
    await store.set(key, cred());
    let refreshes = 0;
    let reauths = 0;
    const deps = {
      key,
      store,
      stateDir: state,
      now: Date.now,
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      warn: () => undefined,
      skew: () => null,
      refresh: async (rt: string) => {
        refreshes++;
        assert.equal(rt, 'rt-1', 'a spent refresh token was reused');
        return tokenSet('rt-2');
      },
      reauthCall: async () => {
        reauths++;
        assert.equal((await store.get(key))?.auth0RefreshToken, 'rt-2', 'the rotated token must be stored before use');
        return Date.now() + 3600_000;
      },
    };
    const results = await Promise.all(Array.from({ length: 20 }, () => ensureFresh(deps)));
    assert.deepEqual([refreshes, reauths], [1, 1]);
    assert.ok(results.every((r) => r.auth0RefreshToken === 'rt-2'));
  });

  it('[CLI-T1.3.4-AC4] skew handling with a mocked server Date', () => {
    const local = Date.parse('2026-11-18T00:00:00Z');
    const fresh = local + 10 * 60_000;
    // the server is 30 minutes ahead: the session is stale by the server clock although the local clock says fresh
    const skew = skewMs(local, new Date(local + 30 * 60_000).toUTCString());
    assert.equal(skew, 30 * 60_000);
    assert.equal(needsReauth(fresh, local, null), false);
    assert.equal(needsReauth(fresh, local, skew), true);
    // under the tolerance the local clock is used
    assert.equal(effectiveNow(local, 30_000), local);
    assert.equal(skewMs(local, 'not a date'), null);
  });

  it('[CLI-T1.3.4-AC3] offline logout deletes locally, queues the revoke (secrets in the store, not a file) and retries it later', async () => {
    const state = await mkdtemp(join(tmpdir(), 'revq-'));
    const key = { profile: 'default', host: 'api.revition.com' };
    const store = new MemoryStore();
    await store.set(key, cred());
    const offline = () => {
      throw new RevitionCliError({ code: 'NETWORK_ERROR', message: 'offline' }, 9);
    };
    const r = await logoutAndQueue(key, { store, revokeAuth0: async () => offline(), deleteSession: async () => offline() }, state);
    assert.equal(r.queued, true);
    assert.equal(await store.get(key), null);
    assert.deepEqual(await readQueue(state), [{ profile: 'default', host: 'api.revition.com', sessionId: 'sess-1' }]);
    assert.doesNotMatch(await readFile(join(state, 'revoke-queue.json'), 'utf8'), /rvs_|rt-1/);
    const calls: string[] = [];
    const done = await retryQueued(state, { store, revokeAuth0: async (t) => void calls.push(`auth0:${t}`), deleteSession: async (id) => void calls.push(`platform:${id}`) });
    assert.equal(done, 1);
    assert.deepEqual(calls, ['auth0:rt-1', 'platform:sess-1']);
    assert.deepEqual(await readQueue(state), []);
  });

  it('[CLI-T1.3.5-AC1] whoami reflects the server: member vs developer account, never a token', () => {
    const ctx = { host: 'api.revition.com', profile: 'default', email: 'dev@e2e.test', sessionId: 's1', authFreshUntil: 0, method: 'browser' as const };
    const member = describeIdentity({ developerId: 'd', kind: 'tenant_member', linkedOrgId: 'org_1', identityRef: 'auth0|u', verified: true }, ctx);
    assert.deepEqual([member.identityKind, member.workspace, member.note], ['workspace member', 'org_1', null]);
    const indie = describeIdentity({ developerId: 'd', kind: 'independent', linkedOrgId: null, identityRef: 'auth0|u', verified: true }, ctx);
    assert.deepEqual([indie.identityKind, indie.workspace], ['developer account', null]);
    assert.match(indie.note ?? '', /account link-workspace/);
    assert.doesNotMatch(JSON.stringify(member), /rvs_|rvt_/);
  });

  it('[CLI-T1.3.5-AC3] two profiles on two hosts never cross-send credentials', async () => {
    const seen: Array<{ host: string; auth: string | undefined }> = [];
    const start = async (): Promise<string> => {
      const s = http.createServer((req: IncomingMessage, res) => {
        seen.push({ host: String(req.headers.host), auth: req.headers.authorization });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
      await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
      s.unref();
      return `127.0.0.1:${(s.address() as AddressInfo).port}`;
    };
    const [a, b] = [await start(), await start()];
    const ca = new ApiClient({ host: a, token: async () => 'rvs_profile_a', cliVersion: '0' }, { env: {}, basePath: '' });
    const cb = new ApiClient({ host: b, token: async () => 'rvs_profile_b', cliVersion: '0' }, { env: {}, basePath: '' });
    await ca.request({ method: 'GET', path: '/x' });
    await cb.request({ method: 'GET', path: '/x' });
    await ca.request({ method: 'GET', path: `http://${b}/x` });
    assert.deepEqual(seen, [
      { host: a, auth: 'Bearer rvs_profile_a' },
      { host: b, auth: 'Bearer rvs_profile_b' },
      { host: b, auth: undefined },
    ]);
    // and no workspace header is ever sent (T1.3.5 AC2)
    assert.ok(seen.every((s) => !Object.keys(s).some((k) => /org|workspace|tenant/i.test(k))));
  });

  it('[CLI-T1.3.6-AC4] CI implies --no-input even on a TTY (a CI pty must never wait for a prompt)', () => {
    assert.equal(impliedNoInput({ CI: 'true' }, true), true);
    assert.equal(impliedNoInput({ GITHUB_ACTIONS: 'true' }, true), true);
    assert.equal(impliedNoInput({ CI: 'false' }, true), false);
    assert.equal(impliedNoInput({}, true), false);
    assert.equal(impliedNoInput({}, false), true);
  });

  it('[CLI-T1.3.5-AC4] a mutating command prints the acting banner before confirming', async () => {
    const io = memoryIo({ tty: true, answers: ['n'] });
    const code = await executeCommand({
      meta: { id: 'apps:delete', summary: 's', examples: ['e'], requiredScopes: [], mutates: true, confirm: 'prompt', jsonSchemaId: null, stability: 'stable' },
      flags: { json: false, noInput: false, yes: false, experimental: false, profile: undefined, debug: false, color: 'never' },
      args: {},
      commandFlags: {},
      env: {},
      io,
      cliVersion: '0',
      services: {
        loadProfile: async () => ({ name: 'default' }),
        resolveAuth: async () => null,
        featureEnabled: async () => false,
        actingBanner: async () => actingBanner({ user: 'dev@e2e.test', workspace: 'org_1', host: 'api.revition.com' }),
      },
      run2: async () => null,
      human: null,
      confirmTarget: () => null,
      writeHuman: async () => undefined,
    });
    assert.equal(code, 11);
    const err = io.stderr();
    assert.ok(err.indexOf('Acting as dev@e2e.test in org_1 on api.revition.com') < err.indexOf('Run `apps delete`?'), err);
    assert.ok(err.includes('Acting as'));
  });
});
