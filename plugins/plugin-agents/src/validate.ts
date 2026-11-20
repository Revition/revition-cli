import { SECRET_PATTERNS } from '@revition/cli-core';
import { Ajv2020 } from 'ajv/dist/2020.js';

import { parseDefinitionText, type AgentDefinition } from './format.js';
import schema from './schema/agent-definition.v1.json' with { type: 'json' };

/**
 * T3.1.1 - `revition agents validate`, the local part: the platform's JSON Schema (pinned) and a secret scan over the
 * file's text. A file that holds a literal credential fails; the finding names the line and the kind, never the
 * value. Unknown config fields (a newer platform's) are a warning and are kept as they are.
 */
export interface Finding {
  readonly line: number | null;
  readonly path: string;
  readonly message: string;
}

export interface LocalResult {
  readonly ok: boolean;
  readonly definition: AgentDefinition | null;
  readonly problems: readonly Finding[];
  readonly warnings: readonly Finding[];
}

/** Credential shapes beyond the CLI's own redaction patterns: provider API keys and `key: <long literal>` pairs. */
const API_KEY_PATTERNS: readonly { readonly kind: string; readonly re: RegExp }[] = [
  { kind: 'an OpenAI / Anthropic-style API key', re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/ },
  { kind: 'an AWS access key id', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { kind: 'a GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: 'a Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'a payment provider secret key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { kind: 'a private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    kind: 'a literal secret value',
    re: /\b(?:api[_-]?key|apikey|secret|password|passwd|client[_-]?secret|access[_-]?key)\b\s*["']?\s*[:=]\s*["']?[A-Za-z0-9/+_=-]{16,}/i,
  },
];

/** Every line holding a credential-looking literal: the line number and the kind. PURE. */
export function secretFindings(text: string): Finding[] {
  const out: Finding[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const own = SECRET_PATTERNS.some((p) => new RegExp(p.source, p.flags.replace('g', '')).test(line));
    const hit = own ? 'a Revition token or credential' : API_KEY_PATTERNS.find((p) => p.re.test(line))?.kind;
    if (hit !== undefined) {
      out.push({ line: i + 1, path: '', message: `${hit}: secrets are never inline; reference an org variable or a runtime secret` });
    }
  });
  return out;
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema as object);

/** The config fields the pinned schema names (anything else came from a newer platform). */
const KNOWN_CONFIG_FIELDS = new Set(
  Object.keys(((schema as { properties: { config: { properties: { config: { properties: Record<string, unknown> } } } } }).properties.config.properties.config.properties))
);

/** The local validation of one file's text. PURE (apart from the compiled schema). */
export function validateLocal(text: string): LocalResult {
  const secrets = secretFindings(text);
  let doc: unknown;
  try {
    doc = parseDefinitionText(text);
  } catch (e) {
    return { ok: false, definition: null, problems: [...secrets, { line: null, path: '', message: `not valid YAML: ${(e as Error).message.split('\n')[0] ?? ''}` }], warnings: [] };
  }
  const problems: Finding[] = [...secrets];
  if (!validateSchema(doc)) {
    for (const err of validateSchema.errors ?? []) {
      problems.push({ line: null, path: err.instancePath === '' ? '/' : err.instancePath, message: err.message ?? 'invalid' });
    }
  }
  const def = problems.length === 0 ? (doc as AgentDefinition) : null;
  const unknown = def === null ? [] : Object.keys(def.config.config).filter((k) => !KNOWN_CONFIG_FIELDS.has(k));
  const warnings = unknown.map((k) => ({ line: null, path: `/config/config/${k}`, message: 'not in this CLI\'s schema (a newer platform field?): kept as is' }));
  return { ok: problems.length === 0, definition: def, problems, warnings };
}
