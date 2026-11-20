import { z } from 'zod';

/**
 * T1.3.3 - the credential store. The session credential, the Auth0 refresh token and the device key live ONLY here
 * (never in config, never in a plaintext file), keyed per (profile, host). PATs are never stored by the CLI (T1.3.6).
 */
export const CREDENTIAL_SERVICE = 'revition-cli';

export interface CredentialKey {
  readonly profile: string;
  readonly host: string;
}

export const StoredCredentialSchema = z
  .object({
    /** The rvs_ session credential (T1.2.2). */
    credential: z.string().startsWith('rvs_'),
    auth0RefreshToken: z.string().min(1),
    /** Ed25519 private key (PKCS8 DER, base64), used only to sign a reauth. */
    devicePrivateKey: z.string().min(1),
    sessionId: z.string().min(1),
    /** Epoch ms. */
    authFreshUntil: z.number(),
    method: z.enum(['browser', 'device']),
    /** Display only (whoami / auth status); never a secret. */
    email: z.string().nullable().default(null),
  })
  .strict();
export type StoredCredential = z.infer<typeof StoredCredentialSchema>;

export type CredentialBackend = 'keychain' | 'encrypted-file' | 'memory';

export interface CredentialStore {
  readonly backend: CredentialBackend;
  get(key: CredentialKey): Promise<StoredCredential | null>;
  set(key: CredentialKey, value: StoredCredential): Promise<void>;
  delete(key: CredentialKey): Promise<void>;
}

/** The keychain account of a (profile, host) pair: `<profile>@<host>`. */
export function accountOf(key: CredentialKey): string {
  return `${key.profile}@${key.host.toLowerCase()}`;
}

export function parseStored(text: string | null): StoredCredential | null {
  if (text === null) return null;
  try {
    const r = StoredCredentialSchema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
