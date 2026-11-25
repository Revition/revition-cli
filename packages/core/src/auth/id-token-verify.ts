import { createPublicKey, verify, type webcrypto } from 'node:crypto';

type JsonWebKey = webcrypto.JsonWebKey;

import { undici } from '../lazy-deps.js';
import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';
import { dispatcherFor } from '../transport/proxy.js';

import type { AuthConfig } from './token-exchange.js';

/**
 * T1.3.1 step 6 - the id_token is verified before anything is trusted: RS256 signature against the tenant JWKS, iss,
 * aud (the CLI client), exp, and the nonce this login sent. Any failure refuses the login (exit 3).
 */
export interface Jwks {
  readonly keys: ReadonlyArray<JsonWebKey & { kid?: string; alg?: string }>;
}

const refuse = (why: string): RevitionCliError =>
  new RevitionCliError({ code: 'ID_TOKEN_INVALID', message: `The sign-in response failed verification (${why}).` }, EXIT.auth);

export async function fetchJwks(cfg: AuthConfig, env: Readonly<Record<string, string | undefined>>): Promise<Jwks> {
  const url = new URL(`${cfg.issuerBase}/.well-known/jwks.json`);
  const res = await undici().request(url, { dispatcher: dispatcherFor(url, env), headersTimeout: 15_000, bodyTimeout: 15_000 });
  return (await res.body.json()) as Jwks;
}

export function verifyIdToken(
  idToken: string,
  /** nonce null = the device flow, which sends none (RFC 8628); the browser flow always passes its own. */
  input: { readonly jwks: Jwks; readonly cfg: AuthConfig; readonly nonce: string | null; readonly nowSec: number }
): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw refuse('malformed');
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8')) as { alg?: string; kid?: string };
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw refuse('malformed');
  }
  if (header.alg !== 'RS256') throw refuse('algorithm');
  const jwk = input.jwks.keys.find((k) => k.kid === header.kid) ?? (input.jwks.keys.length === 1 ? input.jwks.keys[0] : undefined);
  if (jwk === undefined) throw refuse('unknown signing key');
  let ok: boolean;
  try {
    ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) throw refuse('signature');
  if (claims['iss'] !== `${input.cfg.issuerBase}/`) throw refuse('issuer');
  const aud = claims['aud'];
  if (!(aud === input.cfg.clientId || (Array.isArray(aud) && aud.includes(input.cfg.clientId)))) throw refuse('audience');
  if (typeof claims['exp'] !== 'number' || claims['exp'] < input.nowSec - 60) throw refuse('expired');
  if (input.nonce !== null && claims['nonce'] !== input.nonce) throw refuse('nonce');
  return claims;
}
