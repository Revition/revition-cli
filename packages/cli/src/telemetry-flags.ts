import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  ask,
  atomicWriteFile,
  buildEvent,
  defaultCliPaths,
  enqueue,
  flagCacheFresh,
  impliedNoInput,
  installId,
  isCi,
  loadUserConfig,
  readFlagCache,
  setConfigValue,
  telemetryEnabled,
  telemetryForcedOff,
  TELEMETRY_DOCS_URL,
  createIo,
  type ConfigTelemetry,
} from '@revition/cli-core';

export const BACKGROUND_WORKER = fileURLToPath(new URL('./background-worker.js', import.meta.url));

export function startBackground(task: 'telemetry' | 'flags', profile: string | undefined, version: string): void {
  try {
    const child = spawn(process.execPath, [BACKGROUND_WORKER, task, profile ?? '', version], { detached: true, stdio: 'ignore', env: process.env });
    child.unref();
  } catch {
    // never fails a command
  }
}

/** T1.4.3: a command's flag from the cache (fresh or stale); a stale or missing cache is refreshed in the background. */
export function featureFromCache(name: string, profile: string, version: string): boolean {
  const { cacheDir } = defaultCliPaths();
  const c = readFlagCache(cacheDir, profile);
  if (!flagCacheFresh(c, Date.now())) startBackground('flags', profile, version);
  return c?.flags[name] === true;
}

export function enabledFlags(profile: string): ReadonlySet<string> {
  const c = readFlagCache(defaultCliPaths().cacheDir, profile);
  return new Set(Object.entries(c?.flags ?? {}).filter(([, on]) => on).map(([n]) => n));
}

/** T1.4.2: the first interactive run asks once (default No); a non-interactive first run never asks and stays off. */
async function firstRunConsent(json: boolean): Promise<ConfigTelemetry> {
  const paths = defaultCliPaths();
  const { config } = await loadUserConfig(paths.configFile);
  if (config.telemetry !== 'unset') return config.telemetry;
  // DO_NOT_TRACK / REVITION_TELEMETRY=0 always win (REVITION-CLI-PLAN.md:1655, :1671): the answer is already given, so
  // nothing is asked and nothing is written (L3 in a real PTY, 2026-11-18, found the question asked under DO_NOT_TRACK=1).
  if (telemetryForcedOff(process.env)) return 'unset';
  if (json || isCi(process.env) || impliedNoInput(process.env, process.stdin.isTTY === true) || process.stdout.isTTY !== true) return 'unset';
  const io = createIo({
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: process.stdin,
    // End of input (Ctrl-D, a closed terminal) is the default answer, No: the command never hangs or dies on the
    // question ("it never blocks a command", :1673). Before, only 'data' settled it, so EOF exited 13 (unsettled await).
    readLine: async () =>
      new Promise((resolve) => {
        const settle = (answer: string): void => {
          process.stdin.off('data', onData);
          process.stdin.off('end', onEnd);
          resolve(answer);
        };
        const onData = (d: Buffer | string): void => settle(String(d));
        const onEnd = (): void => settle('');
        process.stdin.once('data', onData);
        process.stdin.once('end', onEnd);
      }),
  });
  const answer = await ask(io, `Help improve the Revition CLI by sending anonymous usage data? (y/N) Details: ${TELEMETRY_DOCS_URL}`);
  const choice: ConfigTelemetry = /^(y|yes)$/i.test(answer) ? 'on' : 'off';
  await atomicWriteFile(paths.configFile, `${JSON.stringify(setConfigValue(config, 'telemetry', choice), null, 2)}\n`);
  process.stdin.pause();
  return choice;
}

export async function recordRun(run: {
  readonly command: string;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly durationMs: number;
  readonly json: boolean;
  readonly version: string;
}): Promise<void> {
  const choice = await firstRunConsent(run.json);
  if (!telemetryEnabled(process.env, choice)) return;
  const paths = defaultCliPaths();
  const event = buildEvent({
    installId: await installId(paths.stateDir),
    cliVersion: run.version,
    platform: process.platform,
    nodeVersion: process.version,
    command: run.command,
    argv: run.argv,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    env: process.env,
    now: new Date(),
  });
  if (event === null) return;
  await enqueue(paths.stateDir, event);
  const profileIdx = run.argv.indexOf('--profile');
  startBackground('telemetry', profileIdx >= 0 ? run.argv[profileIdx + 1] : undefined, run.version);
}
