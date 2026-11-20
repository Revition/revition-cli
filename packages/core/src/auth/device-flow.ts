import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import { OAuthError, postForm, type AuthConfig, type TokenSet } from './token-exchange.js';

/**
 * T1.3.2 - `login --device`, opt-in only, RFC 8628 hardened: the full verification URL is NOT the primary link (the
 * user must compare the code), polling honours `interval` and `slow_down` (+5 s), and stops on expired_token /
 * access_denied or when `expires_in` runs out. A dropped network is retried until expiry.
 */
export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export async function requestDeviceCode(cfg: AuthConfig, env: Readonly<Record<string, string | undefined>>): Promise<DeviceCode> {
  const b = await postForm(cfg, '/oauth/device/code', { client_id: cfg.clientId, scope: 'openid profile email offline_access', audience: cfg.audience }, env);
  return {
    deviceCode: String(b['device_code']),
    userCode: String(b['user_code']),
    verificationUri: String(b['verification_uri']),
    expiresIn: typeof b['expires_in'] === 'number' ? b['expires_in'] : 900,
    interval: typeof b['interval'] === 'number' ? b['interval'] : 5,
  };
}

/** The terminal text (snapshot-tested): the code to compare, and the phishing warning. */
export function deviceWarning(d: Pick<DeviceCode, 'userCode' | 'verificationUri'>, host: string): string {
  return (
    `To sign in, open ${d.verificationUri} on any device and confirm the code ${d.userCode}.\n` +
    `Only continue if YOU just ran 'revition login --device' on ${host}. Never enter a code someone sent you.\n`
  );
}

export interface PollDeps {
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** One token request: returns the tokens, or throws OAuthError (authorization_pending / slow_down / ...). */
  readonly attempt: () => Promise<TokenSet>;
}

export async function pollForTokens(d: DeviceCode, deps: PollDeps): Promise<TokenSet> {
  const deadline = deps.now() + d.expiresIn * 1000;
  let interval = d.interval;
  for (;;) {
    await deps.sleep(interval * 1000);
    if (deps.now() >= deadline) throw expired();
    try {
      return await deps.attempt();
    } catch (e) {
      if (!(e instanceof OAuthError)) {
        if (e instanceof RevitionCliError && e.exitCode === EXIT.network) continue;
        throw e;
      }
      if (e.oauthError === 'authorization_pending') continue;
      if (e.oauthError === 'slow_down') {
        interval += 5;
        continue;
      }
      if (e.oauthError === 'expired_token') throw expired();
      if (e.oauthError === 'access_denied') {
        throw new RevitionCliError({ code: 'LOGIN_DENIED', message: 'The sign-in was denied on the approval page.' }, EXIT.auth);
      }
      throw new RevitionCliError({ code: 'LOGIN_FAILED', message: `The sign-in failed (${e.oauthError}).` }, EXIT.auth);
    }
  }
}

function expired(): RevitionCliError {
  return new RevitionCliError(
    { code: 'DEVICE_CODE_EXPIRED', message: 'The sign-in code expired before it was approved.', hint: 'Run `revition login --device` again and approve the code promptly.' },
    EXIT.auth
  );
}

export function deviceTokenAttempt(cfg: AuthConfig, deviceCode: string, env: Readonly<Record<string, string | undefined>>): () => Promise<TokenSet> {
  return async () => {
    const b = await postForm(cfg, '/oauth/token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: cfg.clientId }, env);
    if (typeof b['access_token'] !== 'string') throw new OAuthError(500, 'invalid_response', 'no access token');
    return {
      accessToken: b['access_token'],
      refreshToken: typeof b['refresh_token'] === 'string' ? b['refresh_token'] : null,
      idToken: typeof b['id_token'] === 'string' ? b['id_token'] : null,
      expiresIn: typeof b['expires_in'] === 'number' ? b['expires_in'] : 0,
    };
  };
}
