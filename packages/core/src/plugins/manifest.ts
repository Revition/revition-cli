import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

/**
 * T4.2.2 (REVITION-CLI-PLAN.md:3094-3117) - what a plugin may do, declared in `revition-plugin.json` at its package
 * root, shown at install, and enforced at run time (sandboxed-context.ts):
 *
 *   { "schemaVersion": 1,
 *     "commands": { "<name>": { "entry": "dist/<file>.js", "summary": "<one line>" } },
 *     "permissions": ["api:apps:read", "fs:project:read", "exec:none", "network:none"] }
 *
 * Permission grammar (anything else is refused at install):
 *   api:<resource>:read|write  - Dev API calls under /dev/<resource>, made by core with the user's credential (the plugin
 *                                never holds it); read = GET, write = POST / PUT / PATCH / DELETE
 *   fs:project:read|write      - files inside the current project root only (write implies read)
 *   exec:none | exec:<program> - run the named program (no shell); none = no process may be started
 *   network:none               - no direct network (documented: best effort, see ADR 0007; API calls go through core)
 */
export const MANIFEST_FILE = 'revition-plugin.json';

export interface PluginCommand {
  readonly entry: string;
  readonly summary: string;
}

export interface PluginManifest {
  readonly schemaVersion: 1;
  readonly commands: Readonly<Record<string, PluginCommand>>;
  readonly permissions: readonly string[];
}

export interface Grants {
  readonly api: ReadonlyMap<string, 'read' | 'write'>;
  readonly fsRead: boolean;
  readonly fsWrite: boolean;
  readonly exec: readonly string[];
}

const API = /^api:([a-z][a-z0-9-]{0,40}):(read|write)$/u;
const EXEC = /^exec:([A-Za-z0-9._-]{1,64})$/u;
const COMMAND = /^[a-z][a-z0-9-]{0,40}$/u;
const ENTRY = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+\.(m?js|cjs)$/u;

function bad(why: string): RevitionCliError {
  return new RevitionCliError(
    { code: 'PLUGIN_MANIFEST_INVALID', message: `${MANIFEST_FILE}: ${why}.`, hint: 'The plugin cannot be installed; ask its publisher to fix the manifest.' },
    EXIT.permission
  );
}

/** Parses and validates a manifest; unknown fields and unknown permissions are refused. PURE. */
export function parseManifest(text: string): PluginManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw bad('not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('not a JSON object');
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['schemaVersion', 'commands', 'permissions'].includes(k)) throw bad(`unknown field "${k}"`);
  if (o['schemaVersion'] !== 1) throw bad('schemaVersion must be 1');
  const cmds = o['commands'];
  if (typeof cmds !== 'object' || cmds === null || Array.isArray(cmds) || Object.keys(cmds).length === 0) throw bad('commands must name at least one command');
  const commands: Record<string, PluginCommand> = {};
  for (const [name, c] of Object.entries(cmds as Record<string, unknown>)) {
    if (!COMMAND.test(name)) throw bad(`command name "${name}" is not lower-case words`);
    const cc = c as Record<string, unknown> | null;
    if (cc === null || typeof cc['entry'] !== 'string' || !ENTRY.test(cc['entry'])) throw bad(`command "${name}" needs an entry: a relative .js path inside the package`);
    if (typeof cc['summary'] !== 'string' || cc['summary'].trim() === '') throw bad(`command "${name}" needs a summary`);
    commands[name] = { entry: cc['entry'], summary: cc['summary'] };
  }
  const perms = o['permissions'];
  if (!Array.isArray(perms) || !perms.every((p) => typeof p === 'string')) throw bad('permissions must be a list of strings');
  for (const p of perms as string[]) {
    if (!(API.test(p) || EXEC.test(p) || ['fs:project:read', 'fs:project:write', 'fs:none', 'network:none'].includes(p))) {
      throw bad(`unknown permission "${p}"`);
    }
  }
  const execs = (perms as string[]).filter((p) => p.startsWith('exec:'));
  if (execs.includes('exec:none') && execs.length > 1) throw bad('exec:none cannot be combined with another exec permission');
  return { schemaVersion: 1, commands, permissions: [...new Set(perms as string[])] };
}

/** The effective grants (nothing is granted that is not declared). PURE. */
export function grantsOf(m: PluginManifest): Grants {
  const api = new Map<string, 'read' | 'write'>();
  const exec: string[] = [];
  let fsRead = false;
  let fsWrite = false;
  for (const p of m.permissions) {
    const a = API.exec(p);
    if (a !== null) {
      const [, res, mode] = a as unknown as [string, string, 'read' | 'write'];
      if (mode === 'write' || !api.has(res)) api.set(res, mode);
      continue;
    }
    const e = EXEC.exec(p);
    if (e !== null && e[1] !== 'none') exec.push(e[1] as string);
    if (p === 'fs:project:read') fsRead = true;
    if (p === 'fs:project:write') {
      fsRead = true;
      fsWrite = true;
    }
  }
  return { api, fsRead, fsWrite, exec };
}

/** One plain-language line per permission, for the install prompt (AC3). PURE. */
export function describePermissions(m: PluginManifest): string[] {
  const g = grantsOf(m);
  const lines: string[] = [];
  for (const [res, mode] of g.api) lines.push(`${mode === 'write' ? 'Read and change' : 'Read'} your ${res} through the Revition API (as you; it never sees your sign-in)`);
  if (g.fsWrite) lines.push('Read and change files in the current project folder');
  else if (g.fsRead) lines.push('Read files in the current project folder');
  for (const x of g.exec) lines.push(`Run the program "${x}" on this computer`);
  if (lines.length === 0) lines.push('Nothing beyond printing output (no API, files or programs)');
  return lines;
}
