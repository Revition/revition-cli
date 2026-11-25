import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { atomicWriteFile } from '../config/write.js';
import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

import { accountOf, StoredCredentialSchema, type CredentialKey, type CredentialStore, type StoredCredential } from './store.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

/**
 * T1.3.3 backend 3 - ONLY with --insecure-storage (an explicit, persisted choice per profile): one AES-256-GCM file,
 * `<state>/credentials.enc`, mode 0600, key = scrypt(passphrase). The passphrase is entered each session and never
 * stored; without it the content cannot be decoded (GCM authenticates, so a wrong passphrase fails, it does not
 * decrypt to garbage).
 */
export const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

interface Envelope {
  readonly v: 1;
  readonly kdf: 'scrypt';
  readonly salt: string;
  readonly iv: string;
  readonly tag: string;
  readonly ct: string;
}

type Entries = Record<string, StoredCredential>;

export class EncryptedFileStore implements CredentialStore {
  readonly backend = 'encrypted-file' as const;
  private passphrase: string | null = null;

  constructor(
    private readonly file: string,
    private readonly askPassphrase: () => Promise<string>
  ) {}

  async get(key: CredentialKey): Promise<StoredCredential | null> {
    return (await this.read())[accountOf(key)] ?? null;
  }

  async set(key: CredentialKey, value: StoredCredential): Promise<void> {
    const entries = await this.read();
    entries[accountOf(key)] = StoredCredentialSchema.parse(value);
    await this.write(entries);
  }

  async delete(key: CredentialKey): Promise<void> {
    const entries = await this.read();
    if (!(accountOf(key) in entries)) return;
    delete entries[accountOf(key)];
    await this.write(entries);
  }

  private async pass(): Promise<string> {
    this.passphrase ??= await this.askPassphrase();
    if (this.passphrase.length < 8) {
      this.passphrase = null;
      throw new RevitionCliError({ code: 'PASSPHRASE_TOO_SHORT', message: 'The passphrase needs at least 8 characters.' }, EXIT.usage);
    }
    return this.passphrase;
  }

  private async read(): Promise<Entries> {
    const text = await readFile(this.file, 'utf8').catch(() => null);
    if (text === null) return {};
    const env = JSON.parse(text) as Envelope;
    const key = await scrypt(await this.pass(), Buffer.from(env.salt, 'base64'), 32, SCRYPT);
    try {
      const d = createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'));
      d.setAuthTag(Buffer.from(env.tag, 'base64'));
      const plain = Buffer.concat([d.update(Buffer.from(env.ct, 'base64')), d.final()]).toString('utf8');
      return JSON.parse(plain) as Entries;
    } catch {
      this.passphrase = null;
      throw new RevitionCliError(
        { code: 'CREDENTIAL_FILE_LOCKED', message: 'The credential file cannot be opened with that passphrase.' },
        EXIT.auth
      );
    }
  }

  private async write(entries: Entries): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await scrypt(await this.pass(), salt, 32, SCRYPT);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(entries), 'utf8'), c.final()]);
    const env: Envelope = {
      v: 1,
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: c.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
    };
    await atomicWriteFile(this.file, JSON.stringify(env));
  }
}
