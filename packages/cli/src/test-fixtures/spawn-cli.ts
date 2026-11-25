import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * The CLI entry the real-process suites drive. L3 (REVITION-CLI-PLAN.md:3265, "npm pack -> npm i -g ... the real
 * `revition` binary"): `scripts/l3-packed-install.mjs` installs the packed artifact into a fresh global prefix and sets
 * REVITION_L3_BIN to its `revition` bin, so the same suites run against the shipped package, not the source tree.
 */
export const CLI_BIN = process.env['REVITION_L3_BIN'] ?? fileURLToPath(new URL('../../bin/run', import.meta.url));
export const FIXTURE_RUN = fileURLToPath(new URL('./fixture-plugin/run.mjs', import.meta.url));

/**
 * Ctrl-C on every OS. POSIX: a real SIGINT. Windows: child.kill('SIGINT') kills the child outright, so a child that a
 * test may interrupt runs with the bridge preload (ctrl-c-bridge.mjs, already a file: URL, a valid --import specifier)
 * over an IPC channel. REVITION_TEST_CTRL_C=bridge forces that path on any OS, so it is exercised locally too.
 */
const BRIDGE = new URL('./ctrl-c-bridge.mjs', import.meta.url).href;
const bridged = (): boolean => process.platform === 'win32' || process.env['REVITION_TEST_CTRL_C'] === 'bridge';

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
    const env: Record<string, string | undefined> = { ...process.env, NO_COLOR: '1', ...opts.env };
    const bridge = opts.onStderr !== undefined && bridged();
    if (bridge) env['NODE_OPTIONS'] = `${env['NODE_OPTIONS'] ?? ''} --import=${BRIDGE}`.trim();
    // The three standard streams are always pipes (the IPC channel, when added, is a fourth).
    const child = spawn(process.execPath, [entry, ...args], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', ...(bridge ? (['ipc'] as const) : [])],
    }) as ChildProcessWithoutNullStreams;
    const kill = (s: NodeJS.Signals): void => {
      if (bridge && s === 'SIGINT') child.send('revition:ctrl-c');
      else child.kill(s);
    };
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      opts.onStderr?.(d.toString(), kill);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: performance.now() - started }));
    // A child that exits without reading stdin (most commands) makes this write fail with EPIPE; the run's result is
    // its exit, so the write error is ignored rather than thrown out of the test (spawn-cli-epipe.test.ts).
    child.stdin.on('error', () => undefined);
    child.stdin.end(opts.input ?? '');
  });
}
