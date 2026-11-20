import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { grantsOf, type PluginManifest } from './manifest.js';

/**
 * T4.2.2 (REVITION-CLI-PLAN.md:3094-3117) - a third-party plugin command runs OUT OF PROCESS, in a child Node process
 * under Node's permission model, with a capability-scoped context instead of credentials:
 *   - file reads only inside the plugin's own folder, plus the project folder when `fs:project:read|write` is declared;
 *     file writes only in the project folder and only with `fs:project:write` (so the credential store, the config
 *     folder and the keychain database are unreadable: ERR_ACCESS_DENIED);
 *   - no native addons (`--allow-addons` is never given: the OS keychain binding cannot load) and no worker threads;
 *   - starting a process only with a declared `exec:<program>` (without one, child_process is denied by Node);
 *   - the environment is rebuilt from scratch: no token, no HOME, no Revition settings reach the plugin;
 *   - API calls go to core over IPC; core checks the declared `api:<resource>:<read|write>` and makes the call with the
 *     user's credential, returning only the response. The token never crosses into the plugin process.
 * Node's limits (no per-program exec scoping, no network permission on Node 22) are recorded in ADR 0007.
 */

export interface ApiCall {
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
}

export interface SandboxDeps {
  /** Core's authenticated client (holds the credential; the plugin never does). */
  readonly api: (call: ApiCall) => Promise<{ readonly status: number; readonly body: unknown }>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface RunPluginOptions {
  readonly pluginDir: string;
  readonly manifest: PluginManifest;
  readonly command: string;
  readonly argv: readonly string[];
  readonly projectRoot: string;
}

/** The API permission check core applies to every plugin call. Returns the refusal reason, or null. PURE. */
export function apiRefusal(manifest: PluginManifest, call: ApiCall): string | null {
  const m = /^\/dev\/([a-z][a-z0-9-]*)(\/|\?|$)/u.exec(call.path);
  if (m === null || call.path.includes('..') || /[\s#]/u.test(call.path)) return `the path ${call.path} is not a Dev API path`;
  const res = m[1] as string;
  const mode = grantsOf(manifest).api.get(res);
  const write = call.method.toUpperCase() !== 'GET';
  if (mode === undefined) return `this plugin did not declare api:${res}:${write ? 'write' : 'read'}`;
  if (write && mode !== 'write') return `this plugin did not declare api:${res}:write`;
  return null;
}

/** The node flag for the permission model on this runtime (stable name since Node 22.13). */
function permissionFlag(): string {
  return process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission' : '--experimental-permission';
}

/** The child's command line. Exported for the test that pins every flag. PURE (given its inputs). */
export function sandboxArgs(o: RunPluginOptions): string[] {
  const g = grantsOf(o.manifest);
  const args = [permissionFlag(), `--allow-fs-read=${o.pluginDir}`];
  if (g.fsRead) args.push(`--allow-fs-read=${o.projectRoot}`);
  if (g.fsWrite) args.push(`--allow-fs-write=${o.projectRoot}`);
  if (g.exec.length > 0) args.push('--allow-child-process');
  args.push('--input-type=module', '-e', HOST_SOURCE);
  return args;
}

/** The environment the plugin gets: built from nothing (no token, no HOME, no settings). PURE. */
export function sandboxEnv(o: RunPluginOptions, parent: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const g = grantsOf(o.manifest);
  const cmd = o.manifest.commands[o.command];
  const entry = resolve(o.pluginDir, cmd?.entry ?? '');
  const env: Record<string, string> = {
    REVITION_PLUGIN_HOST: JSON.stringify({
      entry,
      argv: o.argv,
      projectRoot: o.projectRoot,
      fsRead: g.fsRead,
      fsWrite: g.fsWrite,
      exec: g.exec,
    }),
  };
  for (const k of ['LANG', 'LC_ALL', 'TERM', 'NO_COLOR', 'FORCE_COLOR']) {
    const v = parent[k];
    if (v !== undefined) env[k] = v;
  }
  if (g.exec.length > 0 && parent['PATH'] !== undefined) env['PATH'] = parent['PATH'];
  return env;
}

/**
 * Runs one plugin command; resolves to its exit code. The plugin and project folders are resolved to their REAL paths
 * first: Node's permission model checks a read against the resolved path, so a folder reached through a symlink (a
 * symlinked home or XDG folder; macOS /var -> /private/var) would otherwise deny the plugin its own files.
 */
export async function runPluginCommand(given: RunPluginOptions, deps: SandboxDeps): Promise<number> {
  const o: RunPluginOptions = { ...given, pluginDir: realpathSync(given.pluginDir), projectRoot: realpathSync(given.projectRoot) };
  const cmd = o.manifest.commands[o.command];
  if (cmd === undefined) throw new Error(`The plugin has no command "${o.command}".`);
  const entry = resolve(o.pluginDir, cmd.entry);
  if (!entry.startsWith(o.pluginDir + sep)) throw new Error('The command entry is outside the plugin folder.');
  const child = spawn(process.execPath, sandboxArgs(o), {
    cwd: o.projectRoot,
    env: sandboxEnv(o, deps.env ?? process.env),
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  child.on('message', (raw: unknown) => {
    const m = raw as { id: number; op: string; args: ApiCall };
    if (m === null || typeof m !== 'object' || m.op !== 'api') return;
    const refusal = apiRefusal(o.manifest, m.args);
    if (refusal !== null) {
      child.send({ id: m.id, error: { code: 'PLUGIN_PERMISSION_DENIED', message: `Refused: ${refusal}.` } });
      return;
    }
    deps.api({ method: m.args.method.toUpperCase(), path: m.args.path, ...(m.args.body === undefined ? {} : { body: m.args.body }) }).then(
      (r) => child.connected && child.send({ id: m.id, result: { status: r.status, body: r.body } }),
      (e: unknown) => child.connected && child.send({ id: m.id, error: { code: 'PLUGIN_API_ERROR', message: (e as Error).message } })
    );
  });
  return new Promise((done, fail) => {
    child.on('error', fail);
    child.on('exit', (code) => done(code ?? 1));
  });
}

/** Where installed plugins live: `<dataDir>/plugins/<name>` (one folder per package). PURE. */
export function pluginDirFor(dataDir: string, name: string): string {
  return join(dataDir, 'plugins', name.replace('/', '__'));
}

/**
 * The host the child runs (plain JS, node builtins only, so it needs no file access of its own). It reads its config
 * from REVITION_PLUGIN_HOST, deletes it, builds the frozen context, imports the command and calls `run(ctx)`.
 */
export const HOST_SOURCE = String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const cfg = JSON.parse(process.env.REVITION_PLUGIN_HOST ?? '{}');
delete process.env.REVITION_PLUGIN_HOST;
let seq = 0;
const pending = new Map();
process.on('message', (m) => {
  const p = pending.get(m.id);
  if (p === undefined) return;
  pending.delete(m.id);
  if (m.error) p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }));
  else p.resolve(m.result);
});
const call = (op, args) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { resolve: res, reject: rej }); process.send({ id, op, args }); });
const denied = (what) => Object.assign(new Error('Refused: this plugin did not declare ' + what + '.'), { code: 'PLUGIN_PERMISSION_DENIED' });
const inProject = (p) => {
  const abs = resolve(cfg.projectRoot, String(p));
  const rel = relative(cfg.projectRoot, abs);
  if (rel.startsWith('..') || isAbsolute(rel)) throw denied('access outside the project folder');
  return abs;
};
const ctx = Object.freeze({
  argv: Object.freeze([...(cfg.argv ?? [])]),
  api: Object.freeze({ request: (method, path, body) => call('api', { method: String(method), path: String(path), body }) }),
  fs: Object.freeze({
    readFile: async (p) => { if (!cfg.fsRead) throw denied('fs:project:read'); return readFile(inProject(p), 'utf8'); },
    writeFile: async (p, d) => { if (!cfg.fsWrite) throw denied('fs:project:write'); return writeFile(inProject(p), String(d)); },
  }),
  exec: Object.freeze({
    run: (prog, args = []) => {
      if (!(cfg.exec ?? []).includes(prog)) throw denied('exec:' + prog);
      const r = spawnSync(prog, args.map(String), { cwd: cfg.projectRoot, encoding: 'utf8', shell: false });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    },
  }),
  print: (s) => { process.stdout.write(String(s) + '\n'); },
});
try {
  const mod = await import(pathToFileURL(cfg.entry).href);
  const fn = mod.run ?? mod.default;
  if (typeof fn !== 'function') throw new Error('the command module exports no run(ctx)');
  const code = await fn(ctx);
  process.exitCode = typeof code === 'number' ? code : 0;
} catch (e) {
  const code = e && e.code ? e.code : 'PLUGIN_ERROR';
  process.stderr.write(code + ': ' + (e && e.message ? e.message : String(e)) + '\n');
  process.exitCode = code === 'PLUGIN_PERMISSION_DENIED' || code === 'ERR_ACCESS_DENIED' ? 4 : 1;
} finally {
  if (process.connected) process.disconnect();
}
`;
