/**
 * T1.1.1 - the command module contract. Every command declares what it needs (scopes), whether it changes anything
 * (mutates / confirm), its machine output schema and its stability; the core enforces each of them, so a new command
 * is a new module and never a change to the core.
 */

/** The CLI credential scopes, exactly as the platform defines them (REVITION-CLI-PLAN T1.2.4). */
export const CLI_SCOPES = ['cli:read', 'cli:write', 'cli:submit', 'cli:agents', 'cli:assist'] as const;
export type CliScope = (typeof CLI_SCOPES)[number];

export type Stability = 'stable' | 'beta' | 'experimental';

/** `typed` = the user types the resource name to confirm. */
export type ConfirmLevel = 'none' | 'prompt' | 'typed';

export interface CommandMeta {
  /** e.g. `apps:keys:rotate` (topic:verb, colon-separated, oclif style). */
  readonly id: string;
  readonly summary: string;
  readonly examples: readonly string[];
  /** The server re-checks; the client uses these for early, clear errors. */
  readonly requiredScopes: readonly CliScope[];
  /** true -> idempotency key + confirmation policy + audit hint. */
  readonly mutates: boolean;
  readonly confirm: ConfirmLevel;
  /** e.g. `revition.apps.list.v1` (T3.2.1 publishes these); null when the command has no data output. */
  readonly jsonSchemaId: string | null;
  /** beta / experimental show a notice; experimental needs an opt-in (T1.4.3). */
  readonly stability: Stability;
  /** A server-delivered flag gate (T1.4.3). */
  readonly featureFlag?: string;
  /** Paid actions must quote, then confirm (T16). */
  readonly paid?: { readonly quote: 'required' };
  /**
   * T1.5.1 - a deprecated command still works and warns on stderr (listed in `warnings[]` under --json). Policy
   * (docs/policy/deprecation.md): warn for at least one minor release and 90 days, remove in the next major.
   */
  readonly deprecated?: Deprecation;
}

export interface Deprecation {
  /** The version that deprecated it, e.g. `1.4.0`. */
  readonly since: string;
  /** The major that removes it, e.g. `2.0.0`. */
  readonly removeIn: string;
  /** What to run instead (a command id or text); null when there is no replacement. */
  readonly replacement: string | null;
}

const majorOf = (v: unknown): number | null =>
  typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? Number.parseInt(v.split('.')[0] ?? '', 10) : null;

/** The deprecation notice for a command, or null. PURE. */
export function deprecationNotice(meta: Pick<CommandMeta, 'id' | 'deprecated'>): string | null {
  const d = meta.deprecated;
  if (d === undefined) return null;
  const name = meta.id.replace(/:/g, ' ');
  const instead = d.replacement === null ? '' : ` Use \`${d.replacement.replace(/:/g, ' ')}\` instead.`;
  return `\`${name}\` is deprecated since ${d.since} and will be removed in ${d.removeIn}.${instead}`;
}

function deprecationProblems(d: unknown): string[] {
  if (d === undefined) return [];
  const x = (d ?? {}) as Record<string, unknown>;
  const since = majorOf(x['since']);
  const removeIn = majorOf(x['removeIn']);
  if (since === null || removeIn === null) return ['deprecated: since and removeIn must be x.y.z versions'];
  if (x['replacement'] !== null && (typeof x['replacement'] !== 'string' || x['replacement'] === '')) {
    return ['deprecated: replacement must be a non-empty string or null'];
  }
  // Policy: removal only in a later major (never within the major that deprecated it).
  return removeIn > since ? [] : ['deprecated: removeIn must be a later major than since'];
}

const STABILITIES: readonly Stability[] = ['stable', 'beta', 'experimental'];
const CONFIRM_LEVELS: readonly ConfirmLevel[] = ['none', 'prompt', 'typed'];

/**
 * Every field a command's `meta` must carry, checked as data (the manifest test enumerates every command and calls
 * this). Returns the list of problems; empty = complete. PURE.
 */
export function metaProblems(meta: unknown): string[] {
  if (meta === null || typeof meta !== 'object') return ['meta is missing'];
  const m = meta as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof m['id'] !== 'string' || !/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$/.test(m['id'])) {
    problems.push('id must be topic:verb (lowercase, colon-separated)');
  }
  if (typeof m['summary'] !== 'string' || m['summary'].trim() === '') problems.push('summary is empty');
  if (!Array.isArray(m['examples']) || m['examples'].length === 0) problems.push('examples: at least one');
  else if (m['examples'].some((e) => typeof e !== 'string' || e.trim() === '')) problems.push('examples: empty entry');
  if (!Array.isArray(m['requiredScopes'])) problems.push('requiredScopes is missing');
  else if (m['requiredScopes'].some((s) => !(CLI_SCOPES as readonly unknown[]).includes(s))) {
    problems.push('requiredScopes: unknown scope');
  }
  if (typeof m['mutates'] !== 'boolean') problems.push('mutates is missing');
  if (!CONFIRM_LEVELS.includes(m['confirm'] as ConfirmLevel)) problems.push('confirm is missing');
  if (m['jsonSchemaId'] !== null && (typeof m['jsonSchemaId'] !== 'string' || m['jsonSchemaId'] === '')) {
    problems.push('jsonSchemaId must be a string or null');
  }
  if (!STABILITIES.includes(m['stability'] as Stability)) problems.push('stability is missing');
  if (m['featureFlag'] !== undefined && (typeof m['featureFlag'] !== 'string' || m['featureFlag'] === '')) {
    problems.push('featureFlag must be a non-empty string when set');
  }
  if (m['paid'] !== undefined && (m['paid'] as { quote?: unknown } | null)?.quote !== 'required') {
    problems.push("paid must be { quote: 'required' } when set");
  }
  problems.push(...deprecationProblems(m['deprecated']));
  // Invariant: mutates -> a confirmation policy (an explicit --yes stands in for it in non-interactive mode).
  if (m['mutates'] === true && m['confirm'] === 'none') problems.push("a mutating command needs confirm 'prompt' or 'typed'");
  return problems;
}
