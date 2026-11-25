import { keyring } from '../lazy-deps.js';
import { accountOf, CREDENTIAL_SERVICE, parseStored, type CredentialKey, type CredentialStore, type StoredCredential } from './store.js';

/**
 * T1.3.3 backend 1 - the OS store through @napi-rs/keyring (ADR 0005): macOS Keychain, Windows Credential Manager,
 * Linux Secret Service. Service `revition-cli`, account `<profile>@<host>`.
 */
export interface KeyringEntry {
  setPassword(password: string): void;
  getPassword(): string | null;
  deletePassword(): boolean;
}
export type EntryFactory = (service: string, account: string) => KeyringEntry;

export const nativeEntry: EntryFactory = (service, account) => new (keyring().Entry)(service, account);

export class KeychainStore implements CredentialStore {
  readonly backend = 'keychain' as const;

  constructor(private readonly entry: EntryFactory = nativeEntry) {}

  async get(key: CredentialKey): Promise<StoredCredential | null> {
    return parseStored(this.entry(CREDENTIAL_SERVICE, accountOf(key)).getPassword());
  }

  async set(key: CredentialKey, value: StoredCredential): Promise<void> {
    this.entry(CREDENTIAL_SERVICE, accountOf(key)).setPassword(JSON.stringify(value));
  }

  async delete(key: CredentialKey): Promise<void> {
    try {
      this.entry(CREDENTIAL_SERVICE, accountOf(key)).deletePassword();
    } catch {
      // Nothing stored under that key: deleting is already done.
    }
  }
}

/**
 * Whether the OS store answers, WITHOUT reading any secret: a read of a probe account that never holds one. "No
 * entry" is an answer (available); a platform failure (no Secret Service / dbus, a locked-down WSL) is not.
 */
export function keychainAvailable(entry: EntryFactory = nativeEntry): boolean {
  try {
    entry(CREDENTIAL_SERVICE, '__revition_probe__').getPassword();
    return true;
  } catch {
    return false;
  }
}
