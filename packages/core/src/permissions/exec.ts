import { spawn, spawnSync } from 'node:child_process';

import type { PermissionPolicy } from './policy.js';
import { redactSecrets } from './secret-scan.js';

/**
 * T3.3.2 - local commands. `never` refuses every command; `allowlist` runs the listed commands without asking and
 * asks for any other; `ask` asks for every command. Commands run in the project root, without the CLI's own credential
 * in their environment, with the network denied where the OS allows it (Linux: `unshare -rn` when present; elsewhere
 * best effort, reported), and their output is redacted before it is shown or sent.
 */
export type ExecDecision = 'allow' | 'ask' | 'deny';

const norm = (c: string): string => c.trim().replace(/\s+/g, ' ');

/** PURE. */
export function execDecision(policy: PermissionPolicy, command: string): ExecDecision {
  if (policy.execMode === 'never') return 'deny';
  if (policy.execMode === 'allowlist' && policy.execAllowlist.map(norm).includes(norm(command))) return 'allow';
  return 'ask';
}

export const MAX_OUTPUT_CHARS = 256 * 1024;
export const EXEC_TIMEOUT_MS = 10 * 60_000;

/** Environment variables a local command never inherits (the CLI's own credentials). */
const WITHHELD_ENV = ['REVITION_TOKEN', 'REVITION_INSECURE_STORAGE_PASSPHRASE'];

export interface ExecResult {
  readonly exitCode: number | null;
  readonly output: string;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly networkIsolated: boolean;
}

let isolationProbe: boolean | undefined;

/**
 * Whether the OS ALLOWS a network-less user namespace here: probed by creating one (`unshare -rn true`), not by the
 * binary's presence. A host that ships `unshare` but restricts unprivileged user namespaces (e.g. Ubuntu 24.04's
 * AppArmor default) refuses it, and every command would fail; there the command runs unisolated, reported as such.
 */
function hasUnshare(): boolean {
  if (process.platform !== 'linux') return false;
  isolationProbe ??= spawnSync('unshare', ['-rn', 'true'], { stdio: 'ignore' }).status === 0;
  return isolationProbe;
}

/** Runs an approved command in the root. The caller has applied execDecision and any approval. */
export function runLocalCommand(policy: PermissionPolicy, command: string, timeoutMs: number = EXEC_TIMEOUT_MS): Promise<ExecResult> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of WITHHELD_ENV) delete env[k];
  const isolate = policy.network === 'deny' && hasUnshare();
  const [file, args] = isolate ? ['unshare', ['-rn', 'sh', '-c', command]] : [process.platform === 'win32' ? 'cmd.exe' : 'sh', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command]];
  return new Promise((resolve) => {
    const child = spawn(file, args, { cwd: policy.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let truncated = false;
    let timedOut = false;
    const take = (c: Buffer): void => {
      if (out.length >= MAX_OUTPUT_CHARS) {
        truncated = true;
        return;
      }
      out += c.toString('utf8');
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, output: redactSecrets(out.slice(0, MAX_OUTPUT_CHARS)), truncated, timedOut, networkIsolated: isolate });
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ exitCode: null, output: `could not start: ${command}`, truncated: false, timedOut: false, networkIsolated: isolate });
    });
  });
}
