import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { RevitionCliError } from '../errors/cli-error.js';
import { EXIT } from '../output/exit-codes.js';

/**
 * T3.3.2 - what Revition Assist may do on this machine. The project's `.revition/assist.json` and the user's defaults
 * (`<config dir>/assist.json`) narrow it; the default deny list is always applied (deny wins).
 */
export type LocalTool = 'read_file' | 'list_dir' | 'search' | 'write_file' | 'apply_patch' | 'run_tests' | 'run_command';

export const LOCAL_TOOLS: readonly LocalTool[] = ['read_file', 'list_dir', 'search', 'write_file', 'apply_patch', 'run_tests', 'run_command'];

export interface PermissionPolicy {
  /** The project root (realpath): nothing outside it, symlinks resolved. */
  readonly root: string;
  readonly allowRead: readonly string[];
  readonly denyRead: readonly string[];
  /** Default 'ask': a diff preview and y/n per change. */
  readonly writeMode: 'ask' | 'auto-in-session' | 'never';
  /** Default 'ask'; `allowlist` runs only the listed commands without asking (others still need approval). */
  readonly execMode: 'ask' | 'allowlist' | 'never';
  readonly execAllowlist: readonly string[];
  /** Local commands run with the network denied where the OS allows it (best effort, documented). */
  readonly network: 'deny' | 'allow';
  /** Log every decision to `.revition/assist-log.ndjson` (opt-in). */
  readonly log: boolean;
}

/** Always denied, whatever a config says (globs over the root-relative path; a pattern without `/` matches a name). */
export const DEFAULT_DENY_READ: readonly string[] = [
  '.env*',
  '**/*.pem',
  '**/id_*',
  '.git/config',
  '.git-credentials',
  'node_modules/.cache/**',
  '.revition/assist-log.ndjson',
  '.revition/assist/**',
];

export const DEFAULT_EXEC_ALLOWLIST: readonly string[] = ['npm test', 'revition test'];

export interface PolicyFile {
  readonly allowRead?: readonly string[];
  readonly denyRead?: readonly string[];
  readonly writeMode?: PermissionPolicy['writeMode'];
  readonly execMode?: PermissionPolicy['execMode'];
  readonly execAllowlist?: readonly string[];
  readonly network?: PermissionPolicy['network'];
  readonly log?: boolean;
}

const WRITE_MODES = new Set(['ask', 'auto-in-session', 'never']);
const EXEC_MODES = new Set(['ask', 'allowlist', 'never']);

function strings(v: unknown, field: string, file: string): readonly string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) throw badFile(file, `${field} must be a list of strings`);
  return v as string[];
}

function badFile(file: string, why: string): RevitionCliError {
  return new RevitionCliError({ code: 'ASSIST_POLICY_INVALID', message: `${file}: ${why}.`, hint: 'Fix the file, or delete it to use the defaults.' }, EXIT.usage);
}

/** A policy file's content, checked field by field (unknown fields refused). PURE. */
export function parsePolicyFile(text: string, file: string): PolicyFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw badFile(file, 'not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw badFile(file, 'not a JSON object');
  const o = raw as Record<string, unknown>;
  const known = new Set(['allowRead', 'denyRead', 'writeMode', 'execMode', 'execAllowlist', 'network', 'log']);
  for (const k of Object.keys(o)) if (!known.has(k)) throw badFile(file, `unknown field "${k}"`);
  if (o['writeMode'] !== undefined && !WRITE_MODES.has(String(o['writeMode']))) throw badFile(file, 'writeMode must be ask, auto-in-session or never');
  if (o['execMode'] !== undefined && !EXEC_MODES.has(String(o['execMode']))) throw badFile(file, 'execMode must be ask, allowlist or never');
  if (o['network'] !== undefined && o['network'] !== 'deny' && o['network'] !== 'allow') throw badFile(file, 'network must be deny or allow');
  if (o['log'] !== undefined && typeof o['log'] !== 'boolean') throw badFile(file, 'log must be true or false');
  const allowRead = strings(o['allowRead'], 'allowRead', file);
  const denyRead = strings(o['denyRead'], 'denyRead', file);
  const execAllowlist = strings(o['execAllowlist'], 'execAllowlist', file);
  return {
    ...(allowRead === undefined ? {} : { allowRead }),
    ...(denyRead === undefined ? {} : { denyRead }),
    ...(execAllowlist === undefined ? {} : { execAllowlist }),
    ...(o['writeMode'] === undefined ? {} : { writeMode: o['writeMode'] as PermissionPolicy['writeMode'] }),
    ...(o['execMode'] === undefined ? {} : { execMode: o['execMode'] as PermissionPolicy['execMode'] }),
    ...(o['network'] === undefined ? {} : { network: o['network'] as PermissionPolicy['network'] }),
    ...(o['log'] === undefined ? {} : { log: o['log'] as boolean }),
  };
}

/**
 * The effective policy: the defaults, then the user's defaults, then the project's file. Deny lists add up (the default
 * deny list can never be removed); the other fields take the most specific value. PURE (given the parsed files).
 */
export function effectivePolicy(root: string, user: PolicyFile = {}, project: PolicyFile = {}): PermissionPolicy {
  return {
    root,
    allowRead: project.allowRead ?? user.allowRead ?? [],
    denyRead: [...DEFAULT_DENY_READ, ...(user.denyRead ?? []), ...(project.denyRead ?? [])],
    writeMode: project.writeMode ?? user.writeMode ?? 'ask',
    execMode: project.execMode ?? user.execMode ?? 'ask',
    execAllowlist: project.execAllowlist ?? user.execAllowlist ?? DEFAULT_EXEC_ALLOWLIST,
    network: project.network ?? user.network ?? 'deny',
    log: project.log ?? user.log ?? false,
  };
}

/** Reads both files (when present) for a project root. */
export function loadPolicy(projectRoot: string, userConfigDir: string): PermissionPolicy {
  const root = realpathSync(projectRoot);
  const read = (file: string): PolicyFile => (existsSync(file) ? parsePolicyFile(readFileSync(file, 'utf8'), file) : {});
  return effectivePolicy(root, read(join(userConfigDir, 'assist.json')), read(join(root, '.revition', 'assist.json')));
}
