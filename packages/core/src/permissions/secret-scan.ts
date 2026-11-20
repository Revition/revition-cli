import { SECRET_PATTERNS } from '../redact/patterns.js';
import { redact } from '../redact/redact.js';

/**
 * T3.3.2 - secret-bearing content never leaves the machine. Anything a local tool would send to the platform (a file,
 * a search hit, a command's output) is scanned first: a file or hit with a secret is BLOCKED whole (the model is told
 * "blocked by policy"), and command output is redacted line by line.
 */
const OTHER_SECRET_SHAPES: readonly { readonly kind: string; readonly re: RegExp }[] = [
  { kind: 'an OpenAI / Anthropic-style API key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/ },
  { kind: 'an AWS access key id', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { kind: 'a GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: 'a Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'a payment provider secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { kind: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    kind: 'a literal secret value',
    re: /\b(?:api[_-]?key|apikey|secret|password|passwd|client[_-]?secret|access[_-]?key|token)\b\s*["']?\s*[:=]\s*["']?[A-Za-z0-9/+_=-]{16,}/i,
  },
];

export interface SecretFinding {
  readonly line: number;
  readonly kind: string;
}

/** Each line holding a credential-looking value: its number and kind, never the value. PURE. */
export function scanSecrets(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const own = SECRET_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(line));
    const kind = own ? 'a Revition token or credential' : OTHER_SECRET_SHAPES.find((p) => p.re.test(line))?.kind;
    if (kind !== undefined) out.push({ line: i + 1, kind });
  });
  return out;
}

export const BLOCKED_BY_POLICY = 'blocked by policy';

/** Content that may be sent as-is, or the block (with the reason, never the content). PURE. */
export function uploadable(text: string): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly reason: string } {
  const found = scanSecrets(text);
  if (found.length === 0) return { ok: true, text };
  return { ok: false, reason: `${BLOCKED_BY_POLICY}: ${found[0]?.kind ?? 'a secret'} on line ${found[0]?.line ?? 0}` };
}

/** Free text (command output) with every secret-looking line replaced. PURE. */
export function redactSecrets(text: string): string {
  const lines = redact(text).split('\n');
  return lines.map((l) => (scanSecrets(l).length > 0 ? '[REDACTED LINE]' : l)).join('\n');
}
