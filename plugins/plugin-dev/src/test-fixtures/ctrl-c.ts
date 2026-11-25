import type { ChildProcess, SpawnOptions } from 'node:child_process';

/**
 * Ctrl-C for a spawned CLI, on every OS (T2.1.3 AC3, T2.1.4 AC1/AC2: "until Ctrl-C", exit 11). POSIX: a real SIGINT.
 * Windows has no POSIX signals for a child (child.kill('SIGINT') kills it outright), so the child runs with a test-only
 * bridge (ctrl-c-bridge.mjs) and receives the console's 'SIGINT' event over IPC. REVITION_TEST_CTRL_C=bridge forces the
 * Windows path on any OS, so it is exercised locally too.
 */
/** Already a file: URL on every OS (a valid --import specifier, unlike a Windows path). */
const BRIDGE = new URL('./ctrl-c-bridge.mjs', import.meta.url).href;

export function bridged(env: NodeJS.ProcessEnv = process.env): boolean {
  return process.platform === 'win32' || env['REVITION_TEST_CTRL_C'] === 'bridge';
}

/**
 * Spawn options for a child the test will Ctrl-C: adds the IPC channel + the bridge preload where needed. Returns the
 * same option type it was given, so the child keeps its piped stdio type.
 */
export function interruptible<T extends SpawnOptions & { readonly env: NodeJS.ProcessEnv }>(opts: T): T {
  if (!bridged()) return opts;
  const stdio = Array.isArray(opts.stdio) ? opts.stdio.slice(0, 3) : ['pipe', 'pipe', 'pipe'];
  return {
    ...opts,
    stdio: [...stdio, 'ipc'],
    env: { ...opts.env, NODE_OPTIONS: `${opts.env['NODE_OPTIONS'] ?? ''} --import=${BRIDGE}`.trim() },
  } as T;
}

/** Press Ctrl-C in the child. */
export function pressCtrlC(child: ChildProcess): void {
  if (bridged()) child.send('revition:ctrl-c');
  else child.kill('SIGINT');
}
