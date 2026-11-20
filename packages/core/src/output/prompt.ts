import type { Io } from './io.js';

/**
 * T1.1.3 - prompts only when stdin AND stdout are a TTY and neither --no-input nor --json is set. Secrets are read with
 * echo disabled (the Io's hidden read). Prompts go to stderr.
 */
export function canPrompt(io: Io, flags: { readonly json: boolean; readonly noInput: boolean }): boolean {
  return io.stdinIsTTY && io.stdoutIsTTY && !flags.noInput && !flags.json;
}

export async function ask(io: Io, question: string, opts: { readonly hidden?: boolean } = {}): Promise<string> {
  io.err(`${question} `);
  io.flush();
  const answer = await io.readLine({ hidden: opts.hidden === true });
  if (opts.hidden === true) io.err('\n');
  return answer.trim();
}

export async function confirmYes(io: Io, question: string): Promise<boolean> {
  return /^(y|yes)$/i.test(await ask(io, `${question} [y/N]`));
}
