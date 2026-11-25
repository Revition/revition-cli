import { accountOf, type CredentialKey, type CredentialStore, type StoredCredential } from './store.js';

/** T1.3.3 backend 4 - CI / PAT only: lives for this process, never persisted. */
export class MemoryStore implements CredentialStore {
  readonly backend = 'memory' as const;
  private readonly entries = new Map<string, StoredCredential>();

  async get(key: CredentialKey): Promise<StoredCredential | null> {
    return this.entries.get(accountOf(key)) ?? null;
  }

  async set(key: CredentialKey, value: StoredCredential): Promise<void> {
    this.entries.set(accountOf(key), value);
  }

  async delete(key: CredentialKey): Promise<void> {
    this.entries.delete(accountOf(key));
  }
}
