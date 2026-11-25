import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { Agent } from 'undici';

import { RevitionCliError } from '../errors/cli-error.js';

import { ApiClient, type TransportDeps } from './client.js';
import { dispatcherFor, proxyFor, proxyLabel } from './proxy.js';
import { backoffMs, retryAfterMs, shouldRetry } from './retry.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
const servers: Array<{ close: () => void }> = [];
after(() => servers.forEach((s) => s.close()));

async function httpServer(handler: Handler): Promise<{ host: string; seen: Array<{ method: string; url: string; headers: IncomingMessage['headers'] }> }> {
  const seen: Array<{ method: string; url: string; headers: IncomingMessage['headers'] }> = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString()));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  servers.push(server);
  return { host: `127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
};

function client(host: string, deps: Partial<TransportDeps> = {}, sleeps: number[] = []): ApiClient {
  return new ApiClient(
    { host, token: async () => 'tok-123', cliVersion: '0.1.0' },
    {
      env: {},
      scheme: 'http',
      basePath: '',
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
      dispatcher: () => new Agent(),
      ...deps,
    }
  );
}

describe('T1.1.5 HTTPS transport', () => {
  it('[CLI-T1.1.5-AC1] a self-signed server is refused (exit 9); NODE_TLS_REJECT_UNAUTHORIZED=0 is refused before sending', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'revtls-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
    let hits = 0;
    const server = https.createServer({ key: await readFile(join(dir, 'k.pem')), cert: await readFile(join(dir, 'c.pem')) }, (_req, res) => {
      hits++;
      res.end('{}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const host = `localhost:${(server.address() as AddressInfo).port}`;
    const verifying = new ApiClient({ host, token: async () => 'tok', cliVersion: '0.1.0' }, { env: {}, scheme: 'https', basePath: '', sleep: async () => undefined, dispatcher: (t) => dispatcherFor(t, {}) });
    await assert.rejects(verifying.request({ method: 'GET', path: '/x' }), (e) => e instanceof RevitionCliError && e.exitCode === 9 && e.error.code === 'TLS_ERROR');
    const disabled = new ApiClient({ host, token: async () => 'tok', cliVersion: '0.1.0' }, { env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, scheme: 'https', basePath: '' });
    await assert.rejects(disabled.request({ method: 'GET', path: '/x' }), (e) => e instanceof RevitionCliError && e.exitCode === 9 && e.error.code === 'TLS_VERIFICATION_DISABLED');
    assert.equal(hits, 0, 'no request may reach a server whose certificate does not verify');
  });

  it('[CLI-T1.1.5-AC2] retries only on the allowed classes; a retried mutation reuses the same Idempotency-Key', async () => {
    let n = 0;
    const s = await httpServer((_req, _b, res) => (++n < 3 ? send(res, 503, { error: { code: 'BUSY', message: 'busy' } }) : send(res, 201, { ok: true })));
    const r = await client(s.host).request({ method: 'POST', path: '/dev/apps', body: { name: 'a' } });
    assert.equal(r.status, 201);
    assert.equal(r.attempts, 3);
    const keys = s.seen.map((x) => x.headers['idempotency-key']);
    assert.equal(new Set(keys).size, 1);
    assert.match(String(keys[0]), /^[0-9a-f-]{36}$/);
    assert.equal(new Set(s.seen.map((x) => x.headers['x-request-id'])).size, 3, 'each attempt has its own request id');
    // 400 / 403 / 500 are never retried
    for (const status of [400, 403, 500]) {
      const t = await httpServer((_q, _b, res) => send(res, status, { error: { code: 'E', message: 'no' } }));
      await assert.rejects(client(t.host).request({ method: 'GET', path: '/x' }), RevitionCliError);
      assert.equal(t.seen.length, 1, `status ${status} was retried`);
    }
    // GET 502 is retried up to the limit
    const g = await httpServer((_q, _b, res) => send(res, 502, {}));
    await assert.rejects(client(g.host).request({ method: 'GET', path: '/x' }), (e) => e instanceof RevitionCliError && e.exitCode === 8);
    assert.equal(g.seen.length, 4);
    // a mutation without an Idempotency-Key is never retried; GET never carries one
    assert.equal(shouldRetry({ method: 'POST', status: 503, errorCode: null, hasIdempotencyKey: false }), false);
    assert.equal(g.seen[0]?.headers['idempotency-key'], undefined);
    assert.equal(shouldRetry({ method: 'GET', status: null, errorCode: 'ECONNRESET', hasIdempotencyKey: false }), true);
  });

  it('[CLI-T1.1.5-AC3] Retry-After is honoured (seconds and HTTP date); otherwise full-jitter backoff', async () => {
    let n = 0;
    const s = await httpServer((_q, _b, res) => (++n === 1 ? send(res, 429, {}, { 'retry-after': '2' }) : send(res, 200, {})));
    const sleeps: number[] = [];
    await client(s.host, {}, sleeps).request({ method: 'GET', path: '/x' });
    assert.deepEqual(sleeps, [2000]);
    assert.equal(retryAfterMs('Wed, 18 Nov 2026 00:00:05 GMT', Date.parse('2026-11-18T00:00:00Z')), 5000);
    assert.equal(retryAfterMs(null, 0), null);
    assert.equal(backoffMs(0, () => 0.999), 249);
    assert.equal(backoffMs(10, () => 0.999), 7992);
    assert.equal(backoffMs(3, () => 0), 0);
  });

  it('[CLI-T1.1.5-AC4] the HTTPS_PROXY proxy is used; NO_PROXY is honoured', async () => {
    assert.equal(proxyFor(new URL('https://api.revition.com/x'), { HTTPS_PROXY: 'http://p:3128' }), 'http://p:3128');
    assert.equal(proxyFor(new URL('https://api.revition.com/x'), { https_proxy: 'http://p:3128' }), 'http://p:3128');
    assert.equal(proxyFor(new URL('https://api.revition.com/x'), { HTTPS_PROXY: 'http://p:3128', NO_PROXY: '.revition.com' }), null);
    assert.equal(proxyFor(new URL('https://api.revition.com/x'), { HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'revition.com' }), null);
    assert.equal(proxyFor(new URL('https://api.revition.com/x'), { HTTPS_PROXY: 'http://p:3128', NO_PROXY: '*' }), null);
    assert.equal(proxyFor(new URL('https://api.revition.com/x'), { HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'other.com,revition.com:8443' }), 'http://p:3128');
    assert.equal(proxyLabel('http://user:secret@p:3128'), 'http://p:3128/');
    // A real CONNECT proxy in the path: the request goes through it.
    const target = await httpServer((_q, _b, res) => send(res, 200, { via: 'proxy' }));
    const tunnels: string[] = [];
    const proxy = http.createServer();
    proxy.on('connect', (req, socket, head) => {
      tunnels.push(req.url ?? '');
      const [h, p] = (req.url ?? '').split(':');
      const up = net.connect(Number(p), h, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        up.write(head);
        up.pipe(socket);
        socket.pipe(up);
      });
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    servers.push(proxy);
    const env = { HTTP_PROXY: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` };
    const viaProxy = client(target.host, { env, dispatcher: (t) => dispatcherFor(t, env) });
    assert.equal((await viaProxy.request({ method: 'GET', path: '/x' })).status, 200);
    assert.deepEqual(tunnels, [target.host]);
    const bypass = { ...env, NO_PROXY: '127.0.0.1' };
    await client(target.host, { env: bypass, dispatcher: (t) => dispatcherFor(t, bypass) }).request({ method: 'GET', path: '/x' });
    assert.equal(tunnels.length, 1, 'NO_PROXY must bypass the proxy');
  });

  it('[CLI-T1.1.5-AC5] a token is never sent when the request host differs from the profile host', async () => {
    const profileHost = await httpServer((_q, _b, res) => send(res, 200, {}));
    const otherHost = await httpServer((_q, _b, res) => send(res, 200, {}));
    const c = client(profileHost.host);
    await c.request({ method: 'GET', path: '/dev/me' });
    await c.request({ method: 'GET', path: `http://${otherHost.host}/upload` });
    assert.equal(profileHost.seen[0]?.headers['authorization'], 'Bearer tok-123');
    assert.equal(otherHost.seen[0]?.headers['authorization'], undefined);
    assert.equal(c.resolve({ method: 'GET', path: `https://${profileHost.host}/x` }).bound, false, 'scheme must match too');
    const h = profileHost.seen[0]?.headers ?? {};
    assert.match(String(h['user-agent']), /^revition-cli\/0\.1\.0 \(.+; node .+\)$/);
    assert.equal(h['revition-cli-version'], '0.1.0');
    assert.equal(h['revition-api-version'], '2026-10-01');
  });

  it('[CLI-T1.1.5-AC2] 401 session_stale: one transparent reauth, then retry once; session_revoked -> exit 3; 426 -> exit 10', async () => {
    let n = 0;
    const stale = await httpServer((_q, _b, res) =>
      ++n === 1 ? send(res, 401, { error: { code: 'session_stale', message: 'stale' } }) : send(res, 200, { ok: 1 })
    );
    let reauths = 0;
    const r = await client(stale.host, { reauth: async () => ++reauths > 0 }).request({ method: 'GET', path: '/x' });
    assert.equal(r.status, 200);
    assert.equal(reauths, 1);
    const revoked = await httpServer((_q, _b, res) => send(res, 401, { error: { code: 'session_revoked', message: 'revoked' } }));
    await assert.rejects(client(revoked.host, { reauth: async () => true }).request({ method: 'GET', path: '/x' }), (e) => e instanceof RevitionCliError && e.exitCode === 3);
    const upgrade = await httpServer((_q, _b, res) => send(res, 426, { error: { code: 'CLI_UPGRADE_REQUIRED', message: 'Upgrade to 0.2.0 or later.' } }));
    await assert.rejects(client(upgrade.host).request({ method: 'GET', path: '/x' }), (e) => e instanceof RevitionCliError && e.exitCode === 10 && /0\.2\.0/.test(e.error.message));
  });
});
