import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { z } from 'zod';

import { isCi } from '../auth/ci-detect.js';
import { atomicWriteFile } from '../config/write.js';
import { redactValue } from '../redact/redact.js';

/**
 * T1.4.2 - opt-in usage telemetry. Precedence: DO_NOT_TRACK=1 or REVITION_TELEMETRY=0/off -> OFF (always wins) >
 * config telemetry on/off > unset = OFF. Events carry NO user id, org id, path, argument value, host or error text;
 * flags are recorded by NAME only. They are queued locally, sent in a detached process (never blocking a command),
 * and the last 20 payloads sent are kept for `telemetry show-last`.
 */
export const TELEMETRY_DOCS_URL = 'https://github.com/Revition/revition-cli/blob/main/docs/telemetry.md';

export const TelemetryEvent = z
  .object({
    schemaVersion: z.literal(1),
    installId: z.string().uuid(),
    cliVersion: z.string(),
    os: z.enum(['darwin', 'linux', 'win32']),
    nodeMajor: z.number(),
    command: z.string(),
    flagsUsed: z.array(z.string()),
    exitCode: z.number(),
    durationMs: z.number(),
    ci: z.boolean(),
    timestamp: z.string(),
  })
  .strict();
export type TelemetryEvent = z.infer<typeof TelemetryEvent>;

export type ConfigTelemetry = 'unset' | 'on' | 'off';

/** DO_NOT_TRACK (any value but '' or '0') or REVITION_TELEMETRY=0/off/false: off, whatever the config says. PURE. */
export function telemetryForcedOff(env: Readonly<Record<string, string | undefined>>): boolean {
  const dnt = env['DO_NOT_TRACK'];
  if (dnt !== undefined && dnt !== '' && dnt !== '0') return true;
  const t = (env['REVITION_TELEMETRY'] ?? '').toLowerCase();
  return t === '0' || t === 'off' || t === 'false';
}

export function telemetryEnabled(env: Readonly<Record<string, string | undefined>>, config: ConfigTelemetry): boolean {
  if (telemetryForcedOff(env)) return false;
  return config === 'on';
}

/** Flag NAMES from argv (`--profile=work` and `--profile work` both give `profile`); values are never kept. PURE. */
export function flagNames(argv: readonly string[]): string[] {
  const names = argv
    .filter((a) => a.startsWith('-') && a !== '-' && a !== '--')
    .map((a) => a.replace(/^-+/, '').split('=')[0] ?? '')
    .filter((n) => /^[a-z][a-z0-9-]*$/i.test(n));
  return [...new Set(names)].sort();
}

const FILES = { id: 'telemetry-id.json', queue: 'telemetry-queue.json', last: 'telemetry-last.json' } as const;
export const SHOW_LAST = 20;

async function readJson<T>(file: string, fallback: T): Promise<T> {
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** The install id: random, local, resettable (a user who opts out gets a new one). */
export async function installId(stateDir: string): Promise<string> {
  const f = join(stateDir, FILES.id);
  const cur = await readJson<{ id?: string }>(f, {});
  if (typeof cur.id === 'string' && z.string().uuid().safeParse(cur.id).success) return cur.id;
  const id = randomUUID();
  await atomicWriteFile(f, JSON.stringify({ id }));
  return id;
}

export async function resetInstallId(stateDir: string): Promise<void> {
  await atomicWriteFile(join(stateDir, FILES.id), JSON.stringify({ id: randomUUID() }));
  await atomicWriteFile(join(stateDir, FILES.queue), '[]');
}

export function buildEvent(i: {
  readonly installId: string;
  readonly cliVersion: string;
  readonly platform: NodeJS.Platform;
  readonly nodeVersion: string;
  readonly command: string;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly durationMs: number;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly now: Date;
}): TelemetryEvent | null {
  if (i.platform !== 'darwin' && i.platform !== 'linux' && i.platform !== 'win32') return null;
  const event = {
    schemaVersion: 1 as const,
    installId: i.installId,
    cliVersion: i.cliVersion,
    os: i.platform,
    nodeMajor: Number.parseInt(i.nodeVersion.replace(/^v/, ''), 10) || 0,
    command: i.command,
    flagsUsed: flagNames(i.argv),
    exitCode: i.exitCode,
    durationMs: Math.round(i.durationMs),
    ci: isCi(i.env),
    timestamp: i.now.toISOString(),
  };
  // The redaction pass, then the strict schema: anything that is not exactly an event is dropped.
  const r = TelemetryEvent.safeParse(redactValue(event));
  return r.success ? r.data : null;
}

export async function enqueue(stateDir: string, e: TelemetryEvent): Promise<number> {
  const f = join(stateDir, FILES.queue);
  const q = await readJson<TelemetryEvent[]>(f, []);
  const next = [...q, e].slice(-50);
  await atomicWriteFile(f, JSON.stringify(next));
  return next.length;
}

/** Sends the queued batch through `post`; on success records the payload for show-last and empties the queue. */
export async function flushQueue(stateDir: string, post: (payload: { events: TelemetryEvent[] }) => Promise<void>): Promise<number> {
  const queueFile = join(stateDir, FILES.queue);
  const events = await readJson<TelemetryEvent[]>(queueFile, []);
  if (events.length === 0) return 0;
  const payload = { events };
  await post(payload);
  const last = await readJson<TelemetryEvent[]>(join(stateDir, FILES.last), []);
  await atomicWriteFile(join(stateDir, FILES.last), JSON.stringify([...last, ...events].slice(-SHOW_LAST)));
  await atomicWriteFile(queueFile, '[]');
  return events.length;
}

/** `telemetry show-last`: the last 20 events exactly as sent. */
export async function lastSent(stateDir: string): Promise<TelemetryEvent[]> {
  return readJson<TelemetryEvent[]>(join(stateDir, FILES.last), []);
}
