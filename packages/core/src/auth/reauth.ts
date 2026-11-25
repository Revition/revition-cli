import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';
import type { CredentialKey, CredentialStore, StoredCredential } from '../credentials/store.js';
import { accountOf } from '../credentials/store.js';

import { ApiClient } from '../transport/client.js';

import { signReauth } from './device-key.js';
import { acquireLock, type LockDeps } from './lock.js';
import { patFromEnv, tokenPrefix } from './pat.js';
import { needsReauth, skewMs } from './skew.js';
import { authConfigFor, decodeClaims, OAuthError, refreshTokens, type TokenSet } from './token-exchange.js';

/**
 * T1.3.4 - keep the session usable: before a request, when now > authFreshUntil - 60 s:
 *   1 Auth0 refresh (rotating) -> store the NEW refresh token atomically FIRST
 *   2 POST /dev/cli/sessions/{id}/reauth (bearer = the new Auth0 access token; the device-key signature)
 *   3 discard the Auth0 access token
 * One re-auth in flight per (profile, host) across processes (lock); after taking the lock the credential is read
 * again, so a process that waited uses the other process's result instead of reusing a spent refresh token.
 * invalid_grant / session_revoked -> the session ended: the local credential is deleted, exit 3.
 */
export interface ReauthDeps extends LockDeps {
  readonly store: CredentialStore;
  readonly key: CredentialKey;
  readonly stateDir: string;
  readonly skew: () => number | null;
  readonly refresh: (refreshToken: string) => Promise<TokenSet>;
  /** POST /dev/cli/sessions/{id}/reauth; returns the new authFreshUntil (epoch ms). */
  readonly reauthCall: (sessionId: string, auth0AccessToken: string, body: { signature: string; timestamp: number }) => Promise<number>;
}

export const SESSION_ENDED = "Your session ended (it may have been revoked). Run 'revition login'.";
/** The Developer Portal's CLI sessions page (the platform's `developer/cli-sessions` route, served on its own host). */
export const SESSIONS_PAGE_URL = 'https://developer.revition.com/cli-sessions';
export const REUSE_HINT = `If you did not run commands in parallel from another copy of these credentials, your token may have been copied; review sessions at ${SESSIONS_PAGE_URL}.`;

export async function sessionEnded(deps: Pick<ReauthDeps, 'store' | 'key'>, reuse: boolean): Promise<RevitionCliError> {
  await deps.store.delete(deps.key);
  return new RevitionCliError({ code: 'SESSION_ENDED', message: SESSION_ENDED, hint: reuse ? REUSE_HINT : null }, EXIT.auth);
}

export type AuthMode = 'pat' | 'session' | 'none';

export interface SessionClientInputs {
  readonly profile: string;
  readonly host: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stateDir: string;
  readonly cliVersion: string;
  /** null when no credential store is available (and no PAT): then the run is signed out. */
  readonly store: CredentialStore | null;
  readonly warn: (m: string) => void;
}

export interface SessionClient {
  readonly mode: AuthMode;
  readonly client: ApiClient;
  readonly stored: StoredCredential | null;
}

/**
 * The client of a command run. REVITION_TOKEN wins (CI; memory only; a one-line notice when a stored login exists
 * too). Otherwise the stored session: its credential is made fresh before each request, and a 401 session_stale gets
 * one forced reauth. No credential = signed out (commands that need scopes refuse earlier, exit 3).
 */
export async function createSessionClient(i: SessionClientInputs): Promise<SessionClient> {
  const key = { profile: i.profile, host: i.host };
  const pat = patFromEnv(i.env);
  const stored = i.store === null ? null : await i.store.get(key).catch(() => null);
  if (pat !== null) {
    if (stored !== null) i.warn('REVITION_TOKEN is set: it is used instead of the stored login for this run.');
    return {
      mode: 'pat',
      stored: null,
      client: new ApiClient({ host: i.host, token: async () => pat, cliVersion: i.cliVersion, credentialLabel: tokenPrefix(pat) }, { env: i.env }),
    };
  }
  if (stored === null || i.store === null) {
    return { mode: 'none', stored: null, client: new ApiClient({ host: i.host, token: async () => null, cliVersion: i.cliVersion }, { env: i.env }) };
  }
  const store = i.store;
  const cfg = authConfigFor(i.host, i.env);
  let skew: number | null = null;
  const deps: ReauthDeps = {
    store,
    key,
    stateDir: i.stateDir,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    warn: i.warn,
    skew: () => skew,
    refresh: (rt) => refreshTokens(cfg, rt, i.env),
    reauthCall: async (sessionId, accessToken, body) => {
      const c = new ApiClient({ host: i.host, token: async () => accessToken, cliVersion: i.cliVersion, retries: 0 }, { env: i.env });
      const r = await c.request<{ authFreshUntil: string }>({ method: 'POST', path: `/dev/cli/sessions/${encodeURIComponent(sessionId)}/reauth`, body });
      const date = r.headers['date'];
      if (typeof date === 'string') skew = skewMs(Date.now(), date);
      return Date.parse(r.body.authFreshUntil);
    },
  };
  const client = new ApiClient(
    {
      host: i.host,
      cliVersion: i.cliVersion,
      token: async () => (await ensureFresh(deps)).credential,
    },
    {
      env: i.env,
      reauth: async () => {
        await ensureFresh(deps, true);
        return true;
      },
    }
  );
  return { mode: 'session', stored, client };
}

/** Returns a fresh credential (re-authing first when needed). */
export async function ensureFresh(deps: ReauthDeps, force = false): Promise<StoredCredential> {
  const first = await deps.store.get(deps.key);
  if (first === null) throw new RevitionCliError({ code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login`.' }, EXIT.auth);
  if (!force && !needsReauth(first.authFreshUntil, deps.now(), deps.skew())) return first;
  const release = await acquireLock(deps.stateDir, accountOf(deps.key), deps);
  try {
    const current = await deps.store.get(deps.key);
    if (current === null) throw await sessionEnded(deps, false);
    // Another process re-authed while this one waited for the lock: use its result (never a spent refresh token).
    if (force ? current.authFreshUntil !== first.authFreshUntil : !needsReauth(current.authFreshUntil, deps.now(), deps.skew())) {
      return current;
    }
    let tokens: TokenSet;
    try {
      tokens = await deps.refresh(current.auth0RefreshToken);
    } catch (e) {
      if (e instanceof OAuthError && e.oauthError === 'invalid_grant') throw await sessionEnded(deps, true);
      throw e;
    }
    // The rotated refresh token is persisted BEFORE it is used anywhere.
    const rotated: StoredCredential = { ...current, auth0RefreshToken: tokens.refreshToken ?? current.auth0RefreshToken };
    await deps.store.set(deps.key, rotated);
    const iat = Number(decodeClaims(tokens.accessToken)['iat'] ?? Math.floor(deps.now() / 1000));
    const timestamp = Math.floor(deps.now() / 1000);
    let authFreshUntil: number;
    try {
      authFreshUntil = await deps.reauthCall(current.sessionId, tokens.accessToken, {
        signature: signReauth(current.devicePrivateKey, current.sessionId, iat, timestamp),
        timestamp,
      });
    } catch (e) {
      if (e instanceof RevitionCliError && e.exitCode === EXIT.auth) throw await sessionEnded(deps, false);
      throw e;
    }
    const fresh: StoredCredential = { ...rotated, authFreshUntil };
    await deps.store.set(deps.key, fresh);
    return fresh;
  } finally {
    await release();
  }
}
