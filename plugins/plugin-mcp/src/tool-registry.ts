/**
 * T3.2.2 - the MCP tools, generated from the command registry (the loaded commands' manifest: meta, flags, args).
 *
 * A command becomes a tool only when ALL of these hold (REVITION-CLI-PLAN.md T3.2.2):
 * - `meta.mcp !== false`;
 * - it has a `--json` document (`meta.jsonSchemaId`): the tool output is that envelope;
 * - it is not a local command (LOCAL_COMMANDS: it changes this machine, not the platform; "no local file write tools in
 *   mcp mode");
 * - `meta.confirm !== 'typed'`: typed-confirm commands are NEVER exposed, even with --allow-write;
 * - `meta.mutates === false`, unless the server runs with --allow-write;
 * - a paid command only when the quote guard knows how to quote it (fail closed);
 * - not hidden (experimental / internal) and it matches `--tools` when given.
 * Release actions (publish, approve, go-live, promote) do not exist in the CLI (D9), so they cannot be listed.
 */

/**
 * Flags a tool caller never sets: the base flags every command has (set by the server), and `follow`, a stream that
 * never ends and so cannot be one tool result.
 */
export const BASE_FLAGS: ReadonlySet<string> = new Set(['json', 'no-input', 'yes', 'profile', 'debug', 'color', 'experimental', 'follow']);

/**
 * Commands whose effect is on this machine (files in the project, the CLI config, the stored credential, a local
 * server, the shell) rather than a platform operation. Not exposed in MCP mode: local actions belong to Assist under
 * its permission system (T3.3.x).
 */
export const LOCAL_COMMANDS: ReadonlySet<string> = new Set([
  'mcp:serve',
  // Assist is the local harness itself (and spends its session budget): never a tool of another client.
  'assist',
  'init',
  'scaffold',
  'generate',
  'link',
  'dev',
  'agents:pull',
  'agents:create',
  'login',
  'logout',
  'upgrade',
  'autocomplete',
  'config:edit',
  'config:get',
  'config:list',
  'config:path',
  'config:set',
  'config:unset',
  'profiles:list',
  'profiles:use',
  'profiles:remove',
  'telemetry:enable',
  'telemetry:disable',
  'telemetry:status',
  'telemetry:show-last',
]);

export interface LoadedFlag {
  readonly name?: string;
  readonly type?: string;
  readonly description?: string;
  readonly summary?: string;
  readonly required?: boolean;
  readonly multiple?: boolean;
  readonly options?: readonly string[];
  readonly allowNo?: boolean;
  readonly hidden?: boolean;
}

export interface LoadedArg {
  readonly name?: string;
  readonly description?: string;
  readonly required?: boolean;
  readonly options?: readonly string[];
}

export interface LoadedMeta {
  readonly id: string;
  readonly summary: string;
  readonly mutates: boolean;
  readonly confirm: string;
  readonly jsonSchemaId: string | null;
  readonly paid?: unknown;
  readonly mcp?: boolean;
  readonly stability?: string;
}

/** The parts of an oclif loaded command the registry reads. */
export interface LoadedCommand {
  readonly id: string;
  readonly hidden?: boolean;
  readonly flags?: Readonly<Record<string, LoadedFlag>>;
  readonly args?: Readonly<Record<string, LoadedArg>>;
  readonly meta?: LoadedMeta;
}

export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface ToolSpec {
  readonly name: string;
  readonly commandId: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly mutates: boolean;
  readonly paid: boolean;
  /** Positional arguments in order; every other input property is a flag. */
  readonly argNames: readonly string[];
  readonly booleanFlags: ReadonlySet<string>;
  readonly multipleFlags: ReadonlySet<string>;
  readonly annotations: { readonly readOnlyHint: boolean; readonly destructiveHint: boolean; readonly openWorldHint: true };
}

export interface RegistryOptions {
  readonly allowWrite: boolean;
  /** Comma-separated globs over tool names or command ids (`*`, `?`); empty = all. */
  readonly tools?: string;
  /** The paid commands the quote guard can quote (PAID_QUOTE_SPECS keys). */
  readonly quotable: ReadonlySet<string>;
}

/** `apps:keys:list` -> `revition_apps_keys_list`. PURE. */
export function toolName(commandId: string): string {
  return `revition_${commandId.replace(/[^a-zA-Z0-9]+/g, '_')}`;
}

function globRegex(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

/** Whether a tool passes the `--tools` filter (a glob over its tool name or its command id). PURE. */
export function matchesTools(filter: string | undefined, name: string, commandId: string): boolean {
  const globs = (filter ?? '').split(',').map((g) => g.trim()).filter((g) => g !== '');
  if (globs.length === 0) return true;
  const spaced = commandId.replace(/:/g, ' ');
  return globs.some((g) => {
    const re = globRegex(g);
    return re.test(name) || re.test(commandId) || re.test(spaced);
  });
}

function flagSchema(f: LoadedFlag): Record<string, unknown> {
  const description = f.summary ?? f.description;
  const base: Record<string, unknown> =
    f.type === 'boolean' ? { type: 'boolean' } : f.options !== undefined && f.options.length > 0 ? { type: 'string', enum: [...f.options] } : { type: 'string' };
  const one = description === undefined ? base : { ...base, description };
  return f.multiple === true && f.type !== 'boolean' ? { type: 'array', items: base, ...(description === undefined ? {} : { description }) } : one;
}

function argSchema(a: LoadedArg): Record<string, unknown> {
  const base: Record<string, unknown> = a.options !== undefined && a.options.length > 0 ? { type: 'string', enum: [...a.options] } : { type: 'string' };
  return a.description === undefined ? base : { ...base, description: a.description };
}

/** Why a command is not a tool, or null when it is one. PURE. */
export function exclusionReason(c: LoadedCommand, opts: RegistryOptions): string | null {
  const m = c.meta;
  if (m === undefined) return 'no meta';
  if (m.mcp === false) return 'meta.mcp is false';
  if (c.hidden === true || m.stability === 'experimental') return 'hidden or experimental';
  if (m.jsonSchemaId === null) return 'no --json document';
  if (LOCAL_COMMANDS.has(m.id)) return 'a local command (no local file write tools in mcp mode)';
  if (m.confirm === 'typed') return 'typed confirmation: never exposed via MCP';
  if (m.mutates && !opts.allowWrite) return 'mutating: needs --allow-write';
  if (m.paid !== undefined && !opts.quotable.has(m.id)) return 'paid without a quote guard';
  if (!matchesTools(opts.tools, toolName(m.id), m.id)) return 'not in --tools';
  return null;
}

/** The tool for one command (the caller has checked exclusionReason). PURE. */
export function toolSpec(c: LoadedCommand & { readonly meta: LoadedMeta }): ToolSpec {
  const m = c.meta;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const argNames: string[] = [];
  for (const [name, a] of Object.entries(c.args ?? {})) {
    argNames.push(name);
    properties[name] = argSchema(a);
    if (a.required === true) required.push(name);
  }
  const booleanFlags = new Set<string>();
  const multipleFlags = new Set<string>();
  for (const [name, f] of Object.entries(c.flags ?? {})) {
    if (BASE_FLAGS.has(name) || f.hidden === true) continue;
    properties[name] = flagSchema(f);
    if (f.type === 'boolean') booleanFlags.add(name);
    else if (f.multiple === true) multipleFlags.add(name);
    if (f.required === true) required.push(name);
  }
  const paid = m.paid !== undefined;
  if (paid) {
    properties['quoteId'] = { type: 'string', description: 'The quote id from revition_quote for exactly these arguments.' };
    required.push('quoteId');
  }
  const description = [
    m.summary,
    paid ? 'Paid: call revition_quote with the same arguments first and pass its quoteId.' : '',
    m.mutates ? 'Changes data on the platform.' : '',
    'Returns the command\'s JSON envelope.',
  ]
    .filter((s) => s !== '')
    .join(' ');
  return {
    name: toolName(m.id),
    commandId: m.id,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    mutates: m.mutates,
    paid,
    argNames,
    booleanFlags,
    multipleFlags,
    annotations: { readOnlyHint: !m.mutates && !paid, destructiveHint: m.mutates, openWorldHint: true },
  };
}

/** Every tool for the loaded commands, sorted by name. PURE. */
export function buildTools(commands: readonly LoadedCommand[], opts: RegistryOptions): ToolSpec[] {
  return commands
    .filter((c): c is LoadedCommand & { readonly meta: LoadedMeta } => exclusionReason(c, opts) === null)
    .map(toolSpec)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The CLI argv for a tool call (the server adds `--json --no-input`, the profile and, for a confirmed change, `--yes`).
 * Unknown input properties are refused, never passed through. PURE.
 */
export function toolArgv(t: ToolSpec, input: Readonly<Record<string, unknown>>): string[] {
  const known = new Set(Object.keys(t.inputSchema.properties));
  for (const k of Object.keys(input)) if (!known.has(k)) throw new Error(`Unknown argument "${k}" for ${t.name}.`);
  for (const k of t.inputSchema.required) if (input[k] === undefined || input[k] === null) throw new Error(`Missing argument "${k}" for ${t.name}.`);
  const argv: string[] = [...t.commandId.split(':')];
  for (const a of t.argNames) {
    const v = input[a];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') throw new Error(`Argument "${a}" must be a string.`);
    // A positional value is never read as a flag (no `--yes` smuggled in through an argument).
    if (v.startsWith('-')) throw new Error(`Argument "${a}" must not start with "-".`);
    argv.push(v);
  }
  for (const [k, v] of Object.entries(input)) {
    if (t.argNames.includes(k) || k === 'quoteId' || v === undefined || v === null) continue;
    if (t.booleanFlags.has(k)) {
      if (typeof v !== 'boolean') throw new Error(`Flag "${k}" must be a boolean.`);
      if (v) argv.push(`--${k}`);
      continue;
    }
    const values = t.multipleFlags.has(k) ? (Array.isArray(v) ? v : [v]) : [v];
    for (const one of values) {
      if (typeof one !== 'string' && typeof one !== 'number') throw new Error(`Flag "${k}" must be a string.`);
      argv.push(`--${k}=${String(one)}`);
    }
  }
  return argv;
}
