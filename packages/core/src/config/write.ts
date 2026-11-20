import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { usageError } from '../errors/cli-error.js';
import { SECRET_PATTERNS } from '../redact/patterns.js';

import { UserConfigSchema, type UserConfig } from './schema.js';

/**
 * T1.1.2 - config files never contain a credential. A key that looks like a secret (token, secret, password, api key,
 * credential, cookie...) or a value that matches a secret pattern is refused before anything is written.
 */
const SECRET_KEY = /(token|secret|passw(or)?d|api[-_]?key|private[-_]?key|credential|cookie|session|bearer|jwt)/i;

export function secretRefusal(key: string, value: string): string | null {
  if (SECRET_KEY.test(key)) return `"${key}" looks like a secret; config files never hold credentials.`;
  if (SECRET_PATTERNS.some((p) => new RegExp(p.source, p.flags).test(value))) {
    return 'The value looks like a credential; config files never hold credentials.';
  }
  return null;
}

export function assertNotSecret(key: string, value: string): void {
  const refusal = secretRefusal(key, value);
  if (refusal !== null) {
    throw usageError('SECRET_IN_CONFIG_REFUSED', refusal, 'Use `revition login` (or REVITION_TOKEN in CI) for credentials.');
  }
}

/**
 * Dotted config keys: `defaultProfile`, `telemetry`, `updateCheck`, `color`, `profiles.<name>.<host|org|authMethod>`.
 * Every change is re-validated by the strict schema, so an unknown key or a bad value is refused. PURE.
 */
export function flattenConfig(config: UserConfig): Record<string, string> {
  const out: Record<string, string> = {
    defaultProfile: config.defaultProfile,
    telemetry: config.telemetry,
    updateCheck: String(config.updateCheck),
    color: config.color,
  };
  for (const [name, p] of Object.entries(config.profiles)) {
    out[`profiles.${name}.host`] = p.host;
    out[`profiles.${name}.org`] = p.org ?? '';
    out[`profiles.${name}.authMethod`] = p.authMethod;
  }
  return out;
}

export function getConfigValue(config: UserConfig, key: string): string | null {
  return flattenConfig(config)[key] ?? null;
}

function coerce(key: string, value: string): unknown {
  if (key === 'updateCheck') {
    if (/^(true|false)$/.test(value)) return value === 'true';
    return value;
  }
  if (/^profiles\.[^.]+\.org$/.test(key) && value === '') return null;
  return value;
}

export function setConfigValue(config: UserConfig, key: string, value: string | undefined): UserConfig {
  if (value !== undefined) assertNotSecret(key, value);
  const next = structuredClone(config) as Record<string, unknown> & UserConfig;
  const profileKey = /^profiles\.([A-Za-z0-9_-]+)\.(host|org|authMethod)$/.exec(key);
  if (profileKey !== null) {
    const [, name, field] = profileKey as unknown as [string, string, 'host' | 'org' | 'authMethod'];
    const profiles = next.profiles as Record<string, Record<string, unknown>>;
    const p = { ...(profiles[name] ?? {}) };
    if (value === undefined) delete p[field];
    else p[field] = coerce(key, value);
    profiles[name] = p;
  } else if (['defaultProfile', 'telemetry', 'updateCheck', 'color'].includes(key)) {
    if (value === undefined) delete next[key];
    else next[key] = coerce(key, value);
  } else {
    throw usageError('CONFIG_UNKNOWN_KEY', `"${key}" is not a config key.`, 'Run `revition config list` to see the keys.');
  }
  const parsed = UserConfigSchema.safeParse(next);
  if (!parsed.success) {
    throw usageError('CONFIG_INVALID_VALUE', `"${value ?? ''}" is not a valid value for ${key}.`);
  }
  return parsed.data;
}

/**
 * Atomic write: a temp file in the same directory, then rename over the target (a reader sees the old file or the
 * new one, never a torn one); file mode 0600 on POSIX.
 */
export async function atomicWriteFile(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, contents, { mode: 0o600 });
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}
