import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Test kit for Set 3: a mock Auth0 tenant and a mock platform, each on its own 127.0.0.1 port, recording every
 * request. Test data only (no real tenant, no real secret).
 */
export const CLIENT_ID = 'test-cli-client';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...(publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'k1', alg: 'RS256', use: 'sig' };
const { privateKey: otherKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
export function jwt(claims: Record<string, unknown>, key = privateKey): string {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid: 'k1' });
  const body = b64(claims);
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

export interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

async function serve(handler: (req: IncomingMessage, body: string, res: ServerResponse) => void, log: Recorded[]): Promise<{ server: Server; base: string; host: string }> {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString()));
    req.on('end', () => {
      log.push({ method: req.method ?? '', path: (req.url ?? '').split('?')[0] ?? '', headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { server, base: `http://127.0.0.1:${port}`, host: `127.0.0.1:${port}` };
}

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', date: new Date().toUTCString() }).end(JSON.stringify(body));
};

export interface MockOptions {
  readonly badNonce?: boolean;
  readonly badSignature?: boolean;
  /** The org policy refuses device sign-ins at the session exchange (T4.3.1). */
  readonly denyDevice?: boolean;
  /** Device polling script: each entry is the answer of one token poll before success. */
  readonly devicePolls?: readonly string[];
  /** The platform answers reauth with 401 session_revoked. */
  readonly revoked?: boolean;
  readonly kind?: 'tenant_member' | 'independent';
  /** Server-side flags (GET /dev/cli/flags). */
  readonly flags?: Record<string, boolean>;
  /** Every other platform call answers 426 (the CLI is below the minimum version). */
  readonly upgradeRequired?: boolean;
}

export interface MockAuth {
  readonly issuer: string;
  readonly apiHost: string;
  readonly idpLog: Recorded[];
  readonly apiLog: Recorded[];
  readonly state: { challenge: string; nonce: string; refreshTokens: string[]; reauthCalls: number; refreshCalls: number; credential: string };
  close(): void;
}

export async function startMockAuth(opts: MockOptions = {}): Promise<MockAuth> {
  const idpLog: Recorded[] = [];
  const apiLog: Recorded[] = [];
  const credential = `rvs_${randomBytes(30).toString('base64url').replace(/[^A-Za-z0-9]/g, 'a').slice(0, 40)}`;
  const state = { challenge: '', nonce: '', refreshTokens: ['rt-0'], reauthCalls: 0, refreshCalls: 0, credential };
  let polls = [...(opts.devicePolls ?? [])];
  let issuer = '';
  const access = (): string => jwt({ sub: 'auth0|u1', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, azp: CLIENT_ID });
  const tokens = (withNonce: boolean): Record<string, unknown> => {
    const rt = `rt-${state.refreshTokens.length}`;
    state.refreshTokens.push(rt);
    const idClaims = {
      iss: `${issuer}/`,
      aud: CLIENT_ID,
      sub: 'auth0|u1',
      email: 'dev@e2e.test',
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...(withNonce ? { nonce: opts.badNonce === true ? 'wrong-nonce' : state.nonce } : {}),
    };
    return { access_token: access(), refresh_token: rt, id_token: jwt(idClaims, opts.badSignature === true ? otherKey : privateKey), expires_in: 3600 };
  };
  const idp = await serve((req, body, res) => {
    const path = (req.url ?? '').split('?')[0];
    const form = new URLSearchParams(body);
    if (path === '/.well-known/jwks.json') return json(res, 200, { keys: [JWK] });
    if (path === '/oauth/device/code') {
      return json(res, 200, { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: `${issuer}/activate`, verification_uri_complete: `${issuer}/activate?user_code=ABCD-EFGH`, expires_in: 600, interval: 1 });
    }
    if (path === '/oauth/revoke') return json(res, 200, {});
    if (path === '/oauth/token') {
      const grant = form.get('grant_type');
      if (grant === 'authorization_code') {
        const ok = createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === state.challenge && form.get('code') === 'code-1';
        return ok ? json(res, 200, tokens(true)) : json(res, 400, { error: 'invalid_grant' });
      }
      if (grant === 'refresh_token') {
        state.refreshCalls += 1;
        const latest = state.refreshTokens[state.refreshTokens.length - 1];
        if (form.get('refresh_token') !== latest) return json(res, 400, { error: 'invalid_grant', error_description: 'reuse detected' });
        return json(res, 200, tokens(false));
      }
      if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
        const next = polls.shift();
        if (next !== undefined) return json(res, 400, { error: next });
        polls = [];
        return json(res, 200, tokens(false));
      }
    }
    return json(res, 404, { error: 'not_found' });
  }, idpLog);
  issuer = idp.base;
  let method: 'browser' | 'device' = 'browser';
  const api = await serve((req, body, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    const auth = req.headers.authorization ?? '';
    if (req.method === 'POST' && path === '/api/v1/foundry/dev/cli/sessions') {
      const parsed = JSON.parse(body) as { devicePublicKey?: string };
      if (typeof parsed.devicePublicKey !== 'string') return json(res, 400, { error: { code: 'CLI_SESSION_INVALID_INPUT', message: 'bad' } });
      const device = idpLog.some((r) => r.path === '/oauth/device/code');
      method = device ? 'device' : 'browser';
      if (device && opts.denyDevice === true) {
        return json(res, 403, { error: { code: 'CLI_POLICY_LOGIN_METHOD_DENIED', message: 'This workspace does not allow the device sign-in for the CLI.' } });
      }
      return json(res, 201, { sessionId: 'sess-1', credential, authFreshUntil: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (req.method === 'POST' && /^\/api\/v1\/foundry\/dev\/cli\/sessions\/[^/]+\/reauth$/.test(path)) {
      state.reauthCalls += 1;
      if (opts.revoked === true) return json(res, 401, { error: { code: 'session_revoked', message: 'revoked' } });
      return json(res, 200, { authFreshUntil: new Date(Date.now() + 3600_000).toISOString() });
    }
    if (req.method === 'DELETE' && path.startsWith('/api/v1/foundry/dev/cli/sessions/')) return json(res, 200, { revokedAt: new Date().toISOString() });
    if (!auth.startsWith('Bearer rvs_') && !auth.startsWith('Bearer rvt_')) return json(res, 401, { error: { code: 'CLI_SIGN_IN_REQUIRED', message: 'sign in' } });
    if (opts.upgradeRequired === true) {
      return json(res, 426, { error: { code: 'CLI_UPGRADE_REQUIRED', message: 'This CLI is too old: upgrade to 0.2.0 or later.' } });
    }
    if (path === '/api/v1/foundry/dev/me') {
      const kind = opts.kind ?? 'tenant_member';
      return json(res, 200, { developerId: 'dev_1', kind, linkedOrgId: kind === 'tenant_member' ? 'org_e2e' : null, identityRef: 'auth0|u1', verified: true, method });
    }
    if (path === '/api/v1/foundry/dev/tokens' && req.method === 'GET') {
      return json(res, 200, { tokens: [{ tokenId: 'tok_1', name: 'ci', prefix: 'rvt_abcd', scopes: ['cli:read'], expiresAt: '2026-12-01T00:00:00.000Z', revokedAt: null, lastUsedAt: null }] });
    }
    if (path === '/api/v1/foundry/dev/tokens' && req.method === 'POST') {
      return json(res, 201, { token: `rvt_${'Z'.repeat(40)}`, pat: { tokenId: 'tok_2', prefix: 'rvt_ZZZZ', scopes: ['cli:read'], expiresAt: '2026-12-01T00:00:00.000Z' } });
    }
    if (req.method === 'DELETE' && path.startsWith('/api/v1/foundry/dev/tokens/')) return json(res, 200, { tokenId: path.split('/').pop(), revokedAt: '2026-11-18T00:00:00.000Z' });
    if (path.startsWith('/api/v1/foundry/runtime-secrets')) return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    if (req.method === 'POST' && path === '/api/v1/foundry/dev/cli/telemetry') {
      return json(res, 202, { accepted: (JSON.parse(body) as { events: unknown[] }).events.length });
    }
    if (req.method === 'GET' && path === '/api/v1/foundry/dev/cli/flags') return json(res, 200, { flags: opts.flags ?? {}, ttl: 3600 });
    return json(res, 404, { error: { code: 'NOT_FOUND', message: path } });
  }, apiLog);
  return {
    issuer,
    apiHost: api.host,
    idpLog,
    apiLog,
    state,
    close: () => {
      idp.server.close();
      api.server.close();
      idp.server.closeAllConnections();
      api.server.closeAllConnections();
    },
  };
}
