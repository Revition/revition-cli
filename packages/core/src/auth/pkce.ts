import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** T1.3.1 step 1 - PKCE S256 only (never `plain`), plus state and nonce. */
export interface PkceSet {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: 'S256';
  readonly state: string;
  readonly nonce: string;
}

export const b64url = (b: Buffer): string => b.toString('base64url');

export function challengeOf(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

export function newPkce(random: (n: number) => Buffer = randomBytes): PkceSet {
  const verifier = b64url(random(32));
  return { verifier, challenge: challengeOf(verifier), method: 'S256', state: b64url(random(16)), nonce: b64url(random(16)) };
}

/** Constant-time string comparison (state checks). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
