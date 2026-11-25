import type { CliError } from '../errors/cli-error.js';

/** T1.1.3 - with --json, stdout carries exactly ONE document of this shape. */
export interface JsonEnvelope<T> {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly ok: boolean;
  readonly data: T | null;
  readonly error: CliError | null;
  readonly warnings: readonly string[];
  readonly meta: { readonly cliVersion: string; readonly traceId: string | null };
}

export function envelope<T>(input: {
  command: string;
  data: T | null;
  error: CliError | null;
  warnings: readonly string[];
  cliVersion: string;
  traceId?: string | null;
}): JsonEnvelope<T> {
  return {
    schemaVersion: 1,
    command: input.command,
    ok: input.error === null,
    data: input.error === null ? input.data : null,
    error: input.error,
    warnings: [...input.warnings],
    meta: { cliVersion: input.cliVersion, traceId: input.traceId ?? input.error?.traceId ?? null },
  };
}

/** A structural check of a parsed --json document (used by the schema tests and doctor). PURE. */
export function isEnvelope(doc: unknown): doc is JsonEnvelope<unknown> {
  if (doc === null || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  const meta = d['meta'] as Record<string, unknown> | null | undefined;
  return (
    d['schemaVersion'] === 1 &&
    typeof d['command'] === 'string' &&
    typeof d['ok'] === 'boolean' &&
    'data' in d &&
    (d['error'] === null || typeof d['error'] === 'object') &&
    Array.isArray(d['warnings']) &&
    (d['warnings'] as unknown[]).every((w) => typeof w === 'string') &&
    meta !== null &&
    typeof meta === 'object' &&
    typeof meta['cliVersion'] === 'string' &&
    (meta['traceId'] === null || typeof meta['traceId'] === 'string') &&
    (d['ok'] === true) === (d['error'] === null)
  );
}
