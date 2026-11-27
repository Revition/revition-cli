import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  assertTextFile,
  BLOCKED_BY_POLICY,
  execDecision,
  guardPath,
  LOCAL_TOOLS,
  MAX_FILE_BYTES,
  matchesAny,
  PolicyRefusal,
  redactSecrets,
  runLocalCommand,
  scanSecrets,
  uploadable,
  type LocalTool,
  type PermissionPolicy,
} from '@revition/cli-core';

import { pushBackup, writeProjectFile } from './backup.js';

/**
 * CLI-T3.4.1 AC1 (user Assist re-run as_de5356ef, auditor #595): `run_tests` with no command ran `npm test`, but a
 * Revition project (`revition init`: revition.json + capabilities/) has no package.json, so it always failed and the
 * model concluded "no package.json in the project root". A Revition project's tests are `revition test` (offline, the
 * project's own tests.json); a package.json keeps `npm test`. The model may still name any command (asked first).
 */
export function defaultTestCommand(root: string): string {
  if (existsSync(join(root, 'package.json'))) return 'npm test';
  return existsSync(join(root, 'revition.json')) ? 'revition test' : 'npm test';
}
import { applyUnifiedPatch, StalePatch, unifiedDiff } from './diff.js';

/**
 * T3.3.2 - the local tool executor. The platform's model only REQUESTS local tools (T3.3.1); each request is checked
 * against the permission policy here, on this machine: paths confined to the project (realpath), the deny list wins,
 * writes show a diff and wait for `y` in `ask` mode (and are refused when the file changed since the diff), commands
 * need approval or the allowlist, and no secret-bearing content is ever put into a result sent to the platform.
 */
export interface ToolRequest {
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly reason: string;
}

export interface ToolResult {
  readonly tool: string;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: string;
}

export type Approval =
  | { readonly kind: 'write'; readonly path: string; readonly diff: string; readonly reason: string }
  | { readonly kind: 'exec'; readonly command: string; readonly reason: string };

export interface ExecutorDeps {
  readonly policy: PermissionPolicy;
  /** Shows the request (diff or command, with the model's reason) and returns the person's y/n. */
  readonly approve: (a: Approval) => Promise<boolean>;
  /** Shown before a write is applied (the diff), whatever the mode: every local action is visible. */
  readonly show?: (text: string) => void;
}

const MAX_SEARCH_HITS = 200;
const SKIP_DIRS = new Set(['.git', 'node_modules']);
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

function str(args: Readonly<Record<string, unknown>>, key: string, required: boolean): string | undefined {
  const v = args[key];
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string' || v === '') throw new PolicyRefusal(`the request needs a "${key}" string`);
  return v;
}

export class LocalExecutor {
  private writesApprovedForSession = false;

  constructor(private readonly deps: ExecutorDeps) {}

  /** One tool request -> its result (never throws). A result that would carry a secret is replaced by the block. */
  async handle(req: ToolRequest): Promise<ToolResult> {
    let result: ToolResult;
    try {
      if (!(LOCAL_TOOLS as readonly string[]).includes(req.tool)) throw new PolicyRefusal(`${req.tool} is not a local tool`);
      if (typeof req.reason !== 'string' || req.reason.trim() === '') throw new PolicyRefusal('a local tool request needs a reason');
      result = await this.run(req.tool as LocalTool, req.args ?? {}, req.reason);
    } catch (e) {
      result = { tool: req.tool, ok: false, error: e instanceof PolicyRefusal || e instanceof StalePatch ? e.message : `failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    this.log(req, result);
    // The last guard: nothing that looks like a secret leaves in any field of any result.
    const wire = JSON.stringify(result);
    return scanSecrets(wire).length === 0 ? result : { tool: req.tool, ok: false, error: BLOCKED_BY_POLICY };
  }

  private async run(tool: LocalTool, args: Readonly<Record<string, unknown>>, reason: string): Promise<ToolResult> {
    switch (tool) {
      case 'read_file':
        return this.readFile(str(args, 'path', true) ?? '');
      case 'list_dir':
        return this.listDir(str(args, 'path', false) ?? '.');
      case 'search':
        return this.search(str(args, 'query', true) ?? '', str(args, 'path', false) ?? '.');
      case 'write_file':
        return this.write(str(args, 'path', true) ?? '', reason, () => {
          const c = args['content'];
          if (typeof c !== 'string') throw new PolicyRefusal('the request needs a "content" string');
          return c;
        });
      case 'apply_patch': {
        const patch = str(args, 'patch', true) ?? '';
        return this.write(str(args, 'path', true) ?? '', reason, (before) => applyUnifiedPatch(before ?? '', patch), 'apply_patch');
      }
      case 'run_tests':
        return this.exec(str(args, 'command', false) ?? defaultTestCommand(this.deps.policy.root), reason, 'run_tests');
      case 'run_command':
        return this.exec(str(args, 'command', true) ?? '', reason, 'run_command');
    }
  }

  private readFile(path: string): ToolResult {
    const g = guardPath(this.deps.policy, path, 'read');
    assertTextFile(g);
    const u = uploadable(readFileSync(g.abs, 'utf8'));
    return u.ok ? { tool: 'read_file', ok: true, output: { path: g.rel, content: u.text } } : { tool: 'read_file', ok: false, error: u.reason };
  }

  private listDir(path: string): ToolResult {
    const g = guardPath(this.deps.policy, path, 'list');
    const items = readdirSync(g.abs, { withFileTypes: true })
      .map((d) => ({ name: d.name, rel: g.rel === '' ? d.name : `${g.rel}/${d.name}`, dir: d.isDirectory() }))
      .filter((d) => !matchesAny(d.rel, this.deps.policy.denyRead))
      .map((d) => ({ name: d.name, type: d.dir ? 'dir' : 'file' }));
    return { tool: 'list_dir', ok: true, output: { path: g.rel === '' ? '.' : g.rel, entries: items } };
  }

  private search(query: string, path: string): ToolResult {
    const start = guardPath(this.deps.policy, path, 'list');
    const hits: { path: string; line: number; text: string }[] = [];
    let blocked = 0;
    const walk = (dir: string): void => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (hits.length >= MAX_SEARCH_HITS) return;
        const abs = join(dir, d.name);
        const rel = relative(this.deps.policy.root, abs).split('\\').join('/');
        if (d.isSymbolicLink() || matchesAny(rel, this.deps.policy.denyRead)) continue;
        if (d.isDirectory()) {
          if (!SKIP_DIRS.has(d.name)) walk(abs);
          continue;
        }
        if (!d.isFile() || statSync(abs).size > MAX_FILE_BYTES) continue;
        if (this.deps.policy.allowRead.length > 0 && !matchesAny(rel, this.deps.policy.allowRead)) continue;
        const text = readFileSync(abs, 'utf8');
        if (text.includes('\0') || !text.includes(query)) continue;
        if (!uploadable(text).ok) {
          blocked++;
          continue;
        }
        text.split(/\r?\n/).forEach((l, i) => {
          if (l.includes(query) && hits.length < MAX_SEARCH_HITS) hits.push({ path: rel, line: i + 1, text: l.slice(0, 400) });
        });
      }
    };
    walk(start.abs);
    return { tool: 'search', ok: true, output: { query, hits, ...(blocked > 0 ? { blockedFiles: blocked, note: BLOCKED_BY_POLICY } : {}) } };
  }

  private async write(path: string, reason: string, next: (before: string | null) => string, tool: 'write_file' | 'apply_patch' = 'write_file'): Promise<ToolResult> {
    const policy = this.deps.policy;
    if (policy.writeMode === 'never') throw new PolicyRefusal('blocked by policy: writes are off (writeMode never)');
    const g = guardPath(policy, path, 'write');
    const exists = existsSync(g.abs);
    if (exists) assertTextFile(g);
    const before = exists ? readFileSync(g.abs, 'utf8') : null;
    const after = next(before);
    const diff = unifiedDiff(g.rel, before, after);
    this.deps.show?.(`${diff}\n`);
    if (policy.writeMode === 'ask' || !this.writesApprovedForSession) {
      const yes = await this.deps.approve({ kind: 'write', path: g.rel, diff, reason });
      if (!yes) return { tool, ok: false, error: 'declined by the developer' };
      if (policy.writeMode === 'auto-in-session') this.writesApprovedForSession = true;
    }
    // Stale check: the file must still be what the diff was made from.
    const now = existsSync(g.abs) ? readFileSync(g.abs, 'utf8') : null;
    if ((now === null ? null : sha(now)) !== (before === null ? null : sha(before))) {
      return { tool, ok: false, error: 'the file changed since the diff was shown; nothing was written' };
    }
    await pushBackup(policy.root, g.rel, before);
    writeProjectFile(g.abs, after);
    return { tool, ok: true, output: { path: g.rel, applied: true, created: before === null } };
  }

  private async exec(command: string, reason: string, tool: 'run_tests' | 'run_command'): Promise<ToolResult> {
    const decision = execDecision(this.deps.policy, command);
    if (decision === 'deny') throw new PolicyRefusal('blocked by policy: commands are off (execMode never)');
    if (decision === 'ask' && !(await this.deps.approve({ kind: 'exec', command, reason }))) {
      return { tool, ok: false, error: 'declined by the developer' };
    }
    const r = await runLocalCommand(this.deps.policy, command);
    return { tool, ok: r.exitCode === 0, output: r };
  }

  /** Opt-in decision log (`.revition/assist-log.ndjson`): what was asked and decided, never file content. */
  private log(req: ToolRequest, result: ToolResult): void {
    if (!this.deps.policy.log) return;
    const dir = join(this.deps.policy.root, '.revition');
    mkdirSync(dir, { recursive: true });
    const target = typeof req.args?.['path'] === 'string' ? { path: req.args['path'] } : typeof req.args?.['command'] === 'string' ? { command: req.args['command'] } : {};
    const line = { at: new Date().toISOString(), tool: req.tool, reason: req.reason, ...target, ok: result.ok, ...(result.error === undefined ? {} : { error: result.error }) };
    appendFileSync(join(dir, 'assist-log.ndjson'), `${redactSecrets(JSON.stringify(line))}\n`, { mode: 0o600 });
  }
}
