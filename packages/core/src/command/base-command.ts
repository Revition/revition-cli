import { Command, Flags } from '@oclif/core';

import { impliedNoInput } from '../auth/ci-detect.js';
import { defaultCliPaths } from '../config/paths.js';
import { RevitionCliError, usageError } from '../errors/cli-error.js';
import { DebugLog, debugEnabled } from '../log/debug-log.js';
import { toCliError } from '../errors/unexpected.js';
import { useColor } from '../output/color.js';
import { EXIT, type ExitCode } from '../output/exit-codes.js';
import { createIo, type Io } from '../output/io.js';
import { ask, canPrompt, confirmYes } from '../output/prompt.js';
import { pagerCommand, render, writeData, type HumanView } from '../output/render.js';

import type { BaseFlagValues, CommandContext, CoreServices } from './context.js';
import { deprecationNotice, type CommandMeta } from './contract.js';
import { experimentalOptIn } from './stability.js';

export interface PipelineInput<T> {
  readonly meta: CommandMeta;
  readonly flags: BaseFlagValues;
  readonly args: Readonly<Record<string, unknown>>;
  readonly commandFlags: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: Io;
  readonly cliVersion: string;
  readonly services: CoreServices;
  readonly run2: (ctx: CommandContext) => Promise<T>;
  readonly human: ((data: T) => HumanView) | null;
  /** For `confirm: 'typed'`: the resource name the user must type. */
  readonly confirmTarget: (ctx: CommandContext) => string | null;
  /** A mutating command's preview, shown before the confirmation (e.g. a permission diff); may refuse early. */
  readonly beforeConfirm?: (ctx: CommandContext) => Promise<void>;
  /** Writes the human text (the pager decision lives with the caller). */
  readonly writeHuman: (text: string) => Promise<void>;
  /** Set with --debug / REVITION_DEBUG=1: an unexpected error's detail goes here (never to the terminal). */
  readonly debugLog?: DebugLog | null;
  /** The one secret a command shows once (`data[key]` under --json); everything else stays redacted. */
  readonly reveal?: (data: T) => { readonly key: string; readonly value: string } | null;
}

export { experimentalOptIn };

/**
 * T1.1.1 - the one pipeline every command runs, in order:
 * load config/profile -> resolve auth -> check scopes -> feature/stability gate -> confirm (mutates) -> run2 ->
 * render -> map errors -> exit code. Returns the exit code; never throws.
 */
export async function executeCommand<T>(input: PipelineInput<T>): Promise<ExitCode> {
  const { meta, flags, env, io, services } = input;
  const warnings: string[] = [];
  // A command may end with data AND a non-zero exit (setExitCode); an error always wins.
  let resultExit: ExitCode = EXIT.ok;
  const color = useColor({ flag: flags.color, env, isTTY: io.stdoutIsTTY });
  const finish = (error: RevitionCliError | null, data: T | null): ExitCode => {
    render(io, {
      command: meta.id,
      json: flags.json,
      data,
      human: null,
      error: error?.error ?? null,
      warnings,
      cliVersion: input.cliVersion,
      color,
      reveal: error === null && data !== null && input.reveal !== undefined ? input.reveal(data) : null,
    });
    io.flush();
    return error?.exitCode ?? resultExit;
  };
  try {
    const profile = (await services.loadProfile(flags.profile)).name;
    const auth = meta.requiredScopes.length === 0 ? null : await services.resolveAuth(profile);
    if (meta.requiredScopes.length > 0) {
      if (auth === null) {
        throw new RevitionCliError(
          { code: 'AUTH_REQUIRED', message: 'You are not signed in.', hint: 'Run `revition login`.' },
          EXIT.auth
        );
      }
      const missing = meta.requiredScopes.filter((s) => !auth.scopes.includes(s));
      if (missing.length > 0) {
        throw new RevitionCliError(
          {
            code: 'CLI_SCOPE_REQUIRED',
            message: `This command needs the ${missing.join(', ')} scope, which this credential does not have.`,
            hint: 'Sign in again with that scope, or use a token that has it.',
          },
          EXIT.permission
        );
      }
    }
    if (meta.featureFlag !== undefined && !(await services.featureEnabled(meta.featureFlag, profile))) {
      throw new RevitionCliError(
        { code: 'FEATURE_NOT_AVAILABLE', message: `\`${meta.id.replace(/:/g, ' ')}\` is not available on your account yet.` },
        EXIT.permission
      );
    }
    if (meta.stability === 'experimental' && !experimentalOptIn(env, flags.experimental)) {
      throw usageError(
        'EXPERIMENTAL_OPT_IN_REQUIRED',
        `\`${meta.id.replace(/:/g, ' ')}\` is experimental and may change or be removed without notice.`,
        'Re-run with --experimental (or set REVITION_EXPERIMENTAL=1) to use it.'
      );
    }
    if (meta.stability === 'beta') {
      warnings.push(`\`${meta.id.replace(/:/g, ' ')}\` is in beta: its output may change.`);
    }
    // T1.5.1 AC3: a deprecated command warns (stderr; warnings[] under --json) and still runs.
    const deprecation = deprecationNotice(meta);
    if (deprecation !== null) warnings.push(deprecation);
    const ctx: CommandContext = {
      meta,
      flags,
      args: input.args,
      commandFlags: input.commandFlags,
      io,
      env,
      cliVersion: input.cliVersion,
      profile,
      auth,
      color,
      warn: (m) => {
        warnings.push(m);
      },
      setExitCode: (code) => {
        resultExit = code;
      },
    };
    if (meta.mutates && !flags.json && io.stderrIsTTY && services.actingBanner !== undefined) {
      // T1.3.5 AC4: who, where and on which host - before any confirmation.
      const banner = await services.actingBanner(profile).catch(() => null);
      if (banner !== null) io.err(banner);
    }
    if (meta.mutates && input.beforeConfirm !== undefined) await input.beforeConfirm(ctx);
    if (meta.mutates && !flags.yes) await confirmMutation(ctx, input.confirmTarget(ctx));
    const data = await input.run2(ctx);
    if (!flags.json && input.human !== null && data !== null && data !== undefined) {
      for (const w of warnings.splice(0)) io.err(`warn ${w}\n`);
      const view = input.human(data);
      await input.writeHuman(view.text);
      if (view.reveal !== undefined) io.revealOnce(view.reveal);
      io.flush();
      return resultExit;
    }
    return finish(null, data);
  } catch (err) {
    const cliError = toCliError(err);
    if (input.debugLog != null && !(err instanceof RevitionCliError)) {
      const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
      await input.debugLog.line(`unexpected trace=${cliError.error.traceId ?? '-'} ${detail}`).catch(() => undefined);
    }
    return finish(cliError, null);
  }
}

/** mutates -> confirm, or an explicit --yes in non-interactive mode (T1.1.1 invariant; AC2). */
async function confirmMutation(ctx: CommandContext, target: string | null): Promise<void> {
  const name = ctx.meta.id.replace(/:/g, ' ');
  if (!canPrompt(ctx.io, { json: ctx.flags.json, noInput: ctx.flags.noInput })) {
    throw usageError(
      'CONFIRMATION_REQUIRED',
      `\`${name}\` makes changes and needs confirmation, but prompts are off (--no-input, --json or no terminal).`,
      'Re-run with --yes to confirm non-interactively.'
    );
  }
  if (ctx.meta.confirm === 'typed' && target !== null) {
    const typed = await ask(ctx.io, `Type "${target}" to confirm:`);
    if (typed !== target) throw cancelled();
    return;
  }
  if (!(await confirmYes(ctx.io, `Run \`${name}\`?`))) throw cancelled();
}

function cancelled(): RevitionCliError {
  return new RevitionCliError({ code: 'CANCELLED', message: 'Cancelled.' }, EXIT.cancelled);
}

/** The flags every command has. `yes` confirms a mutating command; `experimental` opts in to experimental ones. */
export const baseFlags = {
  json: Flags.boolean({ description: 'Print one JSON document to stdout.', helpGroup: 'GLOBAL' }),
  'no-input': Flags.boolean({ description: 'Never prompt; fail instead.', helpGroup: 'GLOBAL' }),
  yes: Flags.boolean({ char: 'y', description: 'Confirm a command that makes changes.', helpGroup: 'GLOBAL' }),
  profile: Flags.string({ description: 'The config profile to use.', helpGroup: 'GLOBAL' }),
  debug: Flags.boolean({ description: 'Write a debug log.', helpGroup: 'GLOBAL' }),
  color: Flags.option({ options: ['auto', 'always', 'never'] as const, helpGroup: 'GLOBAL' })(),
  experimental: Flags.boolean({ description: 'Allow experimental commands.', helpGroup: 'GLOBAL', hidden: true }),
};

/** Services used when a command is run by the real CLI (replaced in tests via `RevitionCommand.services`). */
let defaultServices: CoreServices = {
  loadProfile: async (p) => ({ name: p ?? 'default' }),
  resolveAuth: async () => null,
  featureEnabled: async () => false,
};
export function setDefaultServices(s: CoreServices): void {
  defaultServices = s;
}

/**
 * T1.1.1 - the base of EVERY command. A command declares `static meta` and implements `run2` (returns its data) and,
 * optionally, `human` (its terminal rendering). No command does its own auth or rendering.
 */
export abstract class RevitionCommand<T> extends Command {
  static meta: CommandMeta;
  static override baseFlags = baseFlags;
  static override enableJsonFlag = false;

  protected abstract run2(ctx: CommandContext): Promise<T>;

  protected human(_data: T): HumanView | null {
    return null;
  }

  protected confirmTarget(_ctx: CommandContext): string | null {
    return null;
  }

  /** The one secret this command shows once (only `token create`); null for every other command. */
  protected reveal(_data: T): { readonly key: string; readonly value: string } | null {
    return null;
  }

  /** A mutating command's preview before the confirmation (default: none). */
  protected async beforeConfirm(_ctx: CommandContext): Promise<void> {
    return undefined;
  }

  async run(): Promise<void> {
    const started = performance.now();
    const ctor = this.constructor as typeof RevitionCommand<T> & { meta: CommandMeta };
    const io = createIo({
      stdout: process.stdout,
      stderr: process.stderr,
      stdin: process.stdin,
      readLine: readLineFromStdin,
    });
    let parsed: Awaited<ReturnType<typeof this.parse>>;
    try {
      parsed = await this.parse(ctor);
    } catch (e) {
      // Bad flags or arguments are a usage error (exit 2), rendered like any other: one envelope under --json.
      const json = this.argv.includes('--json');
      render(io, {
        command: ctor.meta.id,
        json,
        data: null,
        human: null,
        error: usageError('INVALID_USAGE', usageMessageOf(e), `Run \`revition ${ctor.meta.id.replace(/:/g, ' ')} --help\`.`).error,
        warnings: [],
        cliVersion: this.config.version,
        color: useColor({ flag: undefined, env: process.env, isTTY: io.stdoutIsTTY }),
      });
      io.flush();
      this.exit(EXIT.usage);
    }
    const { flags, args } = parsed;
    const f = flags as Record<string, unknown>;
    const code = await executeCommand<T>({
      meta: ctor.meta,
      flags: {
        json: f['json'] === true,
        // T1.3.6: CI (or no TTY on stdin) implies --no-input: a missing confirmation is exit 2, never a hang.
        noInput: f['no-input'] === true || impliedNoInput(process.env, process.stdin.isTTY === true),
        yes: f['yes'] === true,
        experimental: f['experimental'] === true,
        profile: typeof f['profile'] === 'string' ? f['profile'] : undefined,
        debug: f['debug'] === true,
        color: f['color'] as BaseFlagValues['color'],
      },
      args: args as Record<string, unknown>,
      commandFlags: f,
      env: process.env,
      io,
      cliVersion: this.config.version,
      services: defaultServices,
      run2: (ctx) => this.run2(ctx),
      human: (data) => this.human(data) ?? { text: '' },
      confirmTarget: (ctx) => this.confirmTarget(ctx),
      beforeConfirm: (ctx) => this.beforeConfirm(ctx),
      reveal: (data) => this.reveal(data),
      writeHuman: async (text) =>
        writeData(io, text, pagerCommand(process.env, io, f['json'] === true, text, process.stdout.rows)),
      debugLog: debugEnabled(process.env, f['debug'] === true) ? new DebugLog(defaultCliPaths().logDir, process.env) : null,
    });
    await defaultServices
      .afterRun?.({ command: ctor.meta.id, argv: this.argv, exitCode: code, durationMs: performance.now() - started, json: f['json'] === true })
      .catch(() => undefined);
    if (code !== EXIT.ok) this.exit(code);
  }
}

/**
 * T2.5.2 AC3 (macOS UX walk, auditor #590): readline in terminal mode redraws its own (empty) prompt at column 1 and
 * clears to the end of the screen (ESC[1G ESC[0J), which ERASED the question `ask` had just written, so `init` without
 * --yes waited on a confirmation the person never saw. Terminal mode is only needed to hide a secret's echo, and a
 * hidden read suppresses that redraw with the rest of its output; a visible read uses the terminal's own line input.
 * PURE.
 */
export function readlineTerminal(hidden: boolean, stdinIsTTY: boolean): boolean {
  return hidden && stdinIsTTY;
}

/**
 * T2.5.2 AC3 (auditor #590): the whole usage message, on one line. The first line alone dropped what was missing
 * ("Missing 1 required arg:" without naming `kind`). oclif's trailing "See more help with --help" is left out: the hint
 * says it. PURE.
 */
export function usageMessageOf(e: unknown): string {
  if (!(e instanceof Error)) return 'Invalid usage.';
  const text = e.message
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^see more help with/i.test(l))
    .join(' ');
  return text === '' ? 'Invalid usage.' : text.slice(0, 300);
}

/** One line from stdin (prompts). Echo is turned off for a hidden read on a TTY. */
async function readLineFromStdin(opts: { readonly hidden: boolean }): Promise<string> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: readlineTerminal(opts.hidden, process.stdin.isTTY === true),
  });
  if (opts.hidden) {
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => undefined;
  }
  return settledLine(rl);
}

/**
 * The answer, or '' (the default, No) when input ends first (Ctrl-D, a closed terminal). Before, only the answer
 * settled it, so end of input left the await unsettled and the CLI exited 13 with nothing said (macOS walk, #590/#591),
 * as `telemetry-flags.ts` firstRunConsent already guards. Exported for its test.
 */
export function settledLine(rl: {
  question: (q: string, cb: (answer: string) => void) => void;
  once: (event: 'close', cb: () => void) => unknown;
  close: () => void;
}): Promise<string> {
  return new Promise((resolve) => {
    let done = false;
    const settle = (answer: string): void => {
      if (done) return;
      done = true;
      resolve(answer);
    };
    rl.once('close', () => settle(''));
    rl.question('', (answer) => {
      settle(answer);
      rl.close();
    });
  });
}
