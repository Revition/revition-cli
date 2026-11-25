// REVITION-CLI-PLAN T1.2.6 (:1319-1321): 7 days before the nightly CI PAT expires, the nightly workflow asks for its
// rotation. This reads `revition token list --json` with the CI PAT itself, finds that PAT by its 8-char display prefix
// (`rvt_` + 4 chars, the platform's own prefix: sentinel/pat/token.ts), and prints `rotate=1|0` and `expiresAt=...`
// (also appended to $GITHUB_OUTPUT). It never prints the token. Exit 0 always unless the CLI itself fails.
//   node scripts/pat-rotation-check.mjs [nowMs]
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import process from 'node:process';

export const ROTATE_WITHIN_MS = 7 * 86_400_000;

/** Whether the token with this prefix expires within 7 days of `nowMs`. */
export function rotationDue(tokens, token, nowMs) {
  const prefix = (token ?? '').slice(0, 8);
  const mine = tokens.find((t) => t.prefix === prefix && !t.revokedAt);
  if (mine === undefined) return { rotate: false, expiresAt: '' };
  return { rotate: Date.parse(mine.expiresAt) - nowMs < ROTATE_WITHIN_MS, expiresAt: mine.expiresAt };
}

function main() {
  const bin = process.env.REVITION_CLI_BIN ?? 'packages/cli/bin/run';
  const out = JSON.parse(execFileSync(process.execPath, [bin, 'token', 'list', '--json'], { encoding: 'utf8' }));
  const nowMs = process.argv[2] === undefined ? Date.now() : Number(process.argv[2]);
  const r = rotationDue(out.data?.tokens ?? [], process.env.REVITION_TOKEN, nowMs);
  const lines = `rotate=${r.rotate ? 1 : 0}\nexpiresAt=${r.expiresAt}\n`;
  process.stdout.write(lines);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
