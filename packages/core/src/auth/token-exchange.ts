import { undici } from '../lazy-deps.js';
import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';
import { dispatcherFor } from '../transport/proxy.js';

/**
 * T1.3.1 step 6 (+ T1.3.4 refresh / revoke, T1.3.2 device code) - the Auth0 Authentication API. The tenant, client and
 * audience come from the host profile (T1.2.1: the audience is `https://<api host>`, never a config file value).
 * REVITION_AUTH_ISSUER / REVITION_AUTH_CLIENT_ID / REVITION_AUTH_AUDIENCE override them (another tenant); a plain-http
 * issuer is accepted only on the loopback (a local mock IdP), never anywhere else.
 */
export interface AuthConfig {
  /** e.g. https://revition.us.auth0.com (no trailing slash). */
  readonly issuerBase: string;
  readonly clientId: string;
  readonly audience: string;
}

export const DEFAULT_AUTH: { readonly issuerBase: string; readonly clientId: string } = {
  issuerBase: 'https://revition.us.auth0.com',
  clientId: 'ZQYQKypbAR6ZaSrw1EeHLRHaZNlLERqo',
};

/**
 * The audience order (T1.2.1, amended 2026-11-23): REVITION_AUTH_AUDIENCE, then the host profile's own `audience`
 * (staging: https://api-staging.revition.com), then `https://<host>` (production and the default).
 */
export function authConfigFor(
  host: string,
  env: Readonly<Record<string, string | undefined>>,
  profileAudience?: string
): AuthConfig {
  // Trailing slashes off by a loop, not a /\/+$/ regex: the value comes from the environment (CodeQL polynomial ReDoS).
  let issuerBase = env['REVITION_AUTH_ISSUER'] ?? DEFAULT_AUTH.issuerBase;
  while (issuerBase.endsWith('/')) issuerBase = issuerBase.slice(0, -1);
  const u = new URL(issuerBase);
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && loopback)) {
    throw new RevitionCliError({ code: 'AUTH_ISSUER_INSECURE', message: `The sign-in issuer ${issuerBase} must use https.` }, EXIT.usage);
  }
  return {
    issuerBase,
    clientId: env['REVITION_AUTH_CLIENT_ID'] ?? DEFAULT_AUTH.clientId,
    audience: env['REVITION_AUTH_AUDIENCE'] ?? profileAudience ?? `https://${host}`,
  };
}

export interface TokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly idToken: string | null;
  readonly expiresIn: number;
}

export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly oauthError: string,
    message: string
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** POST a form to the Authentication API; the body is never logged (auth endpoints, T1.1.4). */
export async function postForm(
  cfg: AuthConfig,
  path: string,
  form: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>
): Promise<Record<string, unknown>> {
  const url = new URL(`${cfg.issuerBase}${path}`);
  let res;
  try {
    res = await undici().request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      dispatcher: dispatcherFor(url, env),
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
    });
  } catch (e) {
    throw new RevitionCliError(
      { code: 'NETWORK_ERROR', message: `Could not reach the sign-in service (${(e as { code?: string }).code ?? 'network error'}).` },
      EXIT.network
    );
  }
  const text = await res.body.text();
  let body: Record<string, unknown>;
  try {
    body = text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
  } catch {
    body = {};
  }
  if (res.statusCode >= 400) {
    const err = typeof body['error'] === 'string' ? body['error'] : `http_${res.statusCode}`;
    throw new OAuthError(res.statusCode, err, typeof body['error_description'] === 'string' ? body['error_description'] : err);
  }
  return body;
}

function tokenSet(body: Record<string, unknown>): TokenSet {
  if (typeof body['access_token'] !== 'string') throw new OAuthError(500, 'invalid_response', 'no access token in the response');
  return {
    accessToken: body['access_token'],
    refreshToken: typeof body['refresh_token'] === 'string' ? body['refresh_token'] : null,
    idToken: typeof body['id_token'] === 'string' ? body['id_token'] : null,
    expiresIn: typeof body['expires_in'] === 'number' ? body['expires_in'] : 0,
  };
}

/** Authorization Code + PKCE (S256) exchange. */
export async function exchangeCode(
  cfg: AuthConfig,
  input: { readonly code: string; readonly verifier: string; readonly redirectUri: string },
  env: Readonly<Record<string, string | undefined>>
): Promise<TokenSet> {
  return tokenSet(
    await postForm(
      cfg,
      '/oauth/token',
      { grant_type: 'authorization_code', client_id: cfg.clientId, code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri },
      env
    )
  );
}

/** Rotating refresh (T1.3.4): the response carries the NEW refresh token. */
export async function refreshTokens(cfg: AuthConfig, refreshToken: string, env: Readonly<Record<string, string | undefined>>): Promise<TokenSet> {
  return tokenSet(await postForm(cfg, '/oauth/token', { grant_type: 'refresh_token', client_id: cfg.clientId, refresh_token: refreshToken }, env));
}

/** POST /oauth/revoke (Authentication API, every plan). */
export async function revokeRefreshToken(cfg: AuthConfig, refreshToken: string, env: Readonly<Record<string, string | undefined>>): Promise<void> {
  await postForm(cfg, '/oauth/revoke', { client_id: cfg.clientId, token: refreshToken }, env);
}

export function authorizeUrl(
  cfg: AuthConfig,
  p: { readonly redirectUri: string; readonly challenge: string; readonly state: string; readonly nonce: string; readonly force: boolean }
): string {
  const u = new URL(`${cfg.issuerBase}/authorize`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('audience', cfg.audience);
  u.searchParams.set('scope', 'openid profile email offline_access');
  if (p.force) u.searchParams.set('prompt', 'login');
  return u.toString();
}

/** Decoded JWT claims (no verification: used only on a token already accepted by the IdP, for iat / exp / sub). */
export function decodeClaims(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (part === undefined) return {};
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
