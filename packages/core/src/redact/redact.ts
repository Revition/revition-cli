import { REDACTED, SECRET_PATTERNS } from './patterns.js';

/** A logged body longer than this is truncated before redaction (binary or huge bodies, T1.1.4 edge case). */
export const MAX_REDACT_CHARS = 64 * 1024;

/**
 * Every secret shape in `text` replaced by [REDACTED], over the WHOLE text: command output (stdout, stderr, the pager,
 * `--json`) is never shortened, so a large document stays complete and parseable. PURE.
 */
export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), REDACTED);
  }
  return out;
}

/** A logged body (the debug log): truncated past MAX_REDACT_CHARS, then redacted (T1.1.4 edge case). PURE. */
export function redactBody(text: string): string {
  return redact(text.length > MAX_REDACT_CHARS ? `${text.slice(0, MAX_REDACT_CHARS)}...[truncated]` : text);
}

/**
 * A value of any shape with every string in it (keys included) redacted, structure intact (used for --json documents
 * and telemetry). Redacting the serialized text instead would let a pattern that runs to the end of a line swallow
 * the JSON's own quotes and braces. PURE.
 */
export function redactValue<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return redact(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [redact(k), walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}

/**
 * A write sink that only ever emits whole lines, each redacted. A secret split across two writes is held until its
 * line completes (T1.1.4 edge case: redaction runs on whole-line buffers). `flush()` emits the trailing partial line.
 */
export class LineRedactor {
  private pending = '';

  constructor(private readonly sink: (chunk: string) => void) {}

  write(chunk: string): void {
    this.pending += chunk;
    const lastNewline = this.pending.lastIndexOf('\n');
    if (lastNewline === -1) return;
    const complete = this.pending.slice(0, lastNewline + 1);
    this.pending = this.pending.slice(lastNewline + 1);
    this.sink(redact(complete));
  }

  flush(): void {
    if (this.pending === '') return;
    const rest = this.pending;
    this.pending = '';
    this.sink(redact(rest));
  }
}
