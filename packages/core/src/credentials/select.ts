import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { atomicWriteFile } from '../config/write.js';
import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import { EncryptedFileStore } from './encrypted-file.js';
import { KeychainStore, keychainAvailable, nativeEntry, type EntryFactory } from './keychain.js';
import { MemoryStore } from './memory.js';
import type { CredentialStore } from './store.js';

/**
 * T1.3.3 - backend selection, in order: memory when a PAT drives the run (REVITION_TOKEN, T1.3.6); the OS keychain;
 * the encrypted file ONLY when the profile chose --insecure-storage. Keychain unavailable without that choice = REFUSE
 * with guidance: there is no silent fallback to anything on disk.
 */
export const CREDENTIALS_FILE = 'credentials.enc';
export const INSECURE_CHOICE_FILE = 'insecure-storage.json';

export interface SelectInputs {
  readonly profile: string;
  readonly stateDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** --insecure-storage on this run (login); persisted per profile once chosen. */
  readonly insecureStorageFlag: boolean;
  readonly askPassphrase: () => Promise<string>;
  readonly entry?: EntryFactory;
}

export function patInEnv(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env['REVITION_TOKEN'] ?? '') !== '';
}

async function insecureProfiles(stateDir: string): Promise<string[]> {
  const text = await readFile(join(stateDir, INSECURE_CHOICE_FILE), 'utf8').catch(() => null);
  if (text === null) return [];
  try {
    const p = (JSON.parse(text) as { profiles?: unknown }).profiles;
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function persistInsecureChoice(stateDir: string, profile: string): Promise<void> {
  const profiles = new Set(await insecureProfiles(stateDir));
  profiles.add(profile);
  await atomicWriteFile(join(stateDir, INSECURE_CHOICE_FILE), JSON.stringify({ profiles: [...profiles].sort() }));
}

export function noKeychainError(): RevitionCliError {
  return new RevitionCliError(
    {
      code: 'CREDENTIAL_STORE_UNAVAILABLE',
      message: 'No OS credential store is available, so the CLI will not store your sign-in.',
      hint:
        'Install or unlock gnome-keyring / KWallet; or re-run with --insecure-storage to keep an AES-256-GCM encrypted ' +
        'file whose key comes from a passphrase you enter each session; or, in CI, use a token via REVITION_TOKEN.',
    },
    EXIT.auth
  );
}

export async function selectStore(i: SelectInputs): Promise<CredentialStore> {
  if (patInEnv(i.env)) return new MemoryStore();
  const entry = i.entry ?? nativeEntry;
  const chosenInsecure = i.insecureStorageFlag || (await insecureProfiles(i.stateDir)).includes(i.profile);
  if (keychainAvailable(entry) && !chosenInsecure) return new KeychainStore(entry);
  if (!chosenInsecure) throw noKeychainError();
  if (i.insecureStorageFlag) await persistInsecureChoice(i.stateDir, i.profile);
  return new EncryptedFileStore(join(i.stateDir, CREDENTIALS_FILE), i.askPassphrase);
}
