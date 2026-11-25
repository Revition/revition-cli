import { spawn } from 'node:child_process';

import type { CliError } from '../errors/cli-error.js';
import { redact, redactValue } from '../redact/redact.js';

import { paint } from './color.js';
import { envelope } from './envelope.js';
import type { Io } from './io.js';

/** What a command hands back for human output; JSON output always uses `data`. */
export interface HumanView {
  readonly text: string;
  /** A secret printed once on stdout, unredacted, after `text` (e.g. a new token). */
  readonly reveal?: string;
}

export interface RenderInput<T> {
  readonly command: string;
  readonly json: boolean;
  readonly data: T | null;
  readonly human: ((data: T) => HumanView) | null;
  readonly error: CliError | null;
  readonly warnings: readonly string[];
  readonly cliVersion: string;
  readonly color: boolean;
  /** The one secret field shown once under --json (`data[key]`), put back after redaction. */
  readonly reveal?: { readonly key: string; readonly value: string } | null;
}

/**
 * T1.1.3 - with --json, stdout gets exactly ONE envelope (and nothing else: warnings live in `warnings[]`); otherwise
 * data goes to stdout and every message (warnings, errors) to stderr.
 */
export function render<T>(io: Io, input: RenderInput<T>): string | null {
  if (input.json) {
    const doc = envelope({
      command: input.command,
      data: input.data,
      error: input.error,
      warnings: input.warnings,
      cliVersion: input.cliVersion,
    });
    const safe = redactValue(doc) as { data: unknown };
    const reveal = input.reveal ?? null;
    if (reveal !== null && safe.data !== null && typeof safe.data === 'object') {
      (safe.data as Record<string, unknown>)[reveal.key] = reveal.value;
      // The document carries the secret: it goes out through the one unredacted path, whole.
      io.revealOnce(JSON.stringify(safe));
      return null;
    }
    io.out(`${JSON.stringify(safe)}\n`);
    return null;
  }
  for (const w of input.warnings) io.err(`${paint('warn', 'yellow', input.color)} ${w}\n`);
  if (input.error !== null) {
    io.err(`${paint('failed', 'red', input.color)} ${input.error.message}\n`);
    if (input.error.hint !== null) io.err(`  ${input.error.hint}\n`);
    if (input.error.traceId !== null) io.err(`  trace ${input.error.traceId}\n`);
    if (input.error.docsUrl !== null) io.err(`  Learn more: ${input.error.docsUrl}\n`);
    return null;
  }
  if (input.data === null || input.human === null) return null;
  return input.human(input.data).text;
}

/** The pager for long output: only on a TTY; $PAGER, default `less -FRX`; none for --json or when piped. PURE. */
export function pagerCommand(
  env: Readonly<Record<string, string | undefined>>,
  io: Io,
  json: boolean,
  text: string,
  rows: number | undefined
): string | null {
  if (json || !io.stdoutIsTTY || rows === undefined) return null;
  if (text.split('\n').length <= rows) return null;
  const pager = env['PAGER'];
  if (pager === '' || pager === 'cat') return null;
  return pager ?? 'less -FRX';
}

/** Writes `text` through the pager when one applies, else straight to stdout. */
export async function writeData(io: Io, text: string, pager: string | null): Promise<void> {
  if (pager === null) {
    io.out(text);
    return;
  }
  io.flush();
  await new Promise<void>((resolve) => {
    const child = spawn(pager, { shell: true, stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', () => {
      io.out(text);
      resolve();
    });
    child.on('close', () => resolve());
    // The pager is a sink like any other: it only ever receives redacted text (T1.1.4 invariant).
    child.stdin.end(redact(text));
  });
}
