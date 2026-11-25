import type { ExitCode } from '../output/exit-codes.js';
import type { Io } from '../output/io.js';

import type { CliScope, CommandMeta } from './contract.js';

/** The flags every command has (RevitionCommand.baseFlags), parsed. */
export interface BaseFlagValues {
  readonly json: boolean;
  readonly noInput: boolean;
  /** Confirms a mutating command non-interactively. */
  readonly yes: boolean;
  /** The opt-in for experimental commands (T1.4.3; REVITION_EXPERIMENTAL=1 is the env form). */
  readonly experimental: boolean;
  readonly profile: string | undefined;
  readonly debug: boolean;
  readonly color: 'auto' | 'always' | 'never' | undefined;
}

/** The signed-in principal as far as the client knows it (the server re-checks every call). */
export interface AuthState {
  readonly scopes: readonly CliScope[];
}

/**
 * What the core needs from the outside world. Config (T1.1.2), auth (T1.3.x) and server flags (T1.4.3) plug in here;
 * tests pass fakes. No command reaches any of these itself.
 */
export interface CoreServices {
  /** Loads the config + profile; throws a RevitionCliError on a bad file. */
  readonly loadProfile: (profileFlag: string | undefined) => Promise<{ readonly name: string }>;
  /** The current credential's scopes, or null when not signed in. */
  readonly resolveAuth: (profile: string) => Promise<AuthState | null>;
  /** A server-delivered feature flag (T1.4.3); unknown = off. */
  readonly featureEnabled: (name: string, profile: string) => Promise<boolean>;
  /** T1.3.5 AC4: "Acting as <email> in <workspace> on <host>", or null when signed out. */
  readonly actingBanner?: (profile: string) => Promise<string | null>;
  /** T1.4.2: after every run (exit code + duration), for opt-in telemetry; never awaited past a local file append. */
  readonly afterRun?: (run: { readonly command: string; readonly argv: readonly string[]; readonly exitCode: number; readonly durationMs: number; readonly json: boolean }) => Promise<void>;
}

export interface CommandContext {
  readonly meta: CommandMeta;
  readonly flags: BaseFlagValues;
  readonly args: Readonly<Record<string, unknown>>;
  readonly commandFlags: Readonly<Record<string, unknown>>;
  readonly io: Io;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cliVersion: string;
  readonly profile: string;
  readonly auth: AuthState | null;
  readonly color: boolean;
  /** Adds a warning: stderr in human mode, `warnings[]` with --json. */
  readonly warn: (message: string) => void;
  /**
   * A result that is data AND a non-zero exit (e.g. `build` with failing checks: the checks are the data, exit 6).
   * The output renders normally; only the exit code changes. Errors still throw.
   */
  readonly setExitCode?: (code: ExitCode) => void;
}
