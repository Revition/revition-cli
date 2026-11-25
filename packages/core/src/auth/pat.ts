import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

/**
 * T1.3.6 - CI authentication. A PAT comes from REVITION_TOKEN (env) or `login --with-token` (stdin); NEVER from a
 * flag value or argv. It is used from memory only: never written to disk, never registered as a session.
 */
export const PAT_PATTERN = /^rvt_[0-9A-Za-z]{40}$/;

export function patFromEnv(env: Readonly<Record<string, string | undefined>>): string | null {
  const t = (env['REVITION_TOKEN'] ?? '').trim();
  return t === '' ? null : t;
}

export function assertPatShape(token: string): string {
  const t = token.trim();
  if (!PAT_PATTERN.test(t)) {
    throw new RevitionCliError(
      { code: 'TOKEN_MALFORMED', message: 'That is not a Revition token (expected rvt_ followed by 40 letters and digits).' },
      EXIT.usage
    );
  }
  return t;
}

/** Reads the whole of stdin (`login --with-token < token.txt`). A TTY stdin is refused: the token must be piped. */
export async function readTokenFromStdin(stdin: NodeJS.ReadableStream & { isTTY?: boolean }): Promise<string> {
  if (stdin.isTTY === true) {
    throw new RevitionCliError(
      { code: 'TOKEN_STDIN_REQUIRED', message: '--with-token reads the token from stdin; pipe it in.', hint: 'revition login --with-token < token.txt' },
      EXIT.usage
    );
  }
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return assertPatShape(Buffer.concat(chunks).toString('utf8'));
}

/** The 8-character prefix shown when a token is refused (never the whole token). */
export function tokenPrefix(token: string): string {
  return token.slice(0, 8);
}
