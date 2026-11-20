import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The CLI entry the real-process suites drive. L3 (REVITION-CLI-PLAN.md:3265, "npm pack -> npm i -g ... the real
 * `revition` binary"): `scripts/l3-packed-install.mjs` installs the packed artifact into a fresh global prefix and sets
 * REVITION_L3_BIN to its `revition` bin, so the same suites run against the shipped package, not the source tree.
 */
export const CLI_BIN = process.env['REVITION_L3_BIN'] ?? fileURLToPath(new URL('../../bin/run', import.meta.url));
export const FIXTURE_RUN = fileURLToPath(new URL('./fixture-plugin/run.mjs', import.meta.url));

export interface Spawned {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly ms: number;
}

/** Runs a CLI entry (the real bin or the fixture plugin) as a child process; stdin is not a TTY. */
export function runCli(
  entry: string,
  args: readonly string[],
  opts: { env?: Record<string, string | undefined>; onStderr?: (chunk: string, kill: (s: NodeJS.Signals) => void) => void; input?: string } = {}
): Promise<Spawned> {
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      env: { ...process.env, NO_COLOR: '1', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      opts.onStderr?.(d.toString(), (s) => child.kill(s));
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: performance.now() - started }));
    child.stdin.end(opts.input ?? '');
  });
}
