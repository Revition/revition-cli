import { appendFile, chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { redactBody } from '../redact/redact.js';

/**
 * T1.1.4 - the debug log. On with --debug or REVITION_DEBUG=1: `<state>/logs/debug-<date>.log`, mode 0600, kept 7 days.
 * An HTTP line is method + path + status + latency + trace id ONLY. Bodies are logged only with
 * REVITION_DEBUG_BODIES=1, never for an auth endpoint, and always redacted (every line passes through redact()).
 */
export const LOG_RETENTION_DAYS = 7;

/** Auth endpoints: their bodies are never logged, whatever the env says. */
const AUTH_PATH = /(^|\/)(oauth|authorize|token|tokens|login|logout|cli\/sessions|device\/code)(\/|$|\?)/i;

export function isAuthEndpoint(path: string): boolean {
  return AUTH_PATH.test(path);
}

export function debugEnabled(env: Readonly<Record<string, string | undefined>>, flag: boolean): boolean {
  return flag || env['REVITION_DEBUG'] === '1';
}

export interface HttpLogEntry {
  readonly method: string;
  readonly path: string;
  readonly status: number | null;
  readonly latencyMs: number;
  readonly traceId: string | null;
  readonly requestBody?: string;
  readonly responseBody?: string;
}

export class DebugLog {
  private ready: Promise<void> | null = null;

  constructor(
    private readonly logDir: string,
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly now: () => Date = () => new Date()
  ) {}

  get file(): string {
    return join(this.logDir, `debug-${this.now().toISOString().slice(0, 10)}.log`);
  }

  async line(text: string): Promise<void> {
    await this.prepare();
    const file = this.file;
    await appendFile(file, `${this.now().toISOString()} ${redactBody(text).replace(/\n/g, '\\n')}\n`, { mode: 0o600 });
    await chmod(file, 0o600).catch(() => undefined);
  }

  async http(e: HttpLogEntry): Promise<void> {
    let text = `HTTP ${e.method} ${e.path} -> ${e.status ?? 'ERR'} ${Math.round(e.latencyMs)}ms trace=${e.traceId ?? '-'}`;
    const bodies = this.env['REVITION_DEBUG_BODIES'] === '1' && !isAuthEndpoint(e.path);
    if (bodies) {
      if (e.requestBody !== undefined) text += ` request=${e.requestBody}`;
      if (e.responseBody !== undefined) text += ` response=${e.responseBody}`;
    }
    await this.line(text);
  }

  /** Creates the folder (0700) and deletes logs older than the retention, once per process. */
  private prepare(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.logDir, { recursive: true, mode: 0o700 });
      const cutoff = this.now().getTime() - LOG_RETENTION_DAYS * 24 * 3600 * 1000;
      for (const f of await readdir(this.logDir)) {
        if (!/^debug-\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
        const p = join(this.logDir, f);
        const s = await stat(p).catch(() => null);
        if (s !== null && s.mtimeMs < cutoff) await rm(p, { force: true });
      }
    })();
    return this.ready;
  }
}
