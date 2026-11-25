/**
 * L3 rig (REVITION-CLI-PLAN.md:3265 "real OS keychains / paths / browsers / proxies"): real network pieces for the
 * black-box suite, all on 127.0.0.1, so the installed CLI makes REAL TLS / proxy / HTTP calls and no byte leaves the
 * machine:
 *   - a throwaway CA + a leaf for *.revition.com and registry.npmjs.org (openssl), trusted only via NODE_EXTRA_CA_CERTS;
 *   - a TLS mock (the platform + the registry, by Host header);
 *   - an HTTP proxy that tunnels every CONNECT to the TLS mock and forwards absolute-URI requests, logging both;
 *   - a plain HTTP status mock (the platform on a loopback host) whose answer is chosen per call.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Pki {
  readonly dir: string;
  readonly caFile: string;
  readonly key: Buffer;
  readonly cert: Buffer;
}

export function makePki(): Pki {
  const dir = mkdtempSync(join(tmpdir(), 'rvl3-pki-'));
  const ssl = (args: readonly string[]): void => void execFileSync('openssl', [...args], { cwd: dir, stdio: 'ignore' });
  ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2',
    '-subj', '/CN=Revition L3 throwaway CA', '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  ssl(['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=l3.revition.com']);
  writeFileSync(
    join(dir, 'leaf.ext'),
    'subjectAltName=DNS:*.revition.com,DNS:revition.com,DNS:registry.npmjs.org\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n'
  );
  ssl(['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'leaf.pem',
    '-days', '2', '-extfile', 'leaf.ext']);
  return { dir, caFile: join(dir, 'ca.pem'), key: readFileSync(join(dir, 'leaf.key')), cert: readFileSync(join(dir, 'leaf.pem')) };
}

export interface Hit {
  readonly at: number;
  readonly host: string;
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
}

/** Whether a recorded Host header names exactly `name` (any port): an exact match, never a prefix one. */
export function hostIs(host: string, name: string): boolean {
  return host === name || host.startsWith(`${name}:`);
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', date: new Date().toUTCString(), ...headers }).end(JSON.stringify(body));
};

const ME = { developerId: 'dev_l3', kind: 'tenant_member', linkedOrgId: 'org_l3', identityRef: 'auth0|l3', verified: true, method: 'token' };

function record(req: IncomingMessage, log: Hit[]): Hit {
  const hit = {
    at: Date.now(),
    host: String(req.headers.host ?? ''),
    method: req.method ?? '',
    path: (req.url ?? '').split('?')[0] ?? '',
    authorization: req.headers.authorization,
  };
  log.push(hit);
  return hit;
}

/** The TLS mock: the platform (any *.revition.com) and the npm registry, told apart by Host. */
export async function startTlsMock(pki: Pki): Promise<{ port: number; log: Hit[]; close(): void }> {
  const log: Hit[] = [];
  const server = https.createServer({ key: pki.key, cert: pki.cert }, (req, res) => {
    req.resume();
    req.on('end', () => {
      const hit = record(req, log);
      if (hostIs(hit.host, 'registry.npmjs.org')) return json(res, 200, { 'dist-tags': { latest: '0.1.0' }, versions: {} });
      if (hit.method === 'HEAD') return void res.writeHead(200, { date: new Date().toUTCString() }).end();
      if (hit.path === '/api/v1/foundry/dev/me') {
        return (hit.authorization ?? '').startsWith('Bearer rvt_') ? json(res, 200, ME) : json(res, 401, { error: { code: 'CLI_SIGN_IN_REQUIRED', message: 'sign in' } });
      }
      return json(res, 404, { error: { code: 'NOT_FOUND', message: hit.path } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, log, close: () => server.close() };
}

export interface ProxyEvent {
  readonly kind: 'connect' | 'forward';
  readonly target: string;
}

/** A real HTTP proxy: CONNECT -> tunnelled to the TLS mock; absolute-URI requests -> forwarded as-is. */
export async function startProxy(tlsPort: number): Promise<{ url: string; events: ProxyEvent[]; close(): void }> {
  const events: ProxyEvent[] = [];
  const server = http.createServer((req, res) => {
    const target = new URL(req.url ?? '');
    events.push({ kind: 'forward', target: target.host });
    const up = http.request(
      { host: target.hostname, port: target.port, path: `${target.pathname}${target.search}`, method: req.method, headers: req.headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      }
    );
    up.on('error', () => res.writeHead(502).end());
    req.pipe(up);
  });
  server.on('connect', (req: IncomingMessage, client: net.Socket, head: Buffer) => {
    const target = req.url ?? '';
    events.push({ kind: 'connect', target });
    // undici tunnels plain-HTTP targets with CONNECT too: a loopback target is tunnelled to itself; every named host
    // (*.revition.com, registry.npmjs.org) to the local TLS mock, so nothing ever reaches a real host.
    const loop = /^127\.0\.0\.1:(\d+)$/u.exec(target);
    const upstream = net.connect(loop !== null ? Number(loop[1]) : tlsPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    events,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

/** A plain-HTTP platform on a loopback host: `answer` decides each /dev/me response (status, extra headers). */
export async function startStatusMock(
  answer: (n: number) => { status: number; headers?: Record<string, string>; delayMs?: number }
): Promise<{ host: string; log: Hit[]; close(): void }> {
  const log: Hit[] = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const hit = record(req, log);
      if (hit.path !== '/api/v1/foundry/dev/me') return json(res, 404, { error: { code: 'NOT_FOUND', message: hit.path } });
      const a = answer(n++);
      const send = (): void =>
        a.status === 200
          ? json(res, 200, ME, a.headers)
          : json(res, a.status, { error: { code: `L3_${a.status}`, message: `L3 mock answered ${a.status}` } }, a.headers);
      if (a.delayMs !== undefined) setTimeout(send, a.delayMs);
      else send();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    host: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    log,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

/** A port nothing listens on (bound, then released). */
export async function closedPort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

export interface Ran {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

/** Spawns `file args` with exactly `env` (no inherited proxy / XDG noise) in `cwd`. */
export function run(
  file: string,
  args: readonly string[],
  env: Record<string, string | undefined>,
  cwd?: string,
  timeoutMs = 60_000,
  stdin: 'pipe' | 'ignore' = 'pipe'
): Promise<Ran> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    // `script` (the PTY) needs stdin to be /dev/null, not a pipe; every other child gets an empty, closed pipe.
    const child = spawn(file, [...args], { env: env as NodeJS.ProcessEnv, cwd, stdio: [stdin, 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, ms: performance.now() - started });
    });
    child.stdin?.end('');
  });
}

/** The child env: PATH and node only, plus `extra`; proxies, XDG and REVITION_* from the parent never leak in. */
export function baseEnv(home: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    PATH: process.env['PATH'],
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(home, 'AppData', 'Local'),
    TMPDIR: process.env['TMPDIR'],
    LANG: 'en_US.UTF-8',
    REVITION_NO_UPDATE_CHECK: '1',
    ...extra,
  };
}
