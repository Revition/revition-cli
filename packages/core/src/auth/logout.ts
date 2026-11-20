import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicWriteFile } from '../config/write.js';
import type { CredentialKey, CredentialStore, StoredCredential } from '../credentials/store.js';
import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

/**
 * T1.3.4 - logout ends the session everywhere it can: Auth0 (POST /oauth/revoke on the refresh token) and the
 * platform (DELETE /dev/cli/sessions/{id}), then the local credential, refresh token and device key. Offline: the
 * local part is done and the server revoke is QUEUED - in the credential store itself (the queued entry holds secrets,
 * so it never goes to a plain file) - and retried at the next run.
 */
export interface LogoutDeps {
  readonly store: CredentialStore;
  readonly revokeAuth0: (refreshToken: string) => Promise<void>;
  readonly deleteSession: (sessionId: string, credential: string) => Promise<void>;
}

export interface LogoutResult {
  readonly profile: string;
  readonly host: string;
  readonly hadSession: boolean;
  readonly auth0Revoked: boolean;
  readonly sessionRevoked: boolean;
  readonly queued: boolean;
}

/** The store key of a queued revocation of one session. */
export function queueKey(key: CredentialKey, sessionId: string): CredentialKey {
  return { profile: `__revoke__${key.profile}__${sessionId}`, host: key.host };
}

const offline = (e: unknown): boolean => e instanceof RevitionCliError && (e.exitCode === EXIT.network || e.exitCode === EXIT.server);

async function revokeBoth(c: StoredCredential, deps: LogoutDeps): Promise<{ auth0: boolean; session: boolean; offline: boolean }> {
  let auth0 = false;
  let session = false;
  let wentOffline = false;
  try {
    await deps.revokeAuth0(c.auth0RefreshToken);
    auth0 = true;
  } catch (e) {
    if (offline(e)) wentOffline = true;
    else auth0 = true; // an already-invalid refresh token is as revoked as it gets
  }
  try {
    await deps.deleteSession(c.sessionId, c.credential);
    session = true;
  } catch (e) {
    if (offline(e)) wentOffline = true;
    else session = true; // 401 / 404: the platform already ended it
  }
  return { auth0, session, offline: wentOffline };
}

export async function logout(key: CredentialKey, deps: LogoutDeps): Promise<LogoutResult> {
  const c = await deps.store.get(key);
  if (c === null) return { profile: key.profile, host: key.host, hadSession: false, auth0Revoked: false, sessionRevoked: false, queued: false };
  const r = await revokeBoth(c, deps);
  await deps.store.delete(key);
  if (r.offline) await deps.store.set(queueKey(key, c.sessionId), c);
  return { profile: key.profile, host: key.host, hadSession: true, auth0Revoked: r.auth0, sessionRevoked: r.session, queued: r.offline };
}

/**
 * The queue INDEX: which (profile, host, session id) have a queued revocation. It holds no secret (the secrets are in
 * the credential store under `queueKey`), so it may live in a plain state file.
 */
export const QUEUE_INDEX_FILE = 'revoke-queue.json';
type QueueEntry = { readonly profile: string; readonly host: string; readonly sessionId: string };

export async function readQueue(stateDir: string): Promise<QueueEntry[]> {
  const text = await readFile(join(stateDir, QUEUE_INDEX_FILE), 'utf8').catch(() => null);
  if (text === null) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? (v as QueueEntry[]) : [];
  } catch {
    return [];
  }
}

export async function writeQueue(stateDir: string, entries: readonly QueueEntry[]): Promise<void> {
  await atomicWriteFile(join(stateDir, QUEUE_INDEX_FILE), JSON.stringify(entries));
}

/** Logout with the queue index kept up to date. */
export async function logoutAndQueue(key: CredentialKey, deps: LogoutDeps, stateDir: string): Promise<LogoutResult> {
  const before = await deps.store.get(key);
  const result = await logout(key, deps);
  if (result.queued && before !== null) {
    await writeQueue(stateDir, [...(await readQueue(stateDir)), { profile: key.profile, host: key.host, sessionId: before.sessionId }]);
  }
  return result;
}

/** At the next run: retry every queued revocation; a success removes it from the queue. Returns how many completed. */
export async function retryQueued(stateDir: string, deps: LogoutDeps): Promise<number> {
  const entries = await readQueue(stateDir);
  if (entries.length === 0) return 0;
  const left: QueueEntry[] = [];
  let done = 0;
  for (const e of entries) {
    const qk = queueKey({ profile: e.profile, host: e.host }, e.sessionId);
    const c = await deps.store.get(qk);
    if (c === null) continue;
    const r = await revokeBoth(c, deps);
    if (r.offline) {
      left.push(e);
      continue;
    }
    await deps.store.delete(qk);
    done += 1;
  }
  await writeQueue(stateDir, left);
  return done;
}
